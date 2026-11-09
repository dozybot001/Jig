# Jig

AI 原生的多 Agent 工作台。

在 Jig 里，一个人和一组 Agent 会话一起做事。每个会话是一个有名字、有职责的成员，有自己的工作区、模型和权限；按部门组织，常设会话长期负责一块事，任务会话为一件事开设，做完可以归档。

会话跑在你电脑上的 Jig 服务里，网页关了也照常干活。你不用逐个盯着对话，只处理会话停下来找你的事：需要你批准的操作，和只有你能回答的问题。

Jig 还在开发中，只在内部使用。第一个里程碑 M1（Agent 循环、工具、模型切换、权限、会话与部门、电脑端网页界面）已经验收，版本 0.1.0；第二个里程碑 M2（会话之间的信件、主对话、审批中心、子会话）已经写完，正在验收。要做什么、不做什么见[产品蓝图](docs/blueprint.md)。

## 安装与快速开始

目前只能从源码运行。需要 macOS、Node.js 24 或更高版本和 ripgrep（`brew install ripgrep`）。

1. 在仓库目录安装依赖，并构建网页界面：`npm install`，然后 `npm run build:web`。
2. 让 `jig` 命令可用：`npm link`。
3. 存入一个模型服务商的 API Key（默认服务商是 DeepSeek）：`jig key set deepseek`。Key 只存进系统钥匙串。
4. 启动服务：`jig serve`，然后用它打印的链接打开网页界面。以后需要新的登录链接，运行 `jig open`。

## 隐私

Jig 不收集任何数据，也不含统计、遥测或上报代码。会话、消息和设置存在你自己的电脑上，API Key 存在系统钥匙串里。你选用的模型服务商会收到发给它的对话内容，这部分适用该服务商的隐私政策。

## 文档

- [产品蓝图](docs/blueprint.md)：为什么做、做什么、不做什么、怎么验收
- [M1 实现计划](docs/m1-plan.md)
- [可借鉴的开源项目](docs/prior-art.md)
- [数据清单](docs/data-inventory.md)：Jig 在你电脑上存了哪些数据、怎么删除
- [更新记录](CHANGELOG.md)
- [开发约定](AGENTS.md)

## 许可证

尚未开源。v1 验收后开源，许可证在 MIT 和 Apache-2.0 之间选定。

## 出品方

榫卯 Tenon AI · [tenon.asia](https://tenon.asia/)
