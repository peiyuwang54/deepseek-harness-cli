/** Read-only `/memories` projection over visible Memory MCP tools. */

import type { CommandResult } from '@deepseek-ai/dsh-commands'

interface VisibleTool {
  readonly name: string
  readonly description: string
}

interface MemoryProvider {
  readonly name: string
  readonly tools: readonly VisibleTool[]
}

const MCP_TOOL_PREFIX = 'mcp__'
const MEMORY_SERVER_PATTERN = /(?:^|[_-])(?:memory|memorix|engram)(?:$|[_-])/u
const CONFIGURE_HINT = 'Configure an optional provider outside chat; see examples/mcp-memory/README.md. /mcp verbose lists all MCP tools.'

function mcpServerName(toolName: string): string | undefined {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return undefined
  const server = toolName.slice(MCP_TOOL_PREFIX.length).split('__', 1)[0]
  return server === undefined || server.length === 0 ? undefined : server
}

function memoryProviders(tools: readonly VisibleTool[]): MemoryProvider[] {
  const grouped = new Map<string, VisibleTool[]>()
  for (const tool of tools) {
    const server = mcpServerName(tool.name)
    if (server === undefined || !MEMORY_SERVER_PATTERN.test(server)) continue
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

/**
 * Report Memory MCP capabilities without claiming ownership of provider data or policy.
 * @param rawInput - Text after `/memories`; `verbose` includes matching tool names and descriptions.
 * @param tools - Tool schemas after Agent scoping and restrictions.
 * @returns A read-only memory capability result for the terminal transcript.
 */
export function memoriesCommandResult(rawInput: string, tools: readonly VisibleTool[]): CommandResult {
  const argument = rawInput.trim().toLocaleLowerCase()
  if (argument !== '' && argument !== 'verbose') {
    return { kind: 'error', text: 'Usage: /memories [verbose]' }
  }
  const providers = memoryProviders(tools)
  if (providers.length === 0) {
    return {
      kind: 'success',
      text: [
        'No Memory MCP tools are visible to this session.',
        'DeepSeek Harness does not ship a built-in memory store.',
        CONFIGURE_HINT,
      ].join('\n'),
    }
  }
  const toolCount = providers.reduce((total, provider) => total + provider.tools.length, 0)
  const providerNoun = providers.length === 1 ? 'provider' : 'providers'
  const rows = providers.flatMap(provider => [
    `- ${provider.name} · ${String(provider.tools.length)} ${provider.tools.length === 1 ? 'tool' : 'tools'}`,
    ...argument === 'verbose'
      ? provider.tools.map(tool => `  - ${tool.name} — ${tool.description.replace(/\s+/gu, ' ').trim() || 'No description'}`)
      : [],
  ])
  return {
    kind: 'success',
    text: [
      `Memory MCP providers (${String(providers.length)} ${providerNoun} · ${String(toolCount)} tools)`,
      ...rows,
      'Memory use, generation, retention, and reset remain provider-owned.',
      CONFIGURE_HINT,
    ].join('\n'),
  }
}
