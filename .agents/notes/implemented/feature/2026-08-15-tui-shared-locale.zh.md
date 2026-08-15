# Agent Note: Web 与 TUI 共用语言偏好

Status: implemented

[English](2026-08-15-tui-shared-locale.md) | 中文

## 问题

浏览器已经持久化 `locale.preference`，但随附终端只有英文界面文案，也没有语言操作。若把浏览器的 React locale runtime 直接搬进 Host 终端，会引入 client connection 与 UI slot 依赖，却仍然无法得到终端原生控件。

## 决策

TUI bundle 挂载现有 `dsh-client-locale` 的 Host 部分，因此 Web 与 TUI 会在共享设置文档中注册并修改同一个 `locale.preference` 字段。该设置接受英文、中文、阿拉伯文、法文、俄文、西班牙文、日文和韩文。Renderer 提供 `/language [en|zh|ar|fr|ru|es|ja|ko]`；不带参数的命令会打开附着 composer 的选择器，字段级写入不会替换其他设置值。外部 `settings/updated` 事件会实时刷新 TUI。

终端持有的文案集中在一份有类型约束的八语言字典中。欢迎面板、默认 composer placeholder、编辑器 footer、运行状态行、Settings hub，以及语言／外观选择器都会在渲染时读取当前 locale。模型回复、工具载荷、自定义 placeholder 与第三方命令文案保留来源语言。浏览器 React runtime 和浏览器字典仍由浏览器持有：浏览器采用共用的中英文偏好，遇到仅受终端支持的持久化偏好时保留其自身检测到的语言。

## 考虑过的替代方案

没有把浏览器 React locale runtime 复制进 TUI，因为这会让 Host renderer 耦合 client connection 与 UI slot 服务，却仍然无法提供终端原生控件。也没有另建 TUI 专用偏好文件，因为 Web 与终端的修改会产生漂移。仅用环境变量选择语言同样不合适，因为它不能实时切换，也不能持久化跨界面更新。

## 验证

聚焦测试证明全部八种终端 locale id、原文语言名称命令解析、共享 namespace mutate、浏览器对终端专用偏好的回落，以及从外部发起的 locale 更新。Headless-terminal 快照固定中文 Settings hub 与包含八种语言的 composer 选择器。Bundle 测试要求 locale Host row 及其运行时依赖存在；package TypeScript 与仓库 graph 检查覆盖该依赖边。

## 后果

Web 与 TUI 共用一套偏好存储，同时只解释各自随附字典支持的 locale。终端字典覆盖产品 chrome，而非任意模型或插件内容；后续 TUI 自有文案可以继续迁入同一份类型化 copy 表，无需修改持久化设置。
