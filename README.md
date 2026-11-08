# Jig

AI 原生的多 Agent 工作台。

AI 原生指一个人和一组 Agent 会话一起工作：除了你自己，团队里的其他成员都是 Agent 会话。

## 状态

开发中，还没有发布版本。第一个里程碑 M1 的功能已经写完，正在验收：Agent 循环、工具、模型切换、权限、会话与分组，以及电脑端网页界面。要做什么、不做什么见[产品蓝图](docs/blueprint.md)，M1 的做法见 [M1 实现计划](docs/m1-plan.md)。

## 安装与快速开始

目前只能从源码运行。需要 macOS、Node.js 24 或更高版本和 ripgrep（`brew install ripgrep`）。

1. 在仓库目录安装依赖，并构建网页界面：`npm install`，然后 `npm run build:web`。
2. 让 `jig` 命令可用：`npm link`。
3. 存入一个模型服务商的 API Key（默认服务商是 DeepSeek）：`jig key set deepseek`。Key 只存进系统钥匙串。
4. 启动服务：`jig serve`，然后用它打印的链接打开网页界面。以后需要新的登录链接，运行 `jig open`。

## 隐私

Jig 不收集任何数据。会话、消息和产物都存在你自己的电脑上，API Key 存在系统钥匙串里。你选用的模型服务商会收到发给它的对话内容，这部分适用该服务商的隐私政策。

## 文档

- [产品蓝图](docs/blueprint.md)：为什么做、做什么、不做什么、怎么验收
- [M1 实现计划](docs/m1-plan.md)
- [可借鉴的开源项目](docs/prior-art.md)
- [开发约定](AGENTS.md)

## 许可证

尚未开源。v1 验收后开源，许可证在 MIT 和 Apache-2.0 之间选定。

## 出品方

榫卯 Tenon AI · [tenon.asia](https://tenon.asia/)
