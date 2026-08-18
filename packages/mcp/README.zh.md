# MCP — 模型上下文协议

[English](README.md) | 中文

将 harness 与 MCP 生态系统桥接的包。

| 包 | 职责 |
|---|---|
| [`mcp/`](mcp/README.md) | 在 `ctx.mcp` 提供服务器连接状态与重载控制的运行时 registry |
| [`mcp-client/`](mcp-client/README.md) | MCP 客户端桥接，将外部服务器工具注册到 `ctx.tools` |
