# Jig

AI 原生的多 Agent 工作台。

按 Session Engineering 的做法组织 Agent 会话：你只对接主对话，要你授权和决定的事都汇到审批中心。

每个会话有名字、职责、工作区、模型和权限，按团队组织：常设会话长期负责一块事，任务会话为一件事开设，做完回报，之后可以归档。会话之间用信件分派和回报。会话跑在你电脑上的 Jig 服务里，网页关了也照常干活。

Jig 以 MIT 许可证开源，当前版本 1.0.0。能做什么见[更新记录](CHANGELOG.md)，为什么这样做见[产品蓝图](docs/blueprint.md)。iPhone 应用的源码在 `ios/`，还没有上架；安卓版在 `android/`，在开发中。

## 安装与快速开始

需要 macOS 或 Linux、Node.js 24 或更高版本和 ripgrep（macOS：`brew install ripgrep`）。Windows 请在 WSL 里使用。

1. 安装：`npm install -g @tenonai/jig`。
2. 存入一个模型服务商的 API Key（默认服务商是 DeepSeek）：`jig key set deepseek`。Key 只存进系统钥匙串。
3. 启动服务：`jig serve --open`，浏览器会打开网页界面。以后需要新的登录链接，运行 `jig open`。
4. 可选：`jig service install` 让 Jig 登录后自动启动；macOS 上 `jig app install` 在「应用程序」里放一个 Jig 图标。

从源码运行：克隆仓库后 `npm install`、`npm run build:web`、`npm link`。

## 隐私

Jig 不收集任何数据，也不含统计、遥测或上报代码。会话、消息和设置存在你自己的电脑上，API Key 存在系统钥匙串里。你选用的模型服务商会收到发给它的对话内容，这部分适用该服务商的隐私政策。

## 文档

- [产品蓝图](docs/blueprint.md)：为什么做、做什么、不做什么、怎么验收
- [对外介绍](docs/introduction.md)：官网、商店和各渠道介绍 Jig 时用的定义、简介和能写的能力
- 实现计划：[M1](docs/archive/m1-plan.md)、[M2](docs/archive/m2-plan.md)、[M3](docs/archive/m3-plan.md)
- [可借鉴的开源项目](docs/prior-art.md)
- [数据清单](docs/data-inventory.md)：Jig 在你电脑上存了哪些数据、怎么删除
- [更新记录](CHANGELOG.md)
- [开发约定](AGENTS.md)

## 许可证

[MIT](LICENSE)。运行时依赖和网页界面里用到的第三方包见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 名称和标志

Jig 和榫卯 Tenon 的名称和标志（包括 `web/public/icons/`、`ios/Jig/Assets.xcassets/` 里的图标）不在 MIT 许可证的授权范围内。你可以照原样提到它们，说明你在使用 Jig 或基于它修改；但不要把它们用作你自己产品的名称或标志，也不要让人以为你的产品来自榫卯 Tenon AI 或得到它的认可。

Name and logos: The Jig and Tenon AI names and logos, including the icons in `web/public/icons/` and `ios/Jig/Assets.xcassets/`, are not licensed under the MIT License. You may refer to them as they are to say that you use Jig or that your work is based on it, but do not use them as the name or logo of your own product, or in a way that suggests your product comes from or is endorsed by Tenon AI.

## 出品方

榫卯 Tenon AI · [tenonai.cn](https://tenonai.cn/)
