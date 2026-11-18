# Yew Harness

AI 原生的多 Agent 工作台。

按 Session Engineering 的做法组织 Agent 会话：你只对接主对话，要你授权和决定的事都汇到审批中心。

每个会话有名字、职责、工作区、模型和权限，按团队组织：常设会话长期负责一块事，任务会话为一件事开设，做完回报，之后可以归档。会话之间用信件分派和回报。会话跑在你电脑上的 Yew Harness 服务里，网页关了也照常干活。

Yew Harness 以 MIT 许可证开源，当前版本 1.5.0。能做什么见[更新记录](CHANGELOG.md)，为什么这样做见[产品蓝图](docs/blueprint.md)。iPhone 应用的源码在 `ios/`，还没有上架；安卓版的源码在 `android/`，安装包见下面的「手机端」。

## 安装与快速开始

需要 macOS 或 Linux、Node.js 24 或更高版本和 ripgrep（macOS：`brew install ripgrep`）；Linux 上还要 bubblewrap 和 socat（Debian、Ubuntu：`sudo apt install ripgrep bubblewrap socat`）。Windows 请在 WSL 里使用。

1. 安装：`npm install -g @tenonai/yew`。
2. 存入一个模型服务商的 API Key（默认服务商是 DeepSeek）：`yew key set deepseek`。Key 只存进系统钥匙串。
3. 启动服务：`yew serve --open`，浏览器会打开网页界面。以后需要新的登录链接，运行 `yew open`。
4. 可选：`yew service install` 让 Yew Harness 登录后自动启动；macOS 上 `yew app install` 在「应用程序」里放一个 Yew Harness 图标。

从源码运行：克隆仓库后 `npm install`、`npm run build:web`、`npm link`。

## 手机端

手机上的 Yew Harness 只连接你自己电脑上的 Yew Harness：在电脑上显示二维码，手机扫码配对，之后在手机上看会话、处理审批中心里的事。两端经中继通信，内容端到端加密；默认用 Tenon AI 运行的中继，也可以自己部署（见 `relay/`）。

- 安卓：安装包（apk）在 [GitHub](https://github.com/dozybot001/Yew/releases) 和 [Gitee](https://gitee.com/dozybot/yew/releases) 的 Releases 里，由长沙榫卯人工智能科技有限公司签名。签名证书的 SHA-256 指纹是 `9F:F5:6E:EA:A8:3C:DC:01:BA:66:D8:79:23:9C:DE:5A:2A:69:C3:AE:D2:60:5C:D8:E1:B9:34:8D:BF:28:61:B2`；这个指纹也公布在[官网的 Yew Harness 页面](https://tenonai.cn/zh/products/yew/#android)上，可以对照；每个版本的说明里有安装包的 SHA-256。更新时系统如果提示签名不一致，不要安装。
- iPhone：还没有上架，之后经 TestFlight 和 App Store 发布。

## 隐私

Yew Harness 不收集任何数据，也不含统计、遥测或上报代码。会话、消息和设置存在你自己的电脑上，API Key 存在系统钥匙串里。你选用的模型服务商会收到发给它的对话内容，这部分适用该服务商的隐私政策。

## 安全

Yew Harness 还没有沙箱。按需授权和完全授权下，会话不问就跑的命令以你的系统账户运行，能做你在终端里能做的事，包括改 Yew Harness 自己的记录（决定和授权也在里面）、读它保存的 API Key。别的会话的信、网页、邮件和 MCP 返回的内容，Yew Harness 只当作数据，不能替你授权；但会话要处理这类外来内容时，建议给它用逐项授权，让命令每次都先问你。

## 文档

- [产品蓝图](docs/blueprint.md)：为什么做、做什么、不做什么、怎么验收
- [对外介绍](docs/introduction.md)：官网、商店和各渠道介绍 Yew Harness 时用的定义、简介和能写的能力
- 实现计划：[M1](docs/archive/m1-plan.md)、[M2](docs/archive/m2-plan.md)、[M3](docs/archive/m3-plan.md)
- [可借鉴的开源项目](docs/prior-art.md)
- [数据清单](docs/data-inventory.md)：Yew Harness 在你电脑上存了哪些数据、怎么删除
- [iPhone 应用上架](docs/app-store.md)：商店里填什么、进度
- [更新记录](CHANGELOG.md)
- [开发约定](AGENTS.md)

## 许可证

[MIT](LICENSE)。运行时依赖和网页界面里用到的第三方包见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 名称、标志和角色

Yew Harness、Yew 和榫卯 Tenon 的名称和标志（包括 `web/public/icons/`、`ios/Yew/Assets.xcassets/` 里的图标），以及角色 Yew 的形象和图片（包括 `web/public/mascot/`、`android/app/src/main/res/drawable-nodpi/` 里的图片和 `ios/Yew/Assets.xcassets/` 里 Mascot 开头的图片），不在 MIT 许可证的授权范围内。你可以照原样提到这些名称，说明你在使用 Yew Harness 或基于它修改；但不要把这些名称和标志用作你自己产品的名称或标志，不要在你自己的产品里使用 Yew 的形象和图片，也不要让人以为你的产品来自榫卯 Tenon AI 或得到它的认可。

Names, logos and the character: The Yew Harness, Yew and Tenon AI names and logos, including the icons in `web/public/icons/` and `ios/Yew/Assets.xcassets/`, and the design and images of the character Yew, including the images in `web/public/mascot/` and `android/app/src/main/res/drawable-nodpi/` and the Mascot images in `ios/Yew/Assets.xcassets/`, are not licensed under the MIT License. You may refer to the names as they are to say that you use Yew Harness or that your work is based on it, but do not use the names or logos as the name or logo of your own product, do not use the character's design or images in your own product, and do not suggest that your product comes from or is endorsed by Tenon AI.

## 出品方

榫卯 Tenon AI · [tenonai.cn](https://tenonai.cn/)
