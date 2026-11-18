# Hooks / hooks

Commands of your own that Yew Harness runs at set points of a session. English first, Chinese below.

## English

Hooks are written the way Claude Code's `hooks` setting is, so hooks made for it work here. Yew Harness reads them from one file only: `hooks.json` in its data folder (`~/.yew/hooks.json`, or under `YEW_HOME`). Hooks in a project's own files are not read.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "~/bin/check-command", "timeout": 30 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "~/bin/add-context" }] }
    ]
  }
}
```

**When they run.** Five points: `SessionStart` (a session's first turn), `UserPromptSubmit` (something you wrote), `PreToolUse` (before a tool call, before Yew asks you about it), `PostToolUse` (after a tool call that worked) and `Stop` (when the session is about to stop). For the two tool events, `matcher` is a regular expression over the tool's name; Yew's tools also go by the names Claude Code gives them (`shell` is `Bash`, `edit` is `Edit` and so on), and an empty matcher means every tool. The file is read again when it changes.

**What they get.** A JSON object on standard input: `session_id`, `cwd`, `hook_event_name`, and for tool events `tool_name` and `tool_input` in Claude Code's shape (an absolute `file_path`, `old_string`, `new_string`); `PostToolUse` adds `tool_response`, `UserPromptSubmit` adds `prompt`, `Stop` adds `stop_hook_active`. The environment is the one a session's commands get, without model providers' keys, with `CLAUDE_PROJECT_DIR` set to the working folder.

**What they answer.** By exit code: 0 lets things go on, and at `SessionStart` and `UserPromptSubmit` what the hook prints goes to the session, marked as the hook's; 2 stops the step and gives the reason (standard error): before a call, the call does not run; after it, the reason goes with the result; for something you wrote, the session does not act on it; before stopping, the session goes on, three times a turn at most. Any other code is an error you are told of. A JSON answer with `"decision": "block"` or `"permissionDecision": "deny"` stops the step too. A hook can stop or add, never allow: `allow` and `ask` are not taken, and a hook cannot answer a permission or a decision for you. Commands time out after 60 seconds unless `timeout` says otherwise (600 at most); output is cut at 64 KB.

**Keep in mind.**

- `hooks.json` is the only place hooks come from. They run as you, outside the system sandbox and the outer guard, so only you edit that file. Sessions cannot reach the data folder; if Yew Harness ever offers a way to edit hooks in its settings, it will be you changing them there, never `manage_yew` or any tool a session can call.
- The JSON a hook gets on standard input comes from the session and may carry text someone slipped in, the command itself included. Treat it as data: do not paste it into a shell command and run it.
- Not supported: plugins, prompt hooks, other events, and hooks in projects.

## 中文

hooks 的写法和 Claude Code 的 `hooks` 设置一样，给它写的 hooks 拿过来就能用。Yew Harness 只从一个文件读：数据目录里的 `hooks.json`（`~/.yew/hooks.json`，设了 `YEW_HOME` 就在那下面）。项目仓库里带的 hooks 不读。

**什么时候跑。** 五个时候：`SessionStart`（会话的第一轮）、`UserPromptSubmit`（你写了一条消息）、`PreToolUse`（工具调用前，在 Yew 问你之前）、`PostToolUse`（工具调用成功后）、`Stop`（会话要停下时）。两个工具事件里，`matcher` 是对工具名的正则；Yew 的工具也认 Claude Code 的叫法（`shell` 就是 `Bash`，`edit` 就是 `Edit`，依此类推），不写就是所有工具。文件改了会重新读。

**收到什么。** 标准输入上一段 JSON：`session_id`、`cwd`、`hook_event_name`；工具事件还有 `tool_name` 和 Claude Code 格式的 `tool_input`（绝对路径的 `file_path`、`old_string`、`new_string`）；`PostToolUse` 多一个 `tool_response`，`UserPromptSubmit` 多一个 `prompt`，`Stop` 多一个 `stop_hook_active`。环境变量和会话的命令一样，不带模型服务商的密钥，另有 `CLAUDE_PROJECT_DIR` 指向工作目录。

**怎么回应。** 看返回码：0 照常往下，会话开始和你发消息时它打印的内容交给会话，标明是 hook 说的；2 拦下这一步并说明原因（写在标准错误里）：调用前，这次调用不执行；调用后，原因跟着结果交给会话；你发的消息，会话不照着做；会话停下前，让它接着做，一轮最多三次。其他返回码算出错，告诉你。返回 JSON 时，`"decision": "block"` 或 `"permissionDecision": "deny"` 也算拦下。hook 只能拦下或补一句，不能放行：`allow` 和 `ask` 不认，也不能替你答授权或批审批。命令默认 60 秒超时，用 `timeout` 可以改，最长 600 秒；输出最多留 64 KB。

**要记住的。**

- `hooks.json` 是 hooks 唯一的来源。它们以你的身份在系统沙箱和外层保护之外运行，所以这个文件只能由你自己编辑。会话碰不到数据目录；以后如果在设置里加编辑 hooks 的入口，也只能是你在界面上改，不能经 `manage_yew` 或任何会话能调用的工具去改。
- hook 从标准输入收到的 JSON 来自会话，可能夹带别人塞进去的文字，命令原文也在里面。写 hook 时把它当数据处理，不要拼进 shell 命令里执行。
- 不支持：插件、提示词类的 hook、别的事件、项目里的 hooks。
