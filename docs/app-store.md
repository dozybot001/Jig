# Jig iPhone 应用上架

版本 0.1（2026-11-15）。创始人 2026-11-15 定「Jig iPhone 应用推进上架」（产品组转达）。本文记上架要填的内容和进度；文案以[对外介绍](introduction.md)为准，规范见第 17 节。提交审核和首次上线前请创始人确认一次。

## 一、进度

| 步骤 | 状态 |
| --- | --- |
| 工程：自动签名，Team `3U6LT38JKB`，Bundle ID `cn.tenonai.apps.jig`（通知扩展 `.push`） | 已有 |
| 归档并导出 App Store 用的包（云端管理的分发证书） | 11-15 在本机试过，成功，没有上传 |
| 出口合规：`ITSAppUsesNonExemptEncryption = NO` | 已写进工程（cef51bb） |
| App Store Connect 里建应用记录 | 没做，要创始人登录 |
| 商店文案、截图、隐私标签、审核说明 | 文案见第二节；截图没拍（要 6.9 英寸，1320×2868） |
| 隐私政策网址、技术支持网址 | 等平台组给官网上的地址 |
| 上传到 TestFlight | 没做 |
| 提交审核 | 没做，要创始人确认 |

## 二、商店里填什么

| 项 | 中文 | English |
| --- | --- | --- |
| 名称 | Jig | Jig |
| 副标题 | AI 原生的多 Agent 工作台 | An AI-native multi-agent workbench |
| 类别 | 开发者工具 | Developer Tools |
| 年龄分级 | 4+ | 4+ |
| 价格 | 免费，没有内购 | Free, no in-app purchases |
| 销售范围 | 先不含中国大陆（App 备案推后，规范 17.9），拿到备案号后再开 | |

描述（中文）：

> AI 原生的多 Agent 工作台。
>
> 按 Session Engineering 的做法组织 Agent 会话：你只对接主对话，要你授权和决定的事都汇到审批中心。
>
> Jig 运行在你自己的电脑上。这个应用是它的手机端：离开电脑时，在手机上允许或拒绝操作、回答会话的提问、做决定、放行或拒收暂存的信；也能看会话记录、信件和产物，给会话发消息，让干活的会话停下。有事要你处理、会话出错、任务做完时会通知你。
>
> 使用前要在电脑上安装 Jig（npm install -g @tenonai/jig），打开「手机访问」，用手机扫码配对。手机经中继连到你的电脑，两端之间端到端加密，中继只转发密文。电脑上要开着 Jig。
>
> 没有电脑也可以点「看演示」，用内置的演示数据看一遍。
>
> Jig 以 MIT 许可证开源。

Description (English):

> An AI-native multi-agent workbench.
>
> Agent sessions organized the Session Engineering way: you deal only with the main conversation, and everything that needs your approval or decision comes to the approval center.
>
> Jig runs on your own computer. This app is its phone side: away from the computer, allow or decline an operation, answer a session's question, make a decision, release or refuse a held letter; read sessions, letters and artifacts, send a session a message, or stop one that is working. You are notified when something needs you, a session fails, or a task is done.
>
> First install Jig on your computer (npm install -g @tenonai/jig), turn on phone access, and scan the pairing code with your phone. The phone reaches your computer through a relay; the two ends are encrypted end to end and the relay only passes ciphertext along. Jig has to be running on the computer.
>
> Without a computer, tap "Try the demo" to look around with built-in demo data.
>
> Jig is open source under the MIT License.

关键词：`Agent,AI,多Agent,审批,会话,开发者,Session Engineering` / `agent,AI,multi-agent,approval,sessions,developer,session engineering`

## 三、隐私标签和出口合规

- **隐私标签**：「未收集数据」。应用不向我们发送任何数据，没有统计和上报；手机只连用户自己的电脑。隐私清单 `PrivacyInfo.xcprivacy` 里收集的数据类型为空，只声明了 UserDefaults（CA92.1）。推送令牌由应用交给用户自己的电脑，再经中继交给 Apple 发通知；中继只在转发时经手，不保存（隐私政策里写了）。这一项是否仍按「未收集」答，请法务组看。
- **出口合规**：只用系统的 CryptoKit 做端到端加密，按「只用系统加密」答，不用交文件（法务组 2026-11-14）。
- **跟踪**：不跟踪。

## 四、审核说明

不用登录，没有账号。审核时点首页的「看演示」（Try the demo），用内置的演示数据可以看到全部页面：会话、审批、信件、产物和设置。真实使用要在电脑上运行开源的 Jig 并扫码配对，说明里附仓库地址 https://github.com/dozybot001/Jig 。相机只用于扫配对二维码。

## 修改记录

- **0.1（2026-11-15）** 首版。
