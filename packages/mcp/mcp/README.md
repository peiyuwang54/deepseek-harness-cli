# @deepseek-ai/dsh-mcp

English | [中文](README.zh.md)

Runtime registry for active MCP servers. Concrete clients register connection status and immediate reload controls on `ctx.mcp`; terminal and future Web diagnostics consume snapshots without depending on one transport implementation.

## API

- `ctx.mcp.register(runtime)` adds one effect-scoped server runtime and rejects a duplicate live name.
- `ctx.mcp.list()` returns stable-name snapshots with transport, connection state, synchronized tool count, and reconnect progress.
- `ctx.mcp.reload(name?)` asks one server or every active server to replace its current connection immediately. Each result distinguishes a successful immediate connection from a failed attempt that may continue through automatic backoff.

## Services consumed

None.

## Model Experience

Indirectly, through MCP client tool registrations. This registry adds no model-visible context or tools; consumers expose its runtime diagnostics only to humans.

#### KV Cache effect

None; this registry neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Reload reconnects already configured live instances; it does not reread or mutate the managed `$DSH_HOME/mcp.json` catalog.
- The registry covers connection and tool synchronization only. MCP Resources, Prompts, OAuth, and enable/disable state require separate consumers and lifecycle designs.
