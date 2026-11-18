# 评测用的模拟环境：接口草案

版本 0.1（2026-11-18），草案，还没实现。出处：蓝图第十一节「v1 之后：和 Yew 模型一起走」第 1 条。要求来自「Yew 模型 · 开发」评测设计的十四条（`~/Yew-model/docs/eval-design.md` 第十节）。字段名请它改，定了再做。

分工：Yew Harness 提供三样，控制器在 `~/Yew-model` 里写。

- 一个能装进场景的临时实例；
- 评测模式下的几个开关；
- 一份运行记录。

控制器负责假会话的剧本、模拟的人、容器和网络、什么时候停、对账和判分。

## 一、怎么跑

1. 控制器建一个数据目录和若干工作区（从场景复制，带 git 历史），写好世界文件。
2. `node scripts/sim-load.ts <world.json> --home <数据目录>`：把世界写进 SQLite。这一步在 `yew serve` 启动之前、在控制器手里做，会话没有任何工具或接口能走到它；「本人」的决定只能这样预先造出来。
3. 带着评测模式的环境变量（第三节）起 `yew serve`，从标准输出拿一次性链接里的 `t`，`POST /api/auth/exchange {"token": t}` 换 Cookie。
4. 被测会话的 Key：`PUT /api/providers/:id/key`。数据目录配 `YEW_KEYCHAIN=off`，Key 只在内存里。
5. 交任务：`POST /api/sessions/:id/messages`，以「人」的身份发。
6. 边跑边读评测事件流（第四节），按人的规则答：
   - 授权和 ask_user：`POST /api/approvals/:id`；
   - 决定卡：`POST /api/cards/:id/decide`；
   - 待处理的事：`GET /api/center`。
7. 控制器判断该停了就停，在自己存的那份记录末尾写停止原因，再读 SQLite 或 `yew export` 对账。

所有写请求带 `Origin: http://127.0.0.1:<端口>`。不加 skill 时，在数据目录放一个空的 `AGENTS.md`：这个文件不存在时，Yew Harness 会退回去读 `~/.claude/CLAUDE.md`。

## 二、世界文件（`yew-sim-world/1`）

JSON。时间都写 ISO 8601，带时区。会话、团队、工作区都用名字互相引用，装载时换成 id。

```json
{
  "format": "yew-sim-world/1",
  "date": "2026-11-20T09:00:00+08:00",
  "settings": { "language": "zh", "mainSession": "统筹", "defaultModel": { "provider": "deepseek", "model": "deepseek-v4-pro", "thinking": "medium" } },
  "teams": [{ "name": "产品" }],
  "workspaces": [{ "name": "acme-shop", "path": "/sim/work/acme-shop" }],
  "sessions": [
    {
      "name": "统筹",
      "kind": "standing",
      "team": null,
      "role": "……职责说明……",
      "workspace": null,
      "permissionMode": "auto",
      "receive": "accept",
      "canOrganize": true,
      "canPostCards": true,
      "model": "under-test",
      "transcript": []
    }
  ],
  "letters": [],
  "cards": [],
  "schedules": []
}
```

- `sessions[].kind`：`standing` 或 `task`。`permissionMode`：`auto`、`manual`、`skip`。`receive`：`accept`、`hold`、`refuse`。
- `sessions[].model`：`"under-test"` 表示被测的模型，由控制器起实例前选定；否则写 `{ "provider", "model", "thinking" }`，假会话就写成指向控制器剧本服务的自定义服务商。
- `sessions[].transcript[]`：已有的对话，按顺序。
  - `{ "role": "user", "text", "at" }`
  - `{ "role": "assistant", "text", "calls": [{ "id", "tool", "args" }], "at" }`
  - `{ "role": "toolResult", "callId", "text", "isError", "at" }`
  - `{ "role": "compaction", "summary", "at" }`
- `letters[]`：`{ "from", "to", "kind", "summary", "body", "status", "at", "replyTo"?, "decision"? }`。
  - `from` 是会话名，或 `"@person"`、`"@cli"`。
  - `kind`：`notice`、`request`、`decision`、`report`。
  - `status`：`queued`、`held`、`delivered`、`done`、`refused`、`dropped`。
- `cards[]`：`{ "number", "by", "requestedBy"?, "title", "context", "options": [{ "label", "detail"? }], "recommended"?, "status", "choice"?, "note"?, "createdAt", "decidedAt"?, "withdrawnReason"? }`。`status`：`pending`、`decided`、`withdrawn`。`decided` 的就是「本人」的决定。
- `schedules[]`：`{ "name", "cron", "session", "message", "enabled", "permissionMode"?, "catchUp"? }`。

## 三、评测模式的开关

只在起 `yew serve` 的环境里设，并从会话 Shell 的环境里去掉。

| 变量 | 作用 |
| --- | --- |
| `YEW_SIM=1` | 打开评测模式；下面几个都要它 |
| `YEW_SIM_DATE` | 时钟从这个时刻起走：系统提示词里的日期、信件和卡片的时间都按它 |
| `YEW_SIM_AWAY=1` | 人不在：所有会话按无人值守的规矩，要人批准的调用和提问直接拒绝并写进报告 |
| `YEW_SIM_RUN` | 控制器给的题号和题的版本，JSON，例如 `{"question":"P2-B2-3","version":"1"}`，写进运行记录开头 |
| `YEW_SIM_LOG` | 运行记录写到哪；默认在数据目录里，会话读不到 |

## 四、运行记录（`yew-sim-log/1`）

一行一个 JSON，都带 `t`（场景时钟的 ISO 时间）和 `type`。同样的行也从 `GET /api/sim/events`（SSE，只在评测模式下有）送出，控制器边跑边存。

| `type` | 内容 |
| --- | --- |
| `run` | 第一行：`format`、`run`（`YEW_SIM_RUN` 原样）、`harness: { version, commit }`、`protocol`、`prompts: { system, tools }`（SHA-256）、`model: { provider, model, thinking }`、`skill`（`AGENTS.md` 的 SHA-256，没有为 null）、`date` |
| `model_call` | `session`、`n`、`tokens: { input, output, cacheRead, cacheWrite, thinking }`（给不出的为 null）、`ms` |
| `tool_call` | `session`、`id`、`tool`、`args`（完整）、`status`、`result`（文字）、`approval`（对应的授权请求 id 或 null） |
| `approval` | `id`、`session`、`kind`（`permission` 或 `question`）、`summary`、`purpose`（会话写的用途）、`mustConfirm`（必须确认的原因或 null）、`status`、`answer: { by, choice, text }`；`by` 是 `person`、`rule`、`unattended` |
| `letter` | `id`、`event`（`sent`、`held`、`released`、`delivered`、`done`、`refused`、`dropped`）和信的全部字段 |
| `card` | `number`、`event`（`posted`、`updated`、`withdrawn`、`decided`）和卡的全部字段 |
| `compaction` | `session`、`summary`（原文） |
| `session` | `session`、`event`（`opened`、`finished`）；`finished` 带 `outcome` 和 `next`（finish_task 的参数） |
| `fallback` | `session`、`text`：回复末尾的提问被兜底放进审批中心 |

停止原因（`idle`、`calls`、`time`）由控制器写在它那份记录的末尾。文件和 git 的最终状态、假服务收到的东西，也由控制器另存。

## 五、协议版本

`PROTOCOL_VERSION`（`src/shared/version.ts`）：从 `/api/health` 的 `protocol` 字段读得到，也写进运行记录的第一行。信件、决定卡、授权请求、finish_task 的字段一改，就升版本，并告诉「Yew 模型 · 开发」。

- 第 1 版：finish_task 有可选的 `next`，写还剩什么、下一步谁做。

## 修改记录

- **0.1（2026-11-18）** 草案，按「Yew 模型 · 开发」的十四条写。已做：协议版本 1。还没做：装载工具、评测模式的开关、运行记录、评测事件流。
