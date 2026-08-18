/** Human-command projection of MCP-qualified tools visible to one Agent. */

import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'

type VisibleTool = Pick<ToolSchema, 'name' | 'description' | 'parameters'>

const MCP_TOOL_PREFIX = 'mcp__'
const USAGE = 'Usage: /mcp [list|ls|desc|verbose|schema] [server]'

interface McpServer {
  readonly name: string
  readonly tools: readonly VisibleTool[]
}

type McpView = 'list' | 'desc' | 'schema'

function serverName(toolName: string): string | undefined {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return undefined
  const separator = toolName.indexOf('__', MCP_TOOL_PREFIX.length)
  if (separator === -1) return undefined
  const name = toolName.slice(MCP_TOOL_PREFIX.length, separator)
  return name.length === 0 ? undefined : name
}

function groupServers(tools: readonly VisibleTool[]): McpServer[] {
  const grouped = new Map<string, VisibleTool[]>()
  for (const tool of tools) {
    const server = serverName(tool.name)
    if (server === undefined) continue
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

function parseArguments(rawInput: string): { readonly view: McpView; readonly server?: string } | undefined {
  const tokens = rawInput.trim().split(/\s+/u).filter(Boolean)
  if (tokens.length === 0) return { view: 'list' }
  if (tokens.length > 2) return undefined
  const [rawCommand, server] = tokens
  const command = rawCommand?.toLowerCase()
  const view = command === 'list' || command === 'ls'
    ? 'list'
    : command === 'desc' || command === 'verbose'
      ? 'desc'
      : command === 'schema'
        ? 'schema'
        : undefined
  return view === undefined ? undefined : { view, ...(server === undefined ? {} : { server }) }
}

function normalizedDescription(description: string): string {
  return description.replace(/\s+/gu, ' ').trim() || 'No description'
}

function toolRow(tool: VisibleTool, view: McpView): string[] {
  if (view === 'list') return [`  - ${tool.name}`]
  const rows = [`  - ${tool.name} — ${normalizedDescription(tool.description)}`]
  if (view === 'schema') rows.push(`    schema: ${JSON.stringify(tool.parameters)}`)
  return rows
}

/**
 * Render the current Agent's MCP-qualified tool catalog without exposing
 * unrelated registered tools.
 * @param rawInput - Text after `/mcp`; accepts list, description, and schema views.
 * @param tools - Tool schemas after Agent scoping and restrictions.
 * @returns A command result suitable for the terminal transcript.
 */
export function mcpCommandResult(rawInput: string, tools: readonly VisibleTool[]): CommandResult {
  const arguments_ = parseArguments(rawInput)
  if (arguments_ === undefined) return { kind: 'error', text: USAGE }

  const available = groupServers(tools)
  if (available.length === 0) {
    return { kind: 'success', text: 'No MCP tools are available to this session.' }
  }
  const servers = arguments_.server === undefined
    ? available
    : available.filter(server => server.name === arguments_.server)
  if (servers.length === 0) {
    return { kind: 'success', text: `MCP server "${arguments_.server}" is not visible to this session.` }
  }

  const toolCount = servers.reduce((total, server) => total + server.tools.length, 0)
  const rows = servers.flatMap(server => [
    `- ${server.name} · ${String(server.tools.length)} ${server.tools.length === 1 ? 'tool' : 'tools'}`,
    ...server.tools.flatMap(tool => toolRow(tool, arguments_.view)),
  ])
  return {
    kind: 'success',
    text: [
      `MCP servers visible to this session (${String(servers.length)} ${servers.length === 1 ? 'server' : 'servers'} · ${String(toolCount)} ${toolCount === 1 ? 'tool' : 'tools'})`,
      ...rows,
    ].join('\n'),
  }
}
