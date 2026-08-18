# 模型上下文协议

[English](mcp.md) | 中文

[`@deepseek-ai/dsh-mcp`](../../packages/mcp/mcp) 持有与传输无关的 `ctx.mcp` 运行时 registry。MCP 客户端 provider 会贡献由 effect 管理生命周期的服务器状态与重载控制；终端诊断读取分离的快照。工具发现与调用仍位于 [`ctx.tools`](tools.md)。

随附客户端与用户命令见 [`packages/mcp`](../../packages/mcp/README.md)和 [CLI 参考](../../apps/cli/reference/README.md#mcp-server-management)。

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

/**
 * Discover resources and URI templates for one server or every active server.
 * @param name - Exact server namespace, or omission to select every server.
 * @returns Stable-name catalogs containing resources and URI templates.
 */
async resources(name?: string): Promise<McpServerResourceCatalog[]>

/**
 * Discover prompts for one server or every active server.
 * @param name - Exact server namespace, or omission to select every server.
 * @returns Stable-name catalogs containing prompt definitions.
 */
async prompts(name?: string): Promise<McpServerPromptCatalog[]>

/**
 * Read one resource from a named active server.
 * @param name - Exact server namespace.
 * @param uri - Concrete resource URI to read.
 * @returns Text or base64 content returned by the server.
 */
async readResource(name: string, uri: string): Promise<readonly McpResourceContent[]>

/**
 * Expand one prompt from a named active server.
 * @param name - Exact server namespace.
 * @param prompt - Prompt name advertised by the server.
 * @param arguments_ - String arguments passed to the prompt.
 * @returns Messages and optional description returned by the server.
 */
async getPrompt( name: string, prompt: string, arguments_: Readonly<Record<string, string>> = {}, ): Promise<McpPromptExpansion>
```

Source: [`packages/mcp/mcp/src/index.ts:154`](../../packages/mcp/mcp/src/index.ts)
<!-- END GENERATED cordis-surface -->
