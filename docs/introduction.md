# Jig 对外介绍

版本 0.1（2026-11-09）。官网产品库、README、App Store 描述和各渠道介绍 Jig 时以本文为准；能力有变化先改这里，再改各处。依据是[产品蓝图](blueprint.md)第一至五节，以及产品规范 1.8、14.1–14.3。

## 一、定义

「AI 原生的多 Agent 工作台」 / "An AI-native multi-agent workbench"（2026-11-08 定稿，规范 1.8）。

只用这一句，不另写版本，不加修饰。产品库的 `kind`、页眉页脚等处描述 Jig 是什么的短语，也用这一句。

## 二、一段话简介

定义之后接这一段。官网的 `summary`、README 第二段、商店描述的开头都用它：

> 在你自己的电脑上运转一组 Agent 会话。每个会话有名字、职责、工作区、模型和权限，会话之间互相寄信、分派任务、回报结果。你在主对话里工作，要你授权和决定的事集中在审批中心。

> Run a group of agent sessions on your own computer. Each session has a name, a role, a workspace, a model and permissions, and sessions write to each other, hand off tasks and report back. You work in the main conversation; what needs your approval or decision waits in the approval center.

**讲给谁**：现在只供榫卯内部使用；开源后面向一个人带一组 Agent 会话做事的开发者和一人公司。

## 三、理念

写文案时按这几条取舍，不必逐条写出来：

1. **「AI 原生」指一种工作方式**：一个人，加上一组各有职责的 Agent 会话。Jig 为这种工作方式而做。介绍它时讲会话怎样分工、交接和找你，不讲单个会话多聪明。
2. **只有会话**：子会话就是任务会话，审批中心也是一个信箱。会话分聊天和代码两种，区别只在有没有工作区。
3. **你在主对话里工作**：主对话替你把事交给对应的会话，转达并汇总回报。你不用逐个切进会话，只处理会话停下来找你的事。
4. **关键规则由 Jig 的代码执行**：删除、推送、发布等操作每次都先问你；会话之间的信有额度和转发次数限制。这些由 Jig 判断，不靠模型自觉。
5. **数据在本机**：会话、信件和设置存在你的电脑上，API Key 存在系统钥匙串里。Jig 不收集任何数据，对话只发给你为会话选的模型服务商。
6. **模型可换**：每个会话单独选服务商和模型，不绑定任何一家。

## 四、能写的能力

只写已经发布的，写之前对照[更新记录](../CHANGELOG.md)。

- **0.2.0 已发布**：会话与团队、工作区；三种授权方式和「总是允许」；读写文件、命令、搜索、抓取网页和任务清单；上下文自动压缩；会话之间的信件；主对话和它替你改设置；审批中心（授权卡、提问卡、决定卡、待放行的信）；任务会话；`jig serve`、`jig send`；网页界面的中英文和深浅色。
- **已实现、还没发布**，发布后才能写：定时任务；手机访问的 Mac 端。定时任务发布后，第三节第 2 条和产品库的第一项设计取舍可以加上「定时任务是按时寄给某个会话的一封信」。
- **还不能写**：iPhone 应用（还没上架）、经中继从手机访问（中继等域名备案后才部署）、推送、开机启动、费用上限、产物、MCP、联网搜索、导入现有的说明和技能。

## 五、不写什么

- 不提 Claude、Claude Code 或 Anthropic 的产品来对比、说明来历或暗示合作（蓝图第十二节）。Anthropic 只作为服务商之一出现。
- 不写「个人版某某」「AI 员工」「内阁」「指挥官」这类比喻（规范 14.2），不写效率数字和没验证过的效果。
- 不写成已经开源、上架或可以下载：现在只供榫卯内部使用，v1 验收后开源。
- 不写榫卯已经用 Jig 运转公司：M4 验收时才把榫卯的会话组织搬到 Jig 上。

## 六、产品库条目

供官网 `content/products.json` 使用，字段名同其他产品，英文是对应的译文。

| 字段 | 中文 | English |
| --- | --- | --- |
| `slug`、`name` | `jig`、Jig | |
| `category` | `developer` | |
| `kind`、`tagline`、`storyTitle` | AI 原生的多 Agent 工作台 | An AI-native multi-agent workbench |
| `summary` | 第二节的一段话 | |
| `status` | 开发中 · 内部使用 | In development · internal use |
| `url`、`cta`、`links` | 现在没有公开入口。v1 验收开源后是 GitHub 仓库 `https://github.com/dozybot001/Jig`，按钮「查看源代码」 | View source code |
| `featured` | `false`，公开时再改 | |
| `color` | Jig 不设主题色，用中性灰（同 IntHub 的 `#858585`） | |

**`storyIntro`**

> Jig 运行在你自己的电脑上。常设会话长期负责一块事，任务会话为一件事开设，做完回报结果；会话在本机的 Jig 服务里运行，网页关了也照常干活。你不用逐个盯着对话，只处理会话停下来找你的事：需要你授权的操作，和只有你能回答的问题。

> Jig runs on your own computer. Standing sessions own an area of work for the long term; task sessions are opened for one job and report back when it is done. Sessions run in the Jig service on your computer and keep working when the web page is closed. You don't watch each conversation; you handle what sessions stop to ask you: operations that need your approval, and questions only you can answer.

**`problem`**

1. 一个人同时带好几个 Agent 会话做事，难处在会话之间：谁在做什么、谁在等你、结果该交给谁。只能逐个切进对话看进度、来回转述消息时，时间都花在传话上。
   When one person works with several agent sessions, the hard part is between them: who is doing what, who is waiting for you, and who should get a result. If you have to open each conversation to check on it and pass messages along by hand, that is where your time goes.
2. Jig 把分派、转达和回报交给会话之间的信件和主对话，把需要你拿主意的事集中到审批中心。
   Jig moves handing off, relaying and reporting into letters between sessions and the main conversation, and gathers what needs your decision in the approval center.

**`decisions`**

| 标题 | 正文 |
| --- | --- |
| 只有会话 | 子会话就是任务会话，审批中心也是一个信箱。会话分聊天和代码两种，区别只在有没有工作区。 |
| Only sessions | A sub-agent is a task session, and the approval center is a mailbox too. Sessions are chats or code sessions; the only difference is whether they have a workspace. |
| 规则由 Jig 执行 | 删除、推送、发布等操作每次都先问你；会话之间的信有额度和转发次数限制。这些由 Jig 的代码判断，不靠模型自觉。 |
| Jig enforces the rules | Deleting, pushing, publishing and similar operations ask you every time, and letters between sessions are limited in number and in how far they are passed on. Jig's code decides this; it does not rely on the model. |
| 数据在本机 | 会话、信件和设置存在你的电脑上，API Key 存在系统钥匙串里。Jig 不收集任何数据，对话只发给你为会话选的模型服务商。 |
| Your data stays with you | Sessions, letters and settings stay on your computer, and API keys stay in the system keychain. Jig collects no data; conversations go only to the model provider you chose for each session. |

**`features`**

| 标题 | 正文 |
| --- | --- |
| 主对话与审批中心 | 你平时只在主对话里说话，它把事交给对应的会话、汇总回报。要你授权的操作、要你回答的问题和决定卡集中在审批中心；决定卡写明建议、期限和能否撤回，你的决定由 Jig 标为本人，送回提出的会话。 |
| Main conversation and approval center | You usually talk only to the main conversation; it hands work to the right session and sums up the reports. Operations that need your approval, questions for you and decision cards wait in the approval center. A decision card shows the recommendation, the deadline and whether it can be undone; Jig marks your decision as yours and sends it back to the session that asked. |
| 会话之间的信件 | 会话之间互相寄通知、请求和回报。信存进数据库，Jig 重启不丢；会话做完别人请求的事，最后的回复自动作为回报寄回。 |
| Letters between sessions | Sessions send each other notices, requests and reports. Letters are stored in a database and survive a restart; when a session finishes what another asked for, its last reply goes back as the report. |
| 模型可换 | 每个会话单独选服务商和模型。默认用 DeepSeek，也可以用 Kimi、Anthropic、OpenAI 等内置服务商，或添加 OpenAI 兼容的地址。 |
| Any model per session | Each session has its own provider and model. DeepSeek is the default; Kimi, Anthropic, OpenAI and other built-in providers work too, and you can add any OpenAI-compatible endpoint. |

**`showcase`**（公开时）：主图用审批中心，一张授权卡加一张决定卡；`alt`「Jig 审批中心：等你授权的操作和一张决定卡」，`caption`「Jig 实际界面 · 本地演示数据」。

## 七、标识与截图

- **产品图形**：三道平行线组成的 J，单色：浅色主题用近黑，深色主题反白，不另设主题色（蓝图第十二节）。文件是 `web/public/icons/jig-mark.svg`，字标是「Jig」，组合标志按规范第 1 节，右上是 Tenon 小标。
- **截图**：真实界面加本地演示数据，用临时数据目录，不读真实的 `~/.jig`；中英文、深浅色各一套。公开时由 Jig 会话提供。画面建议：审批中心（主图）、主对话收到回报、会话记录里的信件、会话设置里的授权方式。

## 修改记录

- **0.1（2026-11-09）** 首版。创始人定 Jig 纳入 Tenon 产品库，让 Jig 会话给平台组写文案指导。
