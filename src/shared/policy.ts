/**
 * Jig's privacy policy and terms of service (spec 11.1): one text for Jig on the Mac and on iPhone.
 * The iPhone app carries the same paragraphs in its string catalog; test/ios.test.ts keeps them equal.
 * A change raises the version and the date; earlier versions stay in Git.
 */
export const POLICY_VERSION = "1.6";

export const POLICY = {
	zh: {
		date: "2026 年 11 月 15 日",
		privacy: [
			"Jig 是在你自己的电脑上运行的软件，iPhone 上的 Jig 只连接你自己电脑上的 Jig。榫卯 Tenon AI 不收集、不接收你在 Jig 里的内容，Jig 里没有统计、遥测或上报代码。",
			"保存在你电脑上的数据：会话、消息、工具调用记录、操作授权、会话之间的信件、你在审批中心做的决定、定时任务和设置存在 Jig 的数据目录（默认 ~/.jig）里的数据库中；服务商的 API Key 存在系统钥匙串里；超长的命令输出存在数据目录的 tmp 文件夹里。用 jig service 设了开机启动时，运行日志（启动、出错和连接中继的记录，不含对话内容）存在数据目录的 logs 文件夹里。这些数据一直保存，直到你删除。你在设置里指定了审批记录文件时，Jig 把每个决定追加到那个文件里。",
			"手机访问：你在电脑上打开「允许手机访问」后，电脑上的 Jig 连接中继服务，iPhone 上的 Jig 经中继和它通信。默认的中继由榫卯 Tenon AI 运行，你也可以自己部署。两端之间端到端加密，中继只转发密文，看不到也不保存内容。榫卯 Tenon AI 运行的中继为保障网络安全记录连接日志：时间、IP 地址、请求的路径（其中有你电脑的标识，是它公钥的哈希）和状态，不含内容，保存 184 天后自动删除。中继服务器位于中国境内。电脑上的 Jig 记下配对的手机：名称、公钥、配对时间和最近连接的时间。iPhone 上的 Jig 把配对信息和自己的密钥存在 iOS 钥匙串里，只存在这台设备上。打开通知后，iPhone 把 Apple 给它的推送令牌经加密通道交给你的电脑保存；电脑把通知的内容为这台 iPhone 加密，经中继交给 Apple 的推送服务。中继和 Apple 经手推送令牌和密文，看不到通知的内容。",
			"发给第三方的数据：你为会话选的模型服务商会收到发给它的对话内容，包括会话读到的文件和命令输出，这部分适用该服务商的隐私政策。默认服务商 DeepSeek 在中国境内；你选境外服务商时，这些内容会发往境外。会话抓取网页时，网站会收到请求。",
			"查询、导出与删除：你可以直接查看数据目录里的文件。删除某个服务商的 Key：在设置里删除，或运行 jig key delete；删除配对的手机：在电脑上的「手机访问」里移除，或在 iPhone 上断开配对；删除全部数据：停掉 jig serve 后删除数据目录。",
			"联系我们：support@tenonai.cn。",
		],
		terms: [
			"Jig 目前还没有公开发布，只供榫卯 Tenon AI 内部使用。v1 验收后会以开源许可证（MIT 或 Apache-2.0）发布，届时开源许可证就是 Jig 的用户协议。",
			"Jig 会按你的授权读写文件、执行命令和访问网络。请为会话选择合适的工作区和权限规则；删除文件、推送、发布等操作每次都会先问你。",
		],
	},
	en: {
		date: "Nov 15, 2026",
		privacy: [
			"Jig runs on your own computer, and Jig on iPhone connects only to Jig on your own computer. Tenon AI does not collect or receive your content in Jig, and Jig contains no analytics, telemetry or reporting code.",
			"Data kept on your computer: sessions, messages, tool call records, permissions you granted, letters between sessions, the decisions you make in the approval center, scheduled tasks and settings are stored in a database in Jig's data folder (~/.jig by default); provider API keys are stored in the system keychain; very long command output is stored in the tmp folder of the data folder. When you set Jig to start at login with jig service, its service log (start-up, errors and relay connection lines, without conversation content) is stored in the logs folder of the data folder. This data stays until you delete it. If you set a decision log file in Settings, Jig adds each decision to that file.",
			"Phone access: when you turn on phone access on your computer, Jig on the computer connects to a relay, and Jig on iPhone talks to it through the relay. The default relay is run by Tenon AI; you can also run your own. The two ends are encrypted end to end: the relay only passes ciphertext along and can neither read nor keep the content. For network security, the relay run by Tenon AI keeps a connection log: the time, the IP address, the path requested (which carries your computer's identifier, a hash of its public key) and the status, without content, deleted automatically after 184 days. The relay server is in mainland China. Jig on the computer records each paired phone: its name, public key, when it was paired and when it last connected. Jig on iPhone keeps the pairing and its own key in the iOS keychain, on that device only. With notifications on, Jig on iPhone gives the push token it got from Apple to your computer over the encrypted channel, and the computer keeps it; the computer encrypts what a notification says for that iPhone and hands it to Apple's push service through the relay. The relay and Apple handle the push token and the ciphertext, and cannot read what the notification says.",
			"Data sent to third parties: the model provider you choose for a session receives the conversation sent to it, including files the session read and command output; that provider's privacy policy applies. The default provider, DeepSeek, is in mainland China; if you choose a provider outside mainland China, this content goes abroad. When a session fetches a web page, that site receives the request.",
			"Access, export and deletion: you can look at the files in the data folder directly. To delete a provider's key, delete it in Settings or run jig key delete; to remove a paired phone, remove it under Phone access on the computer, or unpair on the iPhone; to delete everything, stop jig serve and delete the data folder.",
			"Contact: support@tenonai.cn.",
		],
		terms: [
			"Jig has not been released publicly yet and is for internal use at Tenon AI. After v1 is accepted it will be released under an open source license (MIT or Apache-2.0); that license will then be Jig's terms of service.",
			"Jig reads and writes files, runs commands and goes online as you allow. Choose a suitable workspace and permission rules for each session; deleting files, pushing, publishing and similar operations always ask you first.",
		],
	},
} as const;
