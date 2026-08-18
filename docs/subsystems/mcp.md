# Model Context Protocol

English | [中文](mcp.zh.md)

[`@deepseek-ai/dsh-mcp`](../../packages/mcp/mcp) owns the transport-independent `ctx.mcp` runtime registry. MCP client providers contribute effect-scoped server status and reload controls; terminal diagnostics consume detached snapshots. Tool discovery and calls remain on [`ctx.tools`](tools.md).

The shipped client and user commands are documented in [`packages/mcp`](../../packages/mcp/README.md) and the [CLI reference](../../apps/cli/reference/README.md#mcp-server-management).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcp--mcpregistry"></a>

### `ctx.mcp` — `McpRegistry`

Effect-scoped registry of active MCP server runtimes.

```ts cordis-catalog
/**
 * Register one concrete MCP server runtime for the calling plugin's lifetime.
 * @param server - Borrowed runtime status and reload controls.
 * @returns The exact effect disposer that removes this server.
 */
register(server: McpServerRuntime): () => void

/**
 * Snapshot every active server in stable name order.
 * @returns Fresh status objects detached from provider state.
 */
list(): McpServerStatus[]

/**
 * Immediately reconnect one server or every active server. Distinct servers
 * reload concurrently; each provider serializes its own generations.
 * @param name - Exact server namespace, or omission to select every server.
 * @returns Stable-name results after all immediate attempts settle.
 */
async reload(name?: string): Promise<McpReloadResult[]>
```

Source: [`packages/mcp/mcp/src/index.ts:71`](../../packages/mcp/mcp/src/index.ts)
<!-- END GENERATED cordis-surface -->
