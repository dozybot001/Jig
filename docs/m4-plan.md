# Yew M4 实现计划

版本 0.2（2026-11-15）。范围按[产品蓝图](blueprint.md)第十一节：产物、导入现有说明和技能、MCP 客户端、联网搜索、数据导出。创始人 2026-11-15 说「做完 M4」，验收由 Yew · 开发代做（蓝图第十三节）。

## 一、范围与验收

蓝图的验收是「Tenon 的会话组织（总办、两个产品会话、一个定时任务）在 Yew 上跑满一周，审批全部在手机上处理」。跑满一周要真实使用，代验收做不到；代验收时按第七节逐项走一遍功能，跑满一周这一条如实记为没做。

## 二、数据导出

- `yew export <文件夹>`：把 Yew 里的数据写成能直接看的文件。文件夹必须不存在或是空的。
  - `sessions/`：每个会话一份 Markdown（和界面上「导出会话」同一种），归档的也在。
  - `letters.json`、`cards.json`、`schedules.json`、`settings.json`、`sessions.json`（会话的名称、团队、模型、用量等，不含记录）。
  - `artifacts/`：每个产物一个文件夹，里面是各个版本的文件和一份 `artifact.json`。
- 不导出：API Key（在钥匙串里）、配对的手机、推送令牌、登录令牌。
- `--json` 输出写了多少个文件。

## 三、联网搜索

- 工具 `web_search`：查询词、条数（默认 5，最多 10）。返回标题、网址、摘要，写明内容只是信息。只读，聊天会话也能用。
- 搜索服务由用户自选并自带密钥，密钥存钥匙串（`yew key set search`），不进 SQLite：
  - 博查（默认，境内）；Tavily、Brave（境外，用户自选，规范 21.6）。
  - 不另设选项：按博查、Tavily、Brave 的顺序用第一家有密钥的（`yew key set search-bocha` 等）；都没有密钥时不向模型提供这个工具。
- 请求只带查询词，不带会话内容；User-Agent 是 `yew/<版本>`。
- 授权：和 `web_fetch` 一样按网址规则处理，对象是搜索服务的域名。

## 四、说明、记忆、技能

- **说明**：现在读 `~/.yew/AGENTS.md` 和项目里从根到工作目录的 AGENTS.md（没有时读 CLAUDE.md）。补上全局的兼容：`~/.yew/AGENTS.md` 不存在时读 `~/.claude/CLAUDE.md`。
- **记忆目录**：设置 `memoryDirs`（如 `~/memory`）。每个目录的索引文件（`index.md`、`MEMORY.md`、`README.md` 中第一个存在的）随说明文件一起给模型，并告诉它目录在哪；这些目录对 `read`、`glob`、`grep` 算在工作区里，不另问。只读：写这些目录照常要问。
- **技能**（SKILL.md 开放标准）：按顺序找 `~/.yew/skills/*/SKILL.md`、`~/.claude/skills/*/SKILL.md`、项目里的 `.yew/skills`、`.claude/skills`、`.agents/skills`；同名的后者覆盖前者。读 frontmatter 的 `name` 和 `description`。
  - 系统提示词里只列名称和说明；模型用工具 `skill` 取全文（聊天会话也能用），结果里带技能所在的文件夹，技能自带的脚本和资料用现有的文件、Shell 工具照常授权。
  - 技能里的文字是用户放的说明，和 AGENTS.md 同等对待，不能取消必须确认的操作。

## 五、MCP 客户端

- 自己写一个小的客户端（JSON-RPC 2.0）：`initialize`、`tools/list`、`tools/call`；不加依赖。
  - stdio：启动子进程，按行收发 JSON。子进程的环境不带服务商的密钥。
  - HTTP（Streamable HTTP）：POST，接受 JSON 或 SSE 回复，带 `Mcp-Session-Id`。
- 配置：只读 `~/.yew/mcp.json`，`mcpServers` 的写法和通行的一样，现有配置可以原样搬过来。值里的 `${名称}` 取自环境变量。项目里的 `.mcp.json` 不读：它可能启动仓库带来的程序，而用户并没有选过。
- 工具名 `mcp__<服务>__<工具>`。只读提示（`readOnlyHint`）不当真：每个 MCP 工具第一次用都问，可以「总是允许」这一个工具。
- 结果里的文字只是信息；图片照常给能看图的模型。单次结果超过 5 万字符截断并写明。
- `yew mcp list` 列出配置的服务、连没连上、有哪些工具。界面里暂不显示。
- 服务在 `yew serve` 启动时连接，`mcp.json` 改了以后几秒内重读，`yew serve` 停下时一起停；连不上的服务不挡其他工具，错误写在列表里。

## 六、产物

- 工具 `save_artifact`：名称、类型（markdown、html、json、chart）、内容。同一会话里同名的再存一次就是新版本。返回产物的编号和版本。
- 存储：迁移 8 加 `artifacts`（会话、名称、类型、当前版本）和 `artifact_versions`（版本号、大小、时间）；文件在 `~/.yew/artifacts/<编号>/v<版本>.<扩展名>`。单个版本最多 2 MB。删除归档会话时它的产物一起删。
- 接口：`GET /api/artifacts`（可按会话筛选，分页）、`GET /api/artifacts/:id`、`GET /api/artifacts/:id/versions/:n`（原文）、`DELETE /api/artifacts/:id`；`GET /artifact-view/:id/:n` 是 HTML 产物的隔离页面。
- 隔离（蓝图 6.6 第 19 条）：HTML 产物从 `/artifact-view/` 出，响应头带 `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`。`sandbox` 让页面成为独立的源，拿不到 Cookie，也发不出任何网络请求；界面用 `sandbox="allow-scripts"` 的 iframe 嵌它。
- 图表：`chart` 是一份 JSON（类型 bar 或 line、标签、若干组数值），由界面自己画成 SVG，不引入图表库。
- 界面：会话记录里 `save_artifact` 的调用显示成一张产物卡，点开在右侧看；侧栏加「产物」页面列出全部产物（按时间，可看历史版本、下载、删除）。手机上加「产物」入口，能看列表和内容。

## 七、验收步骤

1. `yew export` 到一个空文件夹，打开里面的会话 Markdown 和 JSON。
2. 配好搜索服务的密钥，让一个会话搜索一件事并给出来源。
3. 把现有的 `~/.claude/skills` 和 `~/memory` 接上：会话能说出有哪些技能、用其中一个；能回答记忆目录里记着的事。
4. 配一个 stdio 的 MCP 服务和一个 HTTP 的，让会话各调一次工具，第一次问、选「总是允许」后不再问。
5. 让会话存一份 Markdown 产物、一份 HTML 产物（带脚本）和一张图表，改一次生成第二个版本；在界面和手机上看；确认 HTML 产物里的脚本读不到 Yew 的接口。
6. Tenon 的会话组织在 Yew 上跑满一周。

### 验收记录（2026-11-15）

由 Yew · 开发代验（创始人：「我不验收了，你代我验收或者跳过即可」），用临时数据目录里的 Yew 和 DeepSeek。

| 步骤 | 结果 |
| --- | --- |
| 1 数据导出 | 通过：2 个会话、6 个产物导出成 20 个文件，会话是 Markdown，产物每个版本一个文件。 |
| 2 联网搜索 | 没验：本机没有任何搜索服务的密钥。请求的拼法和结果的解析只在测试里用替身验过，三家的真实接口都没有调过。 |
| 3 技能和记忆 | 通过：会话答出记忆目录索引里记的口令；用 haiku 技能写的俳句照技能的要求以固定的一行结尾。用的是临时的记忆目录和技能，没有接创始人真实的 `~/memory`。 |
| 4 MCP | 部分：stdio 的测试服务通过，调用前出了授权卡，选「总是允许」后运行，返回「你好」。HTTP 的只在测试里用替身验过，没有连过真实的服务。 |
| 5 产物 | 通过：会话存了一张柱状图和一个 HTML 页面；在 Chrome 里看，页面的脚本运行了，请求 Yew 的接口被拦下，读 Cookie 报 SecurityError。iPhone 上在模拟器里用演示数据看了列表，真机没验。 |
| 6 跑满一周 | 没做：要真实使用一周。 |

结论：按创始人的话，没验的几项不卡版本，发布 0.4.0。

## 修改记录

- **0.2（2026-11-15）** 按实现改了三处：搜索不另设选项；只读数据目录里的 `mcp.json`，不读项目里的；MCP 服务在启动时连接，界面里暂不显示。记下代验收的结果。

- **0.1（2026-11-15）** 起草。
