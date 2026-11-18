# Yew iPhone 应用上架

版本 0.11（2026-11-18）。创始人 2026-11-15 定「Jig iPhone 应用推进上架」（产品组转达）。本文记上架要填的内容和进度；文案以[对外介绍](introduction.md)为准，规范见第 17 节。提交审核和首次上线前请创始人确认一次。

## 一、进度

2026-11-18 产品改名 Yew（蓝图 1.15、1.16），iPhone 应用的 Bundle ID 改成 `cn.tenonai.apps.yew`（通知扩展 `.push`）。App Store Connect 的记录跟 Bundle ID 绑定，换不了，所以 Yew 另建一条记录（创始人 11-18：「现在建，先不提交」），第二节的内容照着重填、截图重拍，11-16 被拒时要求补的审核录像也要在新记录里交。Yew 新记录的进度：

| 步骤 | 状态 |
| --- | --- |
| App Store Connect 里的应用记录 | 11-18 建好，Apple ID `6836027493`，SKU `yew-ios`，主要语言英语（美国），另有简体中文的本地化。「Yew」单独一个词已被别的应用占用，名称用「Yew — Multi-Agent Workbench」，中文「Yew — 多 Agent 工作台」 |
| 应用信息：名称、副标题、类别（开发者工具）、内容版权（不含第三方内容）、隐私政策网址 | 已填，照 Jig 的记录，网址换成官网 `/products/yew/` 下的页面（官网切换前这些地址会跳到 Jig 的页面） |
| 年龄分级问卷 | 已填，答案和 Jig 的记录相同，算出来是 4+ |
| 版本页：版本号 1.3.0、描述、关键词、技术支持和营销网址、版权；发布方式「自动发布」 | 英文和简体中文已填；截图已传，中英各 5 张，放在「带灵动岛的 iPhone（中等显示屏）」一档 |
| 审核信息 | 联系人照 Jig 的记录；备注照 4.1 换成 Yew 的名字、安装命令和仓库地址；录像还没录 |
| 构建 | 1.3.0（1）对应提交 3683338（标签 v1.3.0），11-18 上传，处理完已挂到 1.3.0 版本上；出口合规按工程里的设置自动答「不使用」；内部测试组可以装 |
| 价格和销售范围 | 照 Jig 的记录：免费；174 个国家和地区，不含中国大陆；以后新增的国家和地区自动上架 |
| App 隐私 | 照 Jig 的记录：一项「设备 ID」，用途「App 功能」，不关联身份，不用于跟踪；答复已发布 |
| TestFlight | 内部测试组「Team」，只有创始人，能看到所有构建；邀请已发，创始人接受后在 iPhone 的 TestFlight 里装审核的构建、录审核录像 |
| 提交审核 | 不提交（创始人 11-18：「现在建，先不提交」） |

下表是 Jig 那条旧记录删除前的进度。创始人 11-18 先说「Jig 转移完后可以删除」，确认时回了「删除」，当天就删了。删之前按苹果的要求做了三步：取消 11-16 被拒的那次提交；在全部国家和地区下架（没上架过的也要下架）；关掉「以后新增的国家和地区自动上架」。删完后它在 App Store Connect 的「已移除的 App」里。按苹果的说明，名称没被别人占用时还能恢复；SKU `jig-ios` 和 Bundle ID `cn.tenonai.apps.jig` 不能再用。

| 步骤 | 状态 |
| --- | --- |
| 工程：自动签名，Team `3U6LT38JKB`，Bundle ID `cn.tenonai.apps.jig`（通知扩展 `.push`） | 已有 |
| 出口合规：`ITSAppUsesNonExemptEncryption = NO`；隐私清单申报设备 ID | 已写进工程 |
| App Store Connect 里的应用记录 | 11-15 建好，Apple ID `6835049683`，SKU `jig-ios`，主要语言英语（美国），另有简体中文的本地化 |
| 构建 | 1.0.3（1）11-15 上传，对应提交 d949b40。11-18 改用 1.2.0（1），对应提交 de3368f（和 1.0.3 比只有版本号和隐私政策 2.3 的文字），商店里的版本号也从 1.0.3 改成了 1.2.0 |
| 版本页：描述、关键词、技术支持和营销网址、版权、审核备注、截图 | 英文和简体中文都已填并保存，各 5 张截图；「需要登录」已取消；发布方式是「自动发布」（创始人 11-15：「定自动发布即可」） |
| 应用信息：名称、副标题、类别（软件开发工具）、内容版权（不含第三方内容） | 已填并保存 |
| 年龄分级问卷 | 已填：各项如实答「无 / 否」，算出来是 4+ |
| App 隐私 | 隐私政策网址已填；数据类型一项「设备 ID」，用途「App 功能」，不关联身份，不用于跟踪；答复已发布。简体中文的隐私政策网址另填了中文页 |
| 价格和销售范围 | 免费；174 个国家和地区，不含中国大陆（创始人 11-15：「加个免费，销售范围不包含中国大陆」） |
| 审核联系人 | 已填，用的是创始人在 WeSaid 那个应用里填的同一组 |
| 提交审核 | 11-15 已提交。11-16 被拒：2.1「需要更多信息」，不是功能问题，要求在审核备注里补五项说明（用途和用户、怎样审核、用到的外部服务、地区差异、是否受监管行业），并附一段在真机、最新系统上录的屏幕录像，从启动应用开始演示典型用法。11-18 备注已按五项改写（见第四节）；录像待创始人在 iPhone 上录，录好后作为审核附件上传，再经创始人确认重新提交 |
| TestFlight | 11-18 建了内部测试组「Team」，只有创始人，用来在真机上装审核的构建 |

商店里的名称：「Jig」已被别的应用占用，现在用的是「Jig — Multi-Agent Workbench」。副标题限 30 个字符，一句话定义的英文放不下（34 个），现在填的是「Approve your agents' requests」。两处提交前都能改，由创始人定。

截图：App Store Connect 现在以 6.3 英寸（1206×2622）为准，用 iPhone 17 Pro 模拟器拍，启动参数 `-YewDemo YES`、`-YewTab <approvals|letters|artifacts>`、`-YewSession website` 直接进演示的各页，状态栏统一为 9:41、满格、满电。五张：审批、会话列表、会话、信件、产物；中英文各一套。原图不入库，要用时重拍。

## 二、商店里填什么

| 项 | 中文 | English |
| --- | --- | --- |
| 名称 | Yew — 多 Agent 工作台（「Yew」单独一个词已被别的应用占用） | Yew — Multi-Agent Workbench |
| 副标题（限 30 个字符） | AI 原生的多 Agent 工作台 | Approve your agents' requests |
| 类别 | 开发者工具 | Developer Tools |
| 年龄分级 | 4+（照问卷如实答的结果） | 4+ |
| 价格 | 免费，没有内购 | Free, no in-app purchases |
| 销售范围 | 先不含中国大陆（App 备案推后，规范 17.9），拿到备案号后再开 | |
| 版权 | 公司英文全称，和 PassBy 相同 | 2026 Changsha Tenon Artificial Intelligence Technology Co., Ltd. |

描述（中文）：

> AI 原生的多 Agent 工作台。
>
> 按 Session Engineering 的做法组织 Agent 会话：你只对接主对话，要你授权和决定的事都汇到审批中心。
>
> Yew 运行在你自己的电脑上。这个应用是它的手机端：离开电脑时，在手机上允许或拒绝操作、回答会话的提问、做决定、放行或拒收暂存的信；也能看会话记录、信件和产物，给会话发消息，让干活的会话停下。有事要你处理、会话出错、任务做完时会通知你。
>
> 使用前要在电脑上安装 Yew（npm install -g @tenonai/yew），打开「手机访问」，用手机扫码配对。手机经中继连到你的电脑，两端之间端到端加密，中继只转发密文。电脑上要开着 Yew。
>
> 没有电脑也可以点「看演示」，用内置的演示数据看一遍。
>
> Yew 以 MIT 许可证开源。

Description (English):

> An AI-native multi-agent workbench.
>
> Agent sessions organized the Session Engineering way: you deal only with the main conversation, and everything that needs your approval or decision comes to the approval center.
>
> Yew runs on your own computer. This app is its phone side: away from the computer, allow or decline an operation, answer a session's question, make a decision, release or refuse a held letter; read sessions, letters and artifacts, send a session a message, or stop one that is working. You are notified when something needs you, a session fails, or a task is done.
>
> First install Yew on your computer (npm install -g @tenonai/yew), turn on phone access, and scan the pairing code with your phone. The phone reaches your computer through a relay; the two ends are encrypted end to end and the relay only passes ciphertext along. Yew has to be running on the computer.
>
> Without a computer, tap "Try the demo" to look around with built-in demo data.
>
> Yew is open source under the MIT License.

关键词：`Agent,AI,多Agent,审批,会话,开发者,Session Engineering` / `agent,AI,multi-agent,approval,sessions,developer,session engineering`

## 三、隐私标签和出口合规

- **隐私标签**（法务组 2026-11-15）：申报一项「标识符 › 设备 ID」，用途「App 功能」，不关联到用户身份，不用于跟踪。原因是默认中继的连接日志：IP 地址和带电脑标识（公钥哈希）的请求路径保留 184 天，按 Apple 的定义算收集，隐私政策里也写着。推送令牌只在中继转发时经手、不保存，不算收集。标签按默认中继填；用户自己部署中继时我们什么都收不到。隐私清单 `PrivacyInfo.xcprivacy` 同步声明了这一项，另声明了 UserDefaults（CA92.1）。
- **出口合规**：只用系统的 CryptoKit 和 Security，没有第三方包，按「只用系统加密」答，不用交文件（法务组 2026-11-14，11-15 核过工程）。以后引入第三方加密库或自己实现算法时要重新看。
- **年龄分级问卷**（法务组）：不预设 4+。照实答：应用展示用户电脑上的模型生成的内容；产物里的 HTML 在不联网的网页视图里打开。
- **卖家名**：开发者账号是个人账号，商店里的卖家名显示创始人的姓名，转成公司账号之前改不了；提交前请他确认时一并说明。
- **跟踪**：不跟踪。

## 四、审核说明

### 4.1 11-18 改写的审核备注（英文，填在「App 审核信息 → 备注」）

按苹果 11-16 的要求分六段：录像说明、用途和用户、怎样审核（不用 Mac 时点「Try the demo」；用 Mac 时装 Yew 并扫码配对）、外部服务（中继、Apple 推送、模型服务商由用户在电脑上自选、相机只扫码）、地区（各地一样，暂不在中国大陆提供）、监管（不适用）。全文以 App Store Connect 里保存的为准。

### 4.2 审核录像怎样录

苹果要求在真机、最新系统上录，从启动应用开始。电脑端用 `node scripts/review-demo.ts <新文件夹>`：一个临时的 Yew，不碰 `~/.yew` 和钥匙串，用 `scripts/demo-model.ts` 这个按脚本应答的本地模型代替真实模型，起来后 Website 会话在等删除草稿页的审批，Docs 会话在问发布说明写哪个版本。手机在 TestFlight 装审核的构建，录的顺序：启动 → 「Try the demo」看一遍 → 退出演示 → 扫 Mac 上的配对二维码 → 批准删除、回答问题 → 在 Website 会话里发「Run the tests」→ 看产物和信件 → 设置里的隐私政策 → 断开配对。

### 4.3 原来的说明（11-15）

不用登录，没有账号。审核时点首页的「看演示」（Try the demo），用内置的演示数据可以看到全部页面：会话、审批、信件、产物和设置。真实使用要在电脑上运行开源的 Jig 并扫码配对，说明里附仓库地址 https://github.com/dozybot001/Jig 。相机只用于扫配对二维码。通知由 Apple 推送服务送达，内容在用户的电脑上加密，我们的中继只转发密文。

## 修改记录

- **0.11（2026-11-18）** 创始人确认后，Jig 的旧记录已删除；记下删除前要做的三步。
- **0.10（2026-11-18）** 创始人在 Xcode 里登录后，1.3.0（1）已上传并挂到版本上；第二节补上版权一栏（公司英文全称，法务组提醒核对）。
- **0.9（2026-11-18）** 创始人重新登录后，Yew 新记录填好价格和销售范围、App 隐私，传了截图，建了 TestFlight 内部测试组；构建还没传上去，因为 Xcode 里没有 Apple 账号。创始人：「Jig 转移完后可以删除」，Jig 旧记录改为转移完后删除。
- **0.8（2026-11-18）** Yew 的新记录建好，应用信息、年龄分级、版本页文字和审核信息已照 Jig 的记录填好；记下「Yew」单独一个词被占用；构建上传和价格、隐私等几项等创始人重新登录。
- **0.7（2026-11-18）** 改名 Yew：Bundle ID 改成 `cn.tenonai.apps.yew`，要另建 App Store Connect 记录；第二节和审核备注改成 Yew 的名字和安装命令，旧记录的进度留作记录。
- **0.6（2026-11-18）** 11-16 被拒（2.1 需要更多信息）。改用 1.2.0 的构建，商店版本号改成 1.2.0；审核备注按苹果要的五项改写；记下录像的录法和演示电脑端的脚本；建了 TestFlight 内部测试组。
- **0.5（2026-11-15）** 创始人：「定自动发布即可」。发布方式改成自动发布，1.0.3 已提交审核。
- **0.4（2026-11-15）** 创始人：「加个免费，销售范围不包含中国大陆」「其他的你应填尽填」。价格、销售范围、年龄分级、内容版权、App 隐私、简体中文的本地化、构建和审核联系人都已填，只剩提交审核。
- **0.3（2026-11-15）** 应用记录建好，1.0.3 的构建已上传，英文的版本页和应用信息已填；记下名称被占用、副标题的字数限制和截图的拍法。
- **0.2（2026-11-15）** 按法务组的意见：隐私标签改为申报「设备 ID」（默认中继的连接日志），隐私清单同步；年龄分级照问卷如实答；审核说明加上通知怎样送达；记下卖家名显示个人姓名。
- **0.1（2026-11-15）** 首版。
