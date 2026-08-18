/** Human-command projection of MCP-qualified tools visible to one Agent. */

import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { McpRegistry, McpServerStatus } from '@deepseek-ai/dsh-mcp'
import { groupMcpTools } from './mcp-tools.ts'
import type { McpToolGroup } from './mcp-tools.ts'

type VisibleTool = Pick<ToolSchema, 'name' | 'description' | 'parameters'>

const USAGE = 'Usage: /mcp [list|ls|desc|verbose|schema|reload] [server]'

type McpServer = McpToolGroup<VisibleTool>

type McpView = 'list' | 'desc' | 'schema' | 'reload'

type McpRuntimeView = Pick<McpRegistry, 'list' | 'reload'>

/** Runtime and turn state needed by the mutating MCP command variant. */
export interface McpCommandOptions {
  /** Optional MCP runtime service; embeddings without it retain tool-only discovery. */
  readonly runtime?: McpRuntimeView
  /** One non-idle live Agent status; omission admits reload. */
  readonly busyAgentStatus?: string
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
        : command === 'reload'
          ? 'reload'
          : undefined
  return view === undefined ? undefined : { view, ...(server === undefined ? {} : { server }) }
}

function normalizedDescription(description: string): string {
  return description.replace(/\s+/gu, ' ').trim() || 'No description'
}

function toolRow(tool: VisibleTool, view: Exclude<McpView, 'reload'>): string[] {
  if (view === 'list') return [`  - ${tool.name}`]
  const rows = [`  - ${tool.name} — ${normalizedDescription(tool.description)}`]
  if (view === 'schema') rows.push(`    schema: ${JSON.stringify(tool.parameters)}`)
  return rows
}

function countLabel(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

function serverHeading(server: McpServer, status: McpServerStatus | undefined): string {
  if (status === undefined) return `- ${server.name} · ${countLabel(server.tools.length, 'tool')}`
  const counts = status.toolCount === server.tools.length
    ? countLabel(status.toolCount, 'tool')
    : `${countLabel(status.toolCount, 'tool')} · ${String(server.tools.length)} visible`
  return `- ${server.name} · ${status.state} · ${counts}`
}

function runtimeDetails(status: McpServerStatus | undefined): string[] {
  if (status === undefined) return []
  return [
    `  transport: ${status.transport}`,
    ...status.state === 'reconnecting'
      ? [`  reconnect: ${String(status.reconnectAttempt)}/${String(status.maxReconnectAttempts)}`]
      : [],
  ]
}

async function reloadResult(
  server: string | undefined,
  runtime: McpRuntimeView | undefined,
  busyAgentStatus: string | undefined,
): Promise<CommandResult> {
  if (busyAgentStatus !== undefined) {
    return { kind: 'error', text: `/mcp reload requires every live agent to be idle (busy status: ${busyAgentStatus}).` }
  }
  if (runtime === undefined) {
    return { kind: 'error', text: '/mcp reload needs the MCP runtime service.' }
  }
  try {
    const results = await runtime.reload(server)
    if (results.length === 0) {
      return { kind: 'success', text: 'No MCP servers are configured.' }
    }
    const reloaded = results.filter(result => result.reloaded).length
    return {
      kind: 'success',
      text: [
        `MCP reload complete (${String(reloaded)}/${String(results.length)} reloaded)`,
        ...results.map(result => `- ${result.name} · ${result.reloaded ? 'reloaded' : 'immediate attempt failed'} · ${result.status.state} · ${countLabel(result.status.toolCount, 'tool')}`),
      ].join('\n'),
    }
  } catch (error) {
    return {
      kind: 'error',
      text: error instanceof Error ? error.message : 'MCP reload failed.',
    }
  }
}

/**
 * Render the current Agent's MCP-qualified tool catalog without exposing
 * unrelated registered tools.
 * @param rawInput - Text after `/mcp`; accepts list, description, and schema views.
 * @param tools - Tool schemas after Agent scoping and restrictions.
 * @param options - Optional runtime status/reload service and current Agent state.
 * @returns A command result suitable for the terminal transcript.
 */
export function mcpCommandResult(
  rawInput: string,
  tools: readonly VisibleTool[],
  options: McpCommandOptions = {},
): CommandResult | Promise<CommandResult> {
  const arguments_ = parseArguments(rawInput)
  if (arguments_ === undefined) return { kind: 'error', text: USAGE }
  if (arguments_.view === 'reload') {
    return reloadResult(arguments_.server, options.runtime, options.busyAgentStatus)
  }
  const view = arguments_.view

  const available = groupMcpTools(tools)
  const statuses = options.runtime?.list() ?? []
  const statusByName = new Map(statuses.map(status => [status.name, status]))
  const availableByName = new Map(available.map(server => [server.name, server]))
  for (const status of statuses) {
    if (!availableByName.has(status.name)) availableByName.set(status.name, { name: status.name, tools: [] })
  }
  const allServers = [...availableByName.values()].toSorted((left, right) => left.name.localeCompare(right.name))
  if (allServers.length === 0) return options.runtime === undefined
    ? { kind: 'success', text: 'No MCP tools are available to this session.' }
    : { kind: 'success', text: 'No MCP servers are configured.' }
  const servers = arguments_.server === undefined
    ? allServers
    : allServers.filter(server => server.name === arguments_.server)
  if (servers.length === 0) {
    return { kind: 'success', text: `MCP server "${arguments_.server}" is not configured or visible to this session.` }
  }

  const toolCount = servers.reduce((total, server) => total + server.tools.length, 0)
  const rows = servers.flatMap((server) => {
    const status = statusByName.get(server.name)
    return [
      serverHeading(server, status),
      ...view === 'list' ? [] : runtimeDetails(status),
      ...server.tools.flatMap(tool => toolRow(tool, view)),
    ]
  })
  return {
    kind: 'success',
    text: [
      `MCP servers visible to this session (${countLabel(servers.length, 'server')} · ${countLabel(toolCount, options.runtime === undefined ? 'tool' : 'visible tool')})`,
      ...rows,
    ].join('\n'),
  }
}
