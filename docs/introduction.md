# Yew Harness 对外介绍

版本 0.37（2026-11-18）。官网产品库、README、App Store 描述和各渠道介绍 Yew Harness 时以本文为准；能力有变化先改这里，再改各处。改了以后把提交号告诉平台组，由它同步官网产品库的条目。依据是[产品蓝图](blueprint.md)第一至五节、`~/memory/session-engineering.md`，以及产品规范 1.8、14.1–14.3。

## 一、定义

「AI 原生的多 Agent 工作台」 / "An AI-native multi-agent workbench"（2026-11-08 定稿，规范 1.8）。

只用这一句，不另写版本，不加修饰。产品库的 `kind`、页眉页脚等处描述 Yew Harness 是什么的短语，也用这一句。

**名字**：产品叫 Yew Harness，中英文都这样写，不另起中文名，也不简称 Yew；单说 Yew 指红发女孩（2026-11-18 创始人定，蓝图第十二节）。npm 包 `@tenonai/yew`、命令 `yew` 这些技术名字照旧，写安装和命令时照原样写。

## 二、一段话简介

定义之后接这一句。README 第二段、关于页定义之后、商店描述的开头都用它。官网的摘要和 meta description 按产品页的主张另写，见第六节。介绍要短：会话怎样分主次、信件、手机审批这些细节放在产品页的主张里，不塞进简介。

> 按 Session Engineering 的做法组织 Agent 会话：你只对接主对话，要你授权和决定的事都汇到审批中心。

> Agent sessions organized the Session Engineering way: you deal only with the main conversation, and everything that needs your approval or decision comes to the approval center.

**讲给谁**：一个人带一组 Agent 会话做事的开发者和一人公司。

## 三、理念

Yew Harness 的特点不在单个会话多能干，而在一组会话怎样组织、人怎样和它们打交道。写文案时按下面几条取舍，不必逐条写出来：

1. **Session Engineering**：一个 Agent 已经能独立做完一件事，会话一多，限制就变成了人能跟住几个会话。Session Engineering 围绕这个限制组织工作：事情怎样分给会话，会话之间怎样交接，人每次要重新读多少东西。Yew Harness 是照这套做法做的工作台。做法的来历见官网博客的两篇 Session Engineering 文章，详情页可以链接过去。
2. **主次结构**：主对话统筹，替你分派、转达、汇总回报，并维护审批中心；常设会话按团队各管一块事；任务会话为一件事开设，做完回报。结果用信件一级级回到主对话。
3. **人只处理要人处理的事**：人管方向、决定和授权。方向在主对话里说一句；要你授权的操作、要你回答的问题和要你定的事都汇到审批中心。其他会话不用逐个进去看，想看时随时能点开。
4. **结构由 Yew Harness 的代码保证**：回报自动寄回请求方，决定标明出自你本人，删除、推送、发布等操作每次都问你，会话之间的信有额度和转发次数限制。这些由 Yew Harness 执行，不靠提示词让模型自觉。
5. **在你的电脑上运行**：会话在本机的 Yew Harness 服务里运行，网页关了也照常干活；会话、信件和设置存在你的电脑上，Yew Harness 不收集任何数据。每个会话单独选服务商和模型，不绑定任何一家。

## 四、能写的能力

已经实现的能力都能写，发布没发布写法一样：直接写能做什么，不加「目前」「暂未」「即将」。能不能下载看官网有没有入口（Yew Harness 的产品页有安装命令、源代码和安卓版的下载，iPhone 版还没上架），文案里不逐句交代；没实现的不写，也不写成计划。写之前对照[更新记录](../CHANGELOG.md)：已发布的记在各版本下，已实现、还没发布的记在「未发布」下。

- **已发布**（1.0.0，2026-11-15 开源，当时叫 Jig；1.3.0 起叫 Yew，1.5.0 起叫 Yew Harness，npm 包仍是 `@tenonai/yew`）：会话与团队、工作区；三种授权方式和「总是允许」；读写文件、命令、搜索、抓取网页和任务清单；上下文自动压缩；会话之间的信件；主对话和它替你改设置；审批中心（授权卡、提问卡、决定卡、待放行的信）；任务会话；`yew serve`、`yew send`；网页界面的中英文和深浅色；侧栏底部的 Yew（红发女孩）用气泡说眼下最要紧的一件事，说的是一件事或一个会话时点一下直接过去，打开时有一秒左右的开场，列出真实的启动步骤（1.4.0）；设置窗口和「个性化」（主题、语言、界面里的 Yew 和开场）、系统沙箱（macOS 和 Linux）、会话读不到的目录（1.6.0）。
  - 系统沙箱（macOS、Linux）：会话的命令和用户自己加的 MCP 服务器在沙箱里运行，用的是 Anthropic 开源的 sandbox-runtime（macOS 上是 Seatbelt，Linux 上是 bubblewrap）。沙箱里读写不了 Yew Harness 的数据、读不到钥匙串，只能写工作区、临时文件夹和沙箱自己的缓存，联网只放行常用的包管理源、代码托管网站和配了密钥的模型服务商，连别的网站先问用户；要在沙箱外跑的命令每次都问。Linux 上只在容器里跑过测试，写的时候不说「实测」；不写「绝对安全」这类说法。
  - 会话读不到的目录：用户在设置里列出放密钥、私人笔记的文件夹，会话的文件工具和沙箱里的命令都读不到。
- **已实现、还没发布**：
  - 手机审批：手机应用（iPhone、安卓）扫码和 Mac 配对，经中继连接，端到端加密，中继只转发密文。在手机上允许或拒绝操作、回答提问、做决定、放行或拒收暂存的信；也能看会话记录和信件、给会话发消息、让干活的会话停下。
  - 定时任务：按时以定时任务的名义给一个常设会话寄信，会话无人值守地做完，回报寄给主对话。讲主次结构时可以带上。
  - 每日费用上限：给一个会话或全部会话设每天最多花多少美元（按服务商的价格估算），到 80% 提醒，到上限会话停下，点继续当天再给同样多的额度。提醒现在写在会话记录里，不写「推送提醒」。
  - 开机启动：`yew service install` 让 Yew Harness 在登录后自动启动，macOS 和 Linux 都支持。
- **写手机时**：会话仍在 Mac 上的 Yew Harness 里运行，手机经中继连到这台 Mac，所以 Mac 上要开着 Yew Harness。安卓版已发布（1.0.1 起），安装包在 GitHub 和 Gitee 的 Releases 里，由公司签名；介绍下载时只指向官网 Yew Harness 页的「安卓版」一节（`https://tenonai.cn/zh/products/yew/#android`），那里有两个下载入口和签名证书指纹，不直链安装包文件。iPhone 应用还没上架，之后经 TestFlight 和 App Store 发布，不写成可以下载。安卓版和 iPhone 版不同的地方见 [安卓版文档](android.md) 第 5 节：安卓不用推送服务，打开通知后由应用在后台保持到中继的连接，系统会显示一条常驻通知。安卓版只在模拟器上走查过，真机和真实中继上的配对、通知没验过，写的时候不说「实测」。API Key、配对和移除手机只在 Mac 上操作。
- **写模型时**：模型接入用开源库 pi-ai；Agent 循环、工具和权限是 Yew Harness 自己写的，所以不写「基于 Pi Agent」。设置里列出 pi-ai 内置的 33 个服务商入口，来自 23 家（同一家的不同地区、套餐分开列），还能添加兼容 OpenAI 接口的服务商或本机运行的模型。每个会话单独选，默认 DeepSeek。
  - 通知：审批中心有新的待办、会话出错、任务做完、费用到上限时通知手机，内容端到端加密。中继已上线（`wss://relay.tenonai.cn`）。iPhone 的通知只在模拟器上验到 Apple 接受为止，真机上没验过，写的时候不说「实测」。
  - 产物：会话把文档、页面、数据和图表存成产物，有版本，在电脑和手机上看；HTML 页面在隔离环境里显示。
  - 技能和记忆目录：读 `~/.claude/skills` 等位置的技能（SKILL.md）和你指定的记忆目录，现有的配置不用搬。
  - MCP：按通行的 `mcpServers` 写法配置，支持本机程序和网址两种，每个工具第一次用先问你；会发送、发布或删除东西的工具（按工具名和服务自己的标注判断）每次都问，不能设成总是允许。
  - 浏览器和电脑操控：Yew Harness 自带两个 MCP 服务。浏览器默认经 Playwright 的 Chrome 扩展连用户自己的 Chrome（要先装上扩展，第一次使用时在 Chrome 里同意连接、选给它用的标签页），用的是用户已有的登录，也可以在设置里改成单独的 Chrome 窗口，会话可以打开网页、点击、填写；电脑操控可以截屏、动鼠标、敲键盘。每次调用先问用户；电脑操控的点击和输入，以及连用户自己的 Chrome 时浏览器里点击、输入、打开网址这类动页面的操作，每一次都要确认，不能设成总是允许；可以在设置里停用。写的时候说明它们由开源的 Playwright MCP 和 computer-use-mcp 提供，第一次使用要联网安装；截屏和网页内容会作为工具结果发给用户所选的模型服务商；连用户自己的 Chrome 时，会话在页面里运行脚本能读到网站允许脚本读取的 Cookie。
  - 分叉和回溯：会话可以带上自己的记录开一个任务会话，任务说明可以写短；你可以从任意一条回复或你的任意一条消息分叉出新会话，也可以把对话回溯到某一处重来。回溯只撤回对话，不撤回已经改的文件和执行过的命令。
  - 消息下的操作：每条消息和回复下面，鼠标移上去显示时间、复制、回溯和分叉。
  - 助手：会话可以把一件独立的事交给助手去查，只拿回结论。助手只能读和查，不能改东西，几个可以同时跑。
  - 常用 MCP 服务：GitHub、Gitee、Context7、Notion、Sentry 填上令牌就能添加；Linear、Vercel、Gmail、Google 日历、Google 云端硬盘在浏览器里登录（Google 的几个要用户自己在 Google Cloud 建客户端，目前在 Google 的开发者预览阶段）。要求登录的远程 MCP 服务都能在 Yew Harness 里登录。
  - 联网搜索：自带搜索服务的密钥（博查、Tavily、Brave）。三家的真实接口还没调通过，先不对外写。
  - 数据导出：`yew export` 把会话导出成 Markdown，其余导出成 JSON；设置的「数据管理」里也能导出，还能看数据目录占了多少、清理临时文件。
  - 用量：「用量」页画出最近 30 天每天的费用，今天花了多少、离每日上限多远，某一天每个会话的费用和 token。费用按服务商的价格估算，写的时候说「估算」。
  - 会话关系：「会话关系」页用一张图列出全部会话，谁开了谁、最近 24 小时的信从哪到哪、各自的状态。
  - 会话进度和等待时间：会话在干活时写这一轮读了几个文件、改了几处、跑了几条命令、用了多久；审批中心每一项写明等了多久。
  - 设置：MCP 服务、技能、搜索服务的密钥、中继地址、通知哪几类事、新会话的默认授权方式和工作区、登录时启动和启动图标，都能在设置里改，不用命令行。技能只能停用和启用，不能在 Yew Harness 里编辑或安装。
  - 服务商的连接测试：设置的「服务商与密钥」里可以测试一个服务商连不连得上、多久开始回答。Yew Harness 不显示服务商账户的余额。
- **没实现，不写**：可下载安装的桌面应用、Windows。安装命令是 `npm install -g @tenonai/yew`，以 npm 上实际能装为准。
- **A2A**：按创始人 11-11 的定稿，指会话之间的异步信箱，也就是 Yew Harness 的信件。Yew Harness 没有实现 A2A 协议，不写成支持或兼容 A2A 协议。

## 五、不写什么

- 不提 Claude、Claude Code 或 Anthropic 的产品来对比、说明来历或暗示合作（蓝图第十二节）。Anthropic 只作为服务商之一出现。
- 产品页主张的第 1–5 条和界面那句是创始人 11-11 的定稿，照原样用（规范 14.2.1）；第 6 条是创始人 11-18 定加上的（原话「加上」），文字由本文起草，他看过官网预览后说「发布」。「坐进办公室当老板」「打破工位枷锁」是他定的说法。此外不另加比喻（规范 14.2）：不写「个人版某某」「AI 员工」「内阁」「指挥官」这类说法，博客里拿历史制度作对照是论述内容，产品文案不搬过来；要加新的比喻先问创始人。不写效率数字和没验证过的效果。
- 不把 Session Engineering 写成小写：它是专有名词，两个词首字母都大写，中文里也这样写（创始人 11-11：「session engineering 换成 Session Engineering。专有名词」）。Prompt Engineering 这类同类术语也大写（官网 7302151）。
- 不写「人完全不用进会话」这样绝对的话：方向要在主对话里说，会话也随时能点开看。写「不用逐个进入会话」。
- Yew Harness 已开源（MIT），可以写开源和 npm 安装；安卓版的安装包已发布在 Releases 里，可以写；iPhone 应用还没有上架，不写成可以下载。不写备案状态。
- 不写榫卯已经用 Yew Harness 运转公司：M4 验收时才把榫卯的会话组织搬到 Yew Harness 上。

## 六、官网产品页

2026-11-11 按创始人定的结构重做（官网提交 5d7cd3e），之后按他的调整取消了导航条（703d757），第 4、5 条配上截图（4477683），Session Engineering 按专有名词大写（9beb0ff），界面那句改成「交互界面」（efc1d4e）：https://tenonai.cn/products/yew/ ，中文是 /zh/products/yew/。七个产品的页面结构相同：产品标志、一句话定义、链接、产品大图、带图的主张、界面那句、底部邀请卡片。首页的产品卡片单行滚动，卡片上只有标志和一句话定义。Yew Harness 没有公开入口，链接和邀请卡片指向官网博客的两篇 Session Engineering 文章。英文是官网的译文。

| 字段 | 中文 | English |
| --- | --- | --- |
| `slug`、`name` | `yew`、Yew Harness | |
| `category` | `developer` | |
| `tagline`（一句话定义） | AI 原生的多 Agent 工作台 | An AI-native multi-agent workbench |
| `showcase.summary`（结构化数据的描述） | 为 Session Engineering 而生。你只对接主对话，授权和决定都在审批中心，手机上也能处理。 | Born for Session Engineering. You deal only with the main conversation, and approvals and decisions sit in the approval center, on your phone too. |
| meta description | Yew Harness 是 AI 原生的多 Agent 工作台，为 Session Engineering 而生：你只对接主对话，授权和决定都在审批中心，手机上也能处理。 | Yew Harness is an AI-native multi-agent workbench, born for Session Engineering: you deal only with the main conversation, and approvals and decisions sit in the approval center, on your phone too. |
| 链接 | Session Engineering、Session Engineering（二） | Session Engineering, Session Engineering, part 2 |
| 邀请卡片 | 了解 Session Engineering | Read about Session Engineering |
| `url` | GitHub 仓库 `https://github.com/dozybot001/Yew`（官网产品目录 11-18 起用这个地址） | |

**主张**：创始人 11-11 定稿，照原样用（规范 14.2.1）。配图见第七节。

| | 标题 | 正文 | 配图 |
| --- | --- | --- | --- |
| 1 | 为 Session Engineering 而生 | 按这套理念构建，并且处处为它优化。 | `main` |
| 2 | 出色的多 Agent 协作体验 | 基于异步信箱机制 A2A，让 Agent 交流很无感。 | `letters` |
| 3 | 真正坐进办公室当老板 | 授权与决定都在审批中心，你的操作才有实权。 | `permission` |
| 4 | 随时随地，打破工位枷锁 | 手机也能审批，人不在电脑前，授权和决定照样处理。 | `phone` |
| 5 | 模型随你选 | 接入库用开源的 pi-ai，支持超级多家模型服务商。 | `models` |
| 6 | 一眼看到要你处理的事 | 侧栏底部的 Yew 用气泡说眼下最要紧的一件事：几件事等你处理、哪个会话出错了或做完了，点一下直接过去。 | Yew |

| | Title | Body |
| --- | --- | --- |
| 1 | Born for Session Engineering | Built on the idea and tuned for it throughout. |
| 2 | Multi-agent collaboration done well | Agents talk through A2A, an asynchronous mailbox, and you hardly notice it happening. |
| 3 | Take the boss’s chair for real | Approvals and decisions all sit in the approval center, and only your actions carry real authority. |
| 4 | Anywhere, anytime, off the desk | Approve from your phone. Away from the computer, approvals and decisions still get handled. |
| 5 | Your choice of model | Model access is built on the open-source pi-ai library, with a huge range of model providers supported. |
| 6 | See what needs you at a glance | Yew, at the foot of the sidebar, says the one thing that matters most right now: what is waiting for you, or which session failed or finished. One click takes you there. |

**界面那句**（有界面的 Tenon 产品共用）：优雅克制的交互界面，顺畅丝滑的用户体验。/ An elegant, restrained interface. A smooth, effortless experience.

**核对过的事实**，改主张时对照：

- 第 2 条：信件存进数据库，由 Yew Harness 排队、暂存和投递，寄信的会话不用等对方回复。A2A 的含义见第四节。
- 第 3 条：授权卡要你本人点，决定由 Yew Harness 记为出自你本人；其他会话的信、网页和工具结果都不算授权。
- 第 4、5 条：见第四节「写手机时」「写模型时」。pi-ai 是 MIT 许可的开源库。

## 七、标识与截图

- **产品图形**：一枝红豆杉，红色的果（`#C8323F`，带深绿的种子）和一片叶子；叶子浅色主题用深绿 `#1F3A2E`，深色主题用浅灰绿 `#E3E8E4`（蓝图第十二节）。文件是 `web/public/icons/yew-mark.svg`；字标是 Young Serif 描出的「Yew」（`web/src/components/icons.tsx` 的 `YewWordmark`），产品名的地方后面配一个小一号的「Harness」（`ProductName`）。组合标志不带 Tenon 标志，Tenon 标志只用在关于页的出品方（规范 2.35 第 1 节）。红发女孩的名字是 Yew（创始人 11-18：「不要说吉祥物，它的名字就是 Yew」），对外不叫吉祥物、mascot；她的 38 个姿势和一张高清立绘（`portrait.webp`，1108×2400，透明底）在 `web/public/mascot/`，清单见[出图清单](mascot.md)。
- **截图**：真实界面加本地演示数据：用临时数据目录，不读真实的 `~/.yew`；模型回复由脚本模拟，会话、信件和卡片都由 Yew Harness 自己的代码生成。网页是 1280×720 的窗口按 2 倍截取，2560×1440 PNG；iPhone 是模拟器 iPhone 17 Pro 的竖屏原图，1206×2622 PNG，调试版应用直接连同一个演示服务，状态栏统一为 9:41、满格、满电。中英文、深浅色各一套，文件名 `yew-{画面}-{zh|en}-{light|dark}.png`。六种画面讲同一件事：你让统筹上线首页改版、修好登录问题，统筹分给网站和后端。官网页脚写明「界面截图使用本地演示数据，不代表生产记录。」；页面只给截图加一道淡边框，手机截图不画机身，交原图即可。
- **文件**：六种画面的原图都在本仓库 [docs/assets/](assets/)（11-18 从 docs/screenshots/ 挪过来，开源仓库规范要求图片放在这里），命名为 `yew-<画面>-<zh|en>-<light|dark>.png`，由 `node scripts/screenshots.ts` 生成（2026-11-18 按 Yew 的标识重拍，同日产品改名后、撤掉 Tenon 小标后，网页的五种又各重拍一次，手机那张不变；做法和参数见脚本开头）。

| 画面 | 官网上的位置 | alt |
| --- | --- | --- |
| `approval` | 产品大图 | Yew Harness 审批中心：网站等你授权推送，后端提出、经统筹放进来的决定卡 / Yew Harness's approval center: Website waiting for you to approve a push, and a decision card raised by Backend through the coordinator |
| `main` | 主张 1 | Yew Harness 主对话：统筹把首页改版和登录问题分给网站和后端，收到后端的回报后汇总给你 / Yew Harness's main conversation: the coordinator hands the redesign and the sign-in fix to Website and Backend, and sums up once Backend reports back |
| `letters` | 主张 2 | Yew Harness 信件列表：会话之间的请求、回报和通知，以及命令行寄来的信 / Yew Harness's letters: requests, reports and notices between sessions, and a letter from the command line |
| `permission` | 主张 3 | Yew Harness 代码会话：网站改好首页、跑完测试，推送前停下来等你授权 / A code session in Yew Harness: Website finished the page and ran the tests, then stopped to ask before pushing |
| `phone` | 主张 4 | Yew Harness iPhone 应用的审批页：网站等你允许推送首页改版，后端提出的决定也在这里 / Approvals in Yew Harness on iPhone: Website waiting for you to allow pushing the home page redesign, and a decision raised by Backend |
| `models` | 主张 5 | Yew Harness 给后端会话选服务商：国内、境外分组列出，没设密钥的会标出 / Choosing a provider for the Backend session in Yew Harness: providers grouped into Chinese providers and Other providers, with the ones that have no key marked |
| Yew | 主张 6 | Yew：红发女孩，头上别着红豆杉发饰 / Yew: a red-haired girl with a yew-berry hair ornament |

官网 Yew Harness 页用到的 Yew 的图（website b92d3e7，创始人看过预览说「发布」）：宽屏首屏是全身立绘 `portrait`；第 2、3、4 条主张旁边分别是 `letter-run`、`stamp`、`phone`；第 6 条是 `greeting` 加界面里那句真实的气泡。文件都在 `web/public/mascot/`。

## 修改记录

- **0.37（2026-11-18）** 法务组改定 Cookie 的写法：不写「能读到这个 Chrome 的 Cookie」，写在页面里运行脚本能读到网站允许脚本读取的 Cookie。
- **0.36（2026-11-18）** 安全组、法务组评审后：连用户自己的 Chrome 时，浏览器里动页面的操作每次都要确认、不能设成总是允许，会话能读到这个 Chrome 的 Cookie，第四节「浏览器和电脑操控」一条跟着改。
- **0.35（2026-11-18）** 自带的浏览器默认连用户自己的 Chrome（创始人：「默认浏览器改为用户自己的浏览器。」），第四节「浏览器和电脑操控」一条跟着改。
- **0.34（2026-11-18）** 1.6.0 发布：设置窗口和个性化、系统沙箱、会话读不到的目录记进第四节「已发布」。
- **0.33（2026-11-18）** 系统沙箱 Linux 上也打开（创始人：「Linux 上的沙箱也打开」），写法改成 macOS 和 Linux，Linux 只在容器里测过、不说「实测」。
- **0.32（2026-11-18）** 第四节加系统沙箱（macOS）和「会话读不到的目录」。
- **0.31（2026-11-18）** 第七节：组合标志不再带 Tenon 小标，Tenon 标志只在关于页的出品方（规范 2.35），网页的五种截图跟着重拍。第四节「已实现、还没发布」写上设置窗口和个性化。
- **0.30（2026-11-18）** 1.5.0 发布：第四节「已发布」写明 1.5.0 起叫 Yew Harness。
- **0.29（2026-11-18）** 创始人定产品叫 Yew Harness、红发女孩叫 Yew（蓝图 1.23）。第一节加上「名字」一条；正文里指产品的地方改成 Yew Harness，产品库的 `name` 跟着改，`slug` 不动；主张 6 和配图说的是红发女孩，仍写 Yew。网页的五种截图按新的标志重拍了。
- **0.28（2026-11-18）** 第七节记下官网 Yew 页用了哪几张 Yew 的图（平台组 b92d3e7）。
- **0.27（2026-11-18）** Yew（红发女孩）从 10 个姿势加到 38 个，高清立绘 `web/public/mascot/portrait.webp` 已入库，主张 6 的配图可以换成它。
- **0.26（2026-11-18）** 创始人（平台组转达）：「不要说吉祥物，它的名字就是 Yew」。正文里的吉祥物都改称 Yew，第 6 条主张和配图说明照官网改（website 2448a9a）。
- **0.25（2026-11-18）** 创始人定产品页加一条吉祥物的主张（原话「加上」）：主张第 6 条和它的配图，文字在官网改版里请他确认。配图先用 `web/public/mascot` 的原图，高清立绘到了再换。
- **0.24（2026-11-18）** 1.4.0 发布：侧栏吉祥物和开场挪到「已发布」。
- **0.23（2026-11-18）** 官网切到 Yew 后：第四节写明产品页有安装命令、源代码和安卓版，「已实现、还没发布」补上侧栏吉祥物和开场；`url` 填上 GitHub 仓库（平台组提醒）。
- **0.22（2026-11-18）** 产品改名 Yew（蓝图 1.15、1.16）：全文的 Jig 改成 Yew，安装命令改成 `@tenonai/yew`（发布后），仓库地址改成 Yew 的。平台组同步官网时一并换名字、标志和下载链接，等 Yew 的第一个版本发布再上线。
- **0.21（2026-11-18）** MCP 一条补上：会发送、发布或删除东西的工具每次都问。
- **0.20（2026-11-18）** 新增会话分叉、回溯、消息下的操作（时间、复制、回溯、分叉）、常用 MCP 服务的一键添加和助手（轻量子代理）。产物链接还没做，不写。
- **0.19（2026-11-16）** 新增自带的浏览器和电脑操控（两个 MCP 服务，默认装载）。
- **0.18（2026-11-16）** 新增服务商的连接测试（余额查看做过又去掉了，不写）；长任务的稳健性修复不改对外的说法。
- **0.17（2026-11-16）** 1.1.0：新增用量页、会话关系页、会话进度和审批等待时间，设置补全（MCP 服务、技能、搜索密钥、中继地址、通知类别、新会话默认值、启动），数据管理加占用一览、导出和清理临时文件。第四节补上这些能力的写法。
- **0.16（2026-11-15）** 英文界面的服务商分组改叫 Chinese providers / Other providers（法务组：分组按服务商所属的公司，不表示服务器在哪），`models` 的英文 alt 跟着改。五种桌面截图按 1.0.2 的界面重拍，侧栏带上产物入口，官网已整套换上（官网提交 48abb75）；`phone` 没有重拍。
- **0.15（2026-11-15）** 安卓版 1.0.1 的安装包发布到 GitHub 和 Gitee 的 Releases（创始人：「ipa 还是走官方路径吧，我们就分发 apk」）。安卓版从「没实现，不写」移出，写明下载指向官网 Jig 页的「安卓版」一节、哪些没在真机上验过；iPhone 仍不写成可以下载。
- **0.14（2026-11-15）** Jig 开源，发布 1.0.0：去掉「只供内部使用」的说法，可以写开源和 npm 安装。
- **0.13（2026-11-15）** M3、M4 的能力做完：通知、产物、技能和记忆目录、MCP、联网搜索、数据导出移到「已实现、还没发布」，写明哪些没在真机或真实接口上验过。官网条目要不要改由平台组看。
- **0.12（2026-11-14）** 每日费用上限和开机启动已实现，从「没实现，不写」移到「已实现、还没发布」。官网条目不用改。
- **0.11（2026-11-11）** 创始人把界面那句改为「优雅克制的交互界面，顺畅丝滑的用户体验。」（原「用户页面」，总办转达；官网提交 efc1d4e，产品规范 14.2.1 同步）。第六节跟着改，英文不变。
- **0.10（2026-11-11）** 创始人定「session engineering 换成 Session Engineering。专有名词」（总办转达，官网提交 9beb0ff）。全文改成大写，第五节加上这条写法；README、蓝图、更新记录和网页、iPhone 关于页的介绍一起改了。
- **0.9（2026-11-11）** 官网按创始人的调整更新产品页（官网提交 703d757、4477683、5d6faa1）：取消导航条，第 4、5 条配上手机审批和模型选择的截图，产品目录只留在用的字段，首页卡片只有标志和一句话定义。第六、七节同步这些变化；第四节不再提已删掉的 `status`；第五节和主张注明规范 14.2.1。
- **0.8（2026-11-11）** 官网产品页按创始人定的结构重做（官网提交 5d7cd3e）。第六节改记新页面：创始人定稿的五条主张、界面那句、导航、链接和邀请卡片，去掉页面上已不显示的首屏介绍、问题、设计和要点；第二节写明官网的摘要按主张另写；第四节按创始人的决定写明 A2A 指会话之间的异步信箱；第五节写明定稿里的比喻照原样用；第七节加上手机审批和模型选择两种截图，原图放在 `docs/screenshots/`。
- **0.7（2026-11-11）** 创始人说「Jig 的手机审批很快就上了，没必要过于强调现在没上就不能写」（平台组会话）。第四节由「只写已经发布的」改成已经实现的能力都能写、不加「目前」「暂未」，放开手机审批和定时任务；写明写手机和模型时要守的事实，A2A 列入不写。
- **0.6（2026-11-11）** 创始人说「Jig 的介绍太冗长」，平台组把官网的摘要和首屏介绍压短（官网提交 b863499），本文第二、六节同步成新写法；README 和关于页的简介跟着换成同一句。
- **0.5（2026-11-10）** Jig 已在官网公开（官网提交 c2d865f）。产品库取消了公开标记，删去 `featured` 一行；记下详情页的分段和导航。
- **0.4（2026-11-09）** 截图按官网详情页的版面重拍：审批中心（一张授权卡加一张决定卡）、主对话、代码会话里的授权卡、信件列表，2560×1440；第七节写明每张的位置和中英文 alt。
- **0.3（2026-11-09）** 按创始人给的方向重写定位：Jig 推的是 Session Engineering 的做法，会话分主次，人只对接主对话、在审批中心处理要人做的事，不用逐个进入会话。重写第二、三、五、六节，第七节写明四种截图画面。
- **0.2（2026-11-09）** 记下产品库条目的现状（官网提交 0c2d448，不公开），以及改了本文要把提交号告诉平台组。
- **0.1（2026-11-09）** 首版。创始人定 Jig 纳入 Tenon 产品库，让 Jig 会话给平台组写文案指导。
