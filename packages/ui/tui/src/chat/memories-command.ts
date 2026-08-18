/** Read-only `/memories` projection over visible Memory MCP tools. */

import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { groupMcpTools } from './mcp-tools.ts'

interface VisibleTool {
  readonly name: string
  readonly description: string
}

interface MemoryProvider {
  readonly name: string
  readonly tools: readonly VisibleTool[]
}

const MEMORY_SERVER_PATTERN = /(?:^|[_-])(?:memory|memorix|engram)(?:$|[_-])/u
const CONFIGURE_HINT = 'Configure an optional provider outside chat; see examples/mcp-memory/README.md. /mcp verbose lists all MCP tools.'

function memoryProviders(tools: readonly VisibleTool[]): MemoryProvider[] {
  return groupMcpTools(tools).filter(provider => MEMORY_SERVER_PATTERN.test(provider.name))
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
