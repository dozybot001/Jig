# Jig 对外介绍

版本 0.6（2026-11-11）。官网产品库、README、App Store 描述和各渠道介绍 Jig 时以本文为准；能力有变化先改这里，再改各处。改了以后把提交号告诉平台组，由它同步官网产品库的条目。依据是[产品蓝图](blueprint.md)第一至五节、`~/memory/session-engineering.md`，以及产品规范 1.8、14.1–14.3。

## 一、定义

「AI 原生的多 Agent 工作台」 / "An AI-native multi-agent workbench"（2026-11-08 定稿，规范 1.8）。

只用这一句，不另写版本，不加修饰。产品库的 `kind`、页眉页脚等处描述 Jig 是什么的短语，也用这一句。

## 二、一段话简介

定义之后接这一句。官网的 `summary`、README 第二段、关于页定义之后、商店描述的开头都用它；页面的 meta description 写成「Jig 是 AI 原生的多 Agent 工作台，」再接这一句。介绍要短：会话怎样分主次、信件、本机运行这些细节放在详情页的段落里，不塞进简介。

> 按 session engineering 的做法组织 Agent 会话：你只对接主对话，要你授权和决定的事都汇到审批中心。

> Agent sessions organized the session engineering way: you deal only with the main conversation, and everything that needs your approval or decision comes to the approval center.

**讲给谁**：现在只供榫卯内部使用；开源后面向一个人带一组 Agent 会话做事的开发者和一人公司。

## 三、理念

Jig 的特点不在单个会话多能干，而在一组会话怎样组织、人怎样和它们打交道。写文案时按下面几条取舍，不必逐条写出来：

1. **Session engineering**：一个 Agent 已经能独立做完一件事，会话一多，限制就变成了人能跟住几个会话。Session engineering 围绕这个限制组织工作：事情怎样分给会话，会话之间怎样交接，人每次要重新读多少东西。Jig 是照这套做法做的工作台。做法的来历见官网博客的两篇 session engineering 文章，详情页可以链接过去。
2. **主次结构**：主对话统筹，替你分派、转达、汇总回报，并维护审批中心；常设会话按团队各管一块事；任务会话为一件事开设，做完回报。结果用信件一级级回到主对话。
3. **人只处理要人处理的事**：人管方向、决定和授权。方向在主对话里说一句；要你授权的操作、要你回答的问题和要你定的事都汇到审批中心。其他会话不用逐个进去看，想看时随时能点开。
4. **结构由 Jig 的代码保证**：回报自动寄回请求方，决定标明出自你本人，删除、推送、发布等操作每次都问你，会话之间的信有额度和转发次数限制。这些由 Jig 执行，不靠提示词让模型自觉。
5. **在你的电脑上运行**：会话在本机的 Jig 服务里运行，网页关了也照常干活；会话、信件和设置存在你的电脑上，Jig 不收集任何数据。每个会话单独选服务商和模型，不绑定任何一家。

## 四、能写的能力

只写已经发布的，写之前对照[更新记录](../CHANGELOG.md)。

- **0.2.0 已发布**：会话与团队、工作区；三种授权方式和「总是允许」；读写文件、命令、搜索、抓取网页和任务清单；上下文自动压缩；会话之间的信件；主对话和它替你改设置；审批中心（授权卡、提问卡、决定卡、待放行的信）；任务会话；`jig serve`、`jig send`；网页界面的中英文和深浅色。
- **已实现、还没发布**，发布后才能写：定时任务；手机访问的 Mac 端。定时任务发布后，第三节第 2 条和产品库的「主次结构」可以加上「定时任务按时给某个会话寄一封信」。
- **还不能写**：iPhone 应用（还没上架）、经中继从手机访问（中继等域名备案后才部署）、推送、开机启动、费用上限、产物、MCP、联网搜索、导入现有的说明和技能。

## 五、不写什么

- 不提 Claude、Claude Code 或 Anthropic 的产品来对比、说明来历或暗示合作（蓝图第十二节）。Anthropic 只作为服务商之一出现。
- 不写「个人版某某」「AI 员工」「内阁」「指挥官」这类比喻（规范 14.2）。博客里拿历史制度作对照是论述内容，产品文案不搬过来。不写效率数字和没验证过的效果。
- 不写「人完全不用进会话」这样绝对的话：方向要在主对话里说，会话也随时能点开看。写「不用逐个进入会话」。
- 不写成已经开源、上架或可以下载：现在只供榫卯内部使用，v1 验收后开源。
- 不写榫卯已经用 Jig 运转公司：M4 验收时才把榫卯的会话组织搬到 Jig 上。

## 六、产品库条目

供官网 `content/products.json` 使用，字段名同其他产品，英文是对应的译文。2026-11-09 已在官网公开（官网仓库提交 c2d865f）：https://tenon.asia/products/jig/ ，中文是 /zh/products/jig/。产品库里的产品都公开，没有单独的公开标记。

详情页的分段和导航（中文 / 英文）：审批中心 / Approval center（decisions「要你处理的事汇到一处」，要点 features「审批中心的卡片」）、会话结构 / Structure（decisions「主次结构」）、信件 / Letters、规则 / Rules（decisions「结构由 Jig 执行」）、本机运行 / On your computer。导航写「会话结构」，因为「主次结构」是那段的标题，官网的译文表一个中文只对一个英文。结尾链接官网博客的两篇 session engineering 文章。

| 字段 | 中文 | English |
| --- | --- | --- |
| `slug`、`name` | `jig`、Jig | |
| `category` | `developer` | |
| `kind`、`tagline`、`storyTitle` | AI 原生的多 Agent 工作台 | An AI-native multi-agent workbench |
| `summary` | 第二节的一段话 | |
| `status` | 开发中 · 内部使用 | In development · internal use |
| `url`、`cta`、`links` | 现在没有公开入口。v1 验收开源后是 GitHub 仓库 `https://github.com/dozybot001/Jig`，按钮「查看源代码」 | View source code |
| `color` | Jig 不设主题色，用中性灰（同 IntHub 的 `#858585`） | |

**`storyIntro`**

> 会话一多，限制就成了人能跟住几个会话。Jig 把会话分成主次：你把事情告诉主对话，它分给其他会话去做，结果逐级回报到主对话。要你授权、回答或决定的事，都汇到审批中心。

> With many sessions, the limit becomes how many of them a person can keep track of. Jig sorts sessions into a main conversation and the sessions under it: you tell the main conversation what you want, it hands the work to other sessions, and the results come back up to it. Whatever needs your approval, answer or decision comes to the approval center.

**`problem`**

1. 会话一多，人要逐个切进去，先想起它负责什么、做到了哪、在等你什么，再回答。要你处理的事散在各个会话里，切换就省不掉。
   With many sessions, you open them one by one and recall what each owns, how far it got and what it is waiting for before you can answer. As long as what needs you is spread across sessions, the switching does not go away.
2. Jig 让会话之间自己分派和回报，把要你处理的事收到一处。
   Jig lets sessions hand off work and report among themselves, and gathers what needs you in one place.

**`decisions`**

| 标题 | 正文 |
| --- | --- |
| 主次结构 | 主对话统筹：替你分派、转达、汇总回报，并维护审批中心。常设会话按团队各管一块事，任务会话为一件事开设、做完回报。会话分聊天和代码两种，区别只在有没有工作区。 |
| A main conversation over the rest | The main conversation coordinates: it hands out work, relays, sums up reports and keeps the approval center. Standing sessions each own an area within a team; a task session is opened for one job and reports when it is done. Sessions are chats or code sessions; the only difference is whether they have a workspace. |
| 要你处理的事汇到一处 | 要你授权的操作、要你回答的问题和要你定的事都在审批中心。决定卡写明建议、期限和能否撤回；你的决定由 Jig 记为本人，送回提出的会话。 |
| What needs you comes to one place | Operations that need your approval, questions for you and decisions all wait in the approval center. A decision card shows the recommendation, the deadline and whether it can be undone; Jig records your decision as yours and sends it back to the session that asked. |
| 结构由 Jig 执行 | 回报自动寄回请求方，决定标明出自你本人，删除、推送、发布等操作每次都问你，会话之间的信有额度和转发次数限制。这些由 Jig 的代码执行，不靠提示词。 |
| Jig enforces the structure | Reports go back to whoever asked, decisions are marked as yours, deleting, pushing, publishing and similar operations ask you every time, and letters between sessions are limited in number and in how far they are passed on. Jig's code does this, not a prompt. |

**`features`**

| 标题 | 正文 |
| --- | --- |
| 会话之间的信件 | 会话之间互相寄通知、请求和回报。信存进数据库，Jig 重启不丢；会话做完别人请求的事，最后的回复自动作为回报寄回。 |
| Letters between sessions | Sessions send each other notices, requests and reports. Letters are stored in a database and survive a restart; when a session finishes what another asked for, its last reply goes back as the report. |
| 审批中心的卡片 | 授权卡用一句话写明是什么操作，附上用途和命令，改文件的附改动预览；提问卡一张最多四个问题，选项可以附说明、标出建议项；暂存的信放不放行也在这里定。 |
| Cards in the approval center | A permission card names the operation in one line, with its purpose and the command; edits come with a preview of the change. A question card holds up to four questions, and their options can carry a note and a recommendation. Held letters are released or refused here too. |
| 在你的电脑上运行 | 会话在你电脑上的 Jig 服务里运行，网页关了也照常干活。会话、信件和设置存在你的电脑上，Jig 不收集任何数据。每个会话单独选服务商和模型，默认用 DeepSeek。 |
| Runs on your computer | Sessions run in the Jig service on your computer and keep working when the web page is closed. Sessions, letters and settings stay on your computer, and Jig collects no data. Each session has its own provider and model; DeepSeek is the default. |

**`showcase`**：主图用审批中心，alt 见第七节；`caption`「Jig 实际界面 · 本地演示数据」/ "Jig's actual interface · local demo data"。

## 七、标识与截图

- **产品图形**：三道平行线组成的 J，单色：浅色主题用近黑，深色主题反白，不另设主题色（蓝图第十二节）。文件是 `web/public/icons/jig-mark.svg`，字标是「Jig」，组合标志按规范第 1 节，右上是 Tenon 小标。
- **截图**：真实界面加本地演示数据：用临时数据目录，不读真实的 `~/.jig`；模型回复由脚本模拟，会话、信件和卡片都由 Jig 自己的代码生成。1280×720 的窗口按 2 倍截取，2560×1440 PNG，中英文、深浅色各一套，文件名 `jig-{画面}-{zh|en}-{light|dark}.png`。四种画面讲同一件事：你让统筹上线首页改版、修好登录问题，统筹分给网站和后端。

| 画面 | 官网上的位置 | alt |
| --- | --- | --- |
| `approval` | 首屏主图，也用在产品卡片上 | Jig 审批中心：网站等你授权推送，后端提出、经统筹放进来的决定卡 / Jig's approval center: Website waiting for you to approve a push, and a decision card raised by Backend through the coordinator |
| `main` | 「主次结构」一段 | Jig 主对话：统筹把首页改版和登录问题分给网站和后端，收到后端的回报后汇总给你 / Jig's main conversation: the coordinator hands the redesign and the sign-in fix to Website and Backend, and sums up once Backend reports back |
| `permission` | 「结构由 Jig 执行」一段 | Jig 代码会话：网站改好首页、跑完测试，推送前停下来等你授权 / A code session in Jig: Website finished the page and ran the tests, then stopped to ask before pushing |
| `letters` | 「会话之间的信件」一段 | Jig 信件列表：会话之间的请求、回报和通知，以及命令行寄来的信 / Jig's letters: requests, reports and notices between sessions, and a letter from the command line |

## 修改记录

- **0.6（2026-11-11）** 创始人说「Jig 的介绍太冗长」，平台组把官网的摘要和首屏介绍压短（官网提交 b863499），本文第二、六节同步成新写法；README 和关于页的简介跟着换成同一句。
- **0.5（2026-11-10）** Jig 已在官网公开（官网提交 c2d865f）。产品库取消了公开标记，删去 `featured` 一行；记下详情页的分段和导航。
- **0.4（2026-11-09）** 截图按官网详情页的版面重拍：审批中心（一张授权卡加一张决定卡）、主对话、代码会话里的授权卡、信件列表，2560×1440；第七节写明每张的位置和中英文 alt。
- **0.3（2026-11-09）** 按创始人给的方向重写定位：Jig 推的是 session engineering 的做法，会话分主次，人只对接主对话、在审批中心处理要人做的事，不用逐个进入会话。重写第二、三、五、六节，第七节写明四种截图画面。
- **0.2（2026-11-09）** 记下产品库条目的现状（官网提交 0c2d448，不公开），以及改了本文要把提交号告诉平台组。
- **0.1（2026-11-09）** 首版。创始人定 Jig 纳入 Tenon 产品库，让 Jig 会话给平台组写文案指导。
