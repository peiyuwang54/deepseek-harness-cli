# Agent Note: MCP 运行时状态与手动重载

Status: implemented

[English](2026-08-18-mcp-runtime-status-and-reload.md) | 中文

## Problem

作用域工具 registry 可以显示当前可见的 MCP 限定工具，但无法区分没有工具的已连接服务器与失败服务器，也不能展示重连进度，或在重试预算耗尽后安全替换连接。根据工具名称推断连接健康状态，会在中断期间把陈旧工具误报为健康。复用组合级 `/reload` 会重载无关插件，而且仍然无法提供逐服务器结果。

## Decision

`@deepseek-ai/dsh-mcp` 持有 `ctx.mcp` 运行时 registry，是 MCP 连接诊断与生命周期控制的 Service Definition。每个 `@deepseek-ai/dsh-mcp-client` 实例都是 Service Provider，会在自身 effect 生命周期内注册稳定名称、传输类型、当前连接状态、已同步工具数量、重连进度与立即重载函数。TUI 是可选读取该服务的 Consumer，因此没有挂载它的嵌入仍保留只基于工具的发现。

Registry 返回分离且按名称排序的快照，状态为 `connecting`、`connected`、`reconnecting` 或 `failed`。它不会公开传输错误或凭据。`/mcp`、`/mcp desc` 与 `/mcp schema` 会把这些服务器快照同接收命令的 Agent 作用域工具 schema 合并：连接状态属于 Host，工具名称、描述与 schema 仍按作用域过滤。没有可见工具的已配置服务器仍会显示。

`/mcp reload [server]` 只在所有存活 Agent 都空闲时运行，因为一个全局注册的服务器可能服务多个 Agent。不指定名称会选择全部活跃服务器，指定名称则只选择一个。每个 supervisor 会取消待处理退避，在关闭当前世代前移除其所有权，等待现有的有界传输关闭屏障与串行工具同步队列，重置中断预算，再立即尝试一次连接与发现。同一服务器的并发重载会共享一次替换操作。如果立即尝试失败，命令会报告失败，已配置的自动重连策略则从该失败继续。重载不会重新读取 `$DSH_HOME/mcp.json`；catalog 的添加与删除仍需要新进程。

此决策部分取代最初的[MCP 单包拓扑](2026-07-07-mcp-client-plugin.md)，因为用户诊断现在形成了真实的 Service Provider／Consumer seam。具体客户端仍保留每服务器一个实例的传输设计、命名规则与工具桥接。它也在不让 catalog 成为第二个连接所有者的前提下，满足了[受管 MCP catalog](2026-08-18-managed-mcp-server-catalog.md)记录的运行时服务条件。原始客户端、自动重连、受管 catalog 与 TUI 入口说明仍保持活跃，因为其中的命名、重试、凭据、组合与呈现决策仍会指导未来工作。

面向用户的命令与 Gemini CLI 文档中的 [`/mcp reload` 和状态视图](https://geminicli.com/docs/cli/commands/#mcp)进行了对照。DeepSeek Harness 使用自身的 Cordis 服务与 MCP supervisor；没有复制 Gemini 源代码。

## Alternatives considered

**根据已注册 MCP 工具推断状态。** 否决，因为重连 supervisor 会在短暂中断期间有意保留最后一个正常世代，而且已连接服务器也可能合法地公布零个工具。

**调用 Loader 支持的 `/reload`。** 否决，因为配置树刷新持有组合变化，而不是单个连接世代。重载无关配置行会扩大失败范围，也无法报告所选服务器的立即结果。

**让受管 catalog 持有实时客户端。** 否决，因为 Cordis 插件实例已持有传输、工具注册、teardown 与 HMR。catalog 侧 manager 会复制该生命周期，并让一个服务器出现两个写入方。

**直接从 `dsh-mcp-client` 向 TUI 公开运行时控制。** 否决，因为 Consumer 会依赖具体 provider 包，其他 MCP provider 若要参与就必须重复实现命令。

## Consequences

用户可以区分已连接、正在重连与失败的 MCP 服务器，也可以在不重启 CLI 的情况下重试一个服务器。手动重载保留 supervisor 不重叠进程与串行世代的保证，但增加了第二种触发源，必须继续与自动重连和 dispose 合并。单元测试固定 registry 生命周期、重复名称、并发分发、状态变化、退避取消、世代替换与同服务器重载合并。TUI 命令测试固定作用域可见性、状态呈现、空闲准入、缺失服务时的回退，以及立即失败报告；现有无密钥 TUI checkpoint 继续固定 schema 投影。
