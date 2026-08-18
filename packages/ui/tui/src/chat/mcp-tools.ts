/** Shared parsing and grouping for MCP-qualified tool names. */

const MCP_TOOL_PREFIX = 'mcp__'

/** One stable-name group of MCP-qualified tool schemas. */
export interface McpToolGroup<T> {
  /** MCP server namespace extracted from the public tool name. */
  readonly name: string
  /** Tools advertised under this server namespace, sorted by public name. */
  readonly tools: readonly T[]
}

/**
 * Group MCP-qualified tools by server namespace in stable order.
 * @param tools - Agent-scoped tool records carrying public names.
 * @returns Only valid `mcp__<server>__<tool>` records, grouped and sorted.
 */
export function groupMcpTools<T extends { readonly name: string }>(tools: readonly T[]): McpToolGroup<T>[] {
  const grouped = new Map<string, T[]>()
  for (const tool of tools) {
    if (!tool.name.startsWith(MCP_TOOL_PREFIX)) continue
    const separator = tool.name.indexOf('__', MCP_TOOL_PREFIX.length)
    if (separator === -1) continue
    const server = tool.name.slice(MCP_TOOL_PREFIX.length, separator)
    if (server.length === 0) continue
    const entries = grouped.get(server) ?? []
    entries.push(tool)
    grouped.set(server, entries)
  }
  return [...grouped]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, entries]) => ({
      name,
      tools: entries.toSorted((left, right) => left.name.localeCompare(right.name)),
    }))
}
