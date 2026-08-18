# @deepseek-ai/dsh-mcp

English | [中文](README.zh.md)

Runtime registry for active MCP servers. Concrete clients register connection status and immediate reload controls on `ctx.mcp`; terminal and future Web diagnostics consume snapshots without depending on one transport implementation.

## API

- `ctx.mcp.register(runtime)` adds one effect-scoped server runtime and rejects a duplicate live name.
- `ctx.mcp.list()` returns stable-name snapshots with transport, connection state, synchronized tool count, and reconnect progress.
- `ctx.mcp.reload(name?)` asks one server or every active server to replace its current connection immediately. Each result distinguishes a successful immediate connection from a failed attempt that may continue through automatic backoff.
- `ctx.mcp.resources(name?)` and `ctx.mcp.prompts(name?)` discover MCP Resources, URI templates, and Prompts without adding them to the model tool list.
- `ctx.mcp.readResource(name, uri)` reads one Resource and `ctx.mcp.getPrompt(name, prompt, arguments?)` expands one Prompt for human-facing consumers.

## Services consumed

None.

## Model Experience

Indirectly, through MCP client tool registrations. This registry adds no model-visible context or tools; consumers expose its runtime diagnostics only to humans.

#### KV Cache effect

None; this registry neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Reload reconnects already configured live instances; it does not reread or mutate the managed `$DSH_HOME/mcp.json` catalog.
- OAuth remains transport-owned; the registry does not store tokens or implement an interactive authorization flow.
- Enable/disable state belongs to the managed CLI catalog, not the live runtime registry.
