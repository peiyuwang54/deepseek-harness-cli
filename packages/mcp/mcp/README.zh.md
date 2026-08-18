# @deepseek-ai/dsh-mcp

[English](README.md) | 中文

活跃 MCP 服务器的运行时 registry。具体客户端在 `ctx.mcp` 注册连接状态和立即重载控制；终端及未来的 Web 诊断无需依赖某一种传输实现即可读取快照。

## API

- `ctx.mcp.register(runtime)` 添加一个由 effect 管理生命周期的服务器运行时，并拒绝重复的存活名称。
- `ctx.mcp.list()` 按名称稳定返回快照，包含传输类型、连接状态、已同步工具数量与重连进度。
- `ctx.mcp.reload(name?)` 要求一个服务器或所有活跃服务器立即替换当前连接。每项结果会区分立即连接成功，以及本次尝试失败但可能继续自动退避重连的情况。
- `ctx.mcp.resources(name?)` 与 `ctx.mcp.prompts(name?)` 发现 MCP Resources、URI 模板和 Prompts，但不会把它们加入模型工具列表。
- `ctx.mcp.readResource(name, uri)` 读取一个 Resource，`ctx.mcp.getPrompt(name, prompt, arguments?)` 为面向人的消费方展开一个 Prompt。

## 消费的服务

无。

## 模型体验

仅通过 MCP 客户端注册的工具间接影响模型。此 registry 不会添加模型可见上下文或工具；消费方只向用户展示其运行时诊断。

#### KV 缓存影响

无；此 registry 既不组装也不发送模型请求。

## 已知限制与延期工作

- 重载只会重连已配置的存活实例；它不会重新读取或修改受管 `$DSH_HOME/mcp.json` catalog。
- OAuth 仍由传输层负责；Registry 不保存 token，也不实现交互式授权流程。
- 启用／停用状态属于 CLI 管理 catalog，而不是运行时 Registry。
