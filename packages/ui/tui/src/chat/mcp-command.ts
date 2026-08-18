/** Human-command projection of MCP-qualified tools visible to one Agent. */

import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type {
  McpRegistry,
  McpServerPromptCatalog,
  McpServerResourceCatalog,
  McpServerStatus,
} from '@deepseek-ai/dsh-mcp'
import { groupMcpTools } from './mcp-tools.ts'
import type { McpToolGroup } from './mcp-tools.ts'

type VisibleTool = Pick<ToolSchema, 'name' | 'description' | 'parameters'>

const USAGE = 'Usage: /mcp [list|ls|desc|verbose|schema|reload|resources|prompts] [server] [uri|prompt]'

type McpServer = McpToolGroup<VisibleTool>

type McpView = 'list' | 'desc' | 'schema' | 'reload' | 'resources' | 'prompts'

interface McpCapabilityArguments {
  readonly view: 'resources' | 'prompts'
  readonly server?: string
  readonly target?: string
}

type McpRuntimeView = Pick<McpRegistry, 'list' | 'reload'> & Partial<Pick<McpRegistry, 'resources' | 'prompts' | 'readResource' | 'getPrompt'>>

/** Runtime and turn state needed by the mutating MCP command variant. */
export interface McpCommandOptions {
  /** Optional MCP runtime service; embeddings without it retain tool-only discovery. */
  readonly runtime?: McpRuntimeView
  /** One non-idle live Agent status; omission admits reload. */
  readonly busyAgentStatus?: string
}

function parseArguments(rawInput: string): { readonly view: McpView; readonly server?: string; readonly target?: string } | undefined {
  const tokens = rawInput.trim().split(/\s+/u).filter(Boolean)
  if (tokens.length === 0) return { view: 'list' }
  const [rawCommand, server, target] = tokens
  const command = rawCommand?.toLowerCase()
  const view = command === 'list' || command === 'ls'
    ? 'list'
    : command === 'desc' || command === 'verbose'
      ? 'desc'
      : command === 'schema'
        ? 'schema'
        : command === 'reload'
          ? 'reload'
          : command === 'resources' || command === 'resource'
            ? 'resources'
            : command === 'prompts' || command === 'prompt'
              ? 'prompts'
              : undefined
  if (view !== 'resources' && view !== 'prompts' && tokens.length > 2) return undefined
  if ((view === 'resources' || view === 'prompts') && tokens.length > 3) return undefined
  return view === undefined ? undefined : {
    view,
    ...(server === undefined ? {} : { server }),
    ...(target === undefined ? {} : { target }),
  }
}

function normalizedDescription(description: string): string {
  return description.replace(/\s+/gu, ' ').trim() || 'No description'
}

function formatPromptContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content === null || typeof content !== 'object') return String(content)
  return JSON.stringify(content)
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

function resourceCatalogText(catalogs: readonly McpServerResourceCatalog[]): string {
  const resourceCount = catalogs.reduce((sum, catalog) => sum + catalog.resources.length, 0)
  const templateCount = catalogs.reduce((sum, catalog) => sum + catalog.templates.length, 0)
  return [
    `MCP resources (${countLabel(catalogs.length, 'server')} · ${countLabel(resourceCount, 'resource')} · ${countLabel(templateCount, 'template')})`,
    ...catalogs.flatMap(catalog => [
      `- ${catalog.name} · ${countLabel(catalog.resources.length, 'resource')} · ${countLabel(catalog.templates.length, 'template')}`,
      ...catalog.resources.map(resource => `  - ${resource.name} · ${resource.uri}${resource.description === undefined ? '' : ` — ${normalizedDescription(resource.description)}`}`),
      ...catalog.templates.map(template => `  - ${template.name} · ${template.uriTemplate}${template.description === undefined ? '' : ` — ${normalizedDescription(template.description)}`}`),
    ]),
  ].join('\n')
}

function promptCatalogText(catalogs: readonly McpServerPromptCatalog[]): string {
  const promptCount = catalogs.reduce((sum, catalog) => sum + catalog.prompts.length, 0)
  return [
    `MCP prompts (${countLabel(catalogs.length, 'server')} · ${countLabel(promptCount, 'prompt')})`,
    ...catalogs.flatMap(catalog => [
      `- ${catalog.name} · ${countLabel(catalog.prompts.length, 'prompt')}`,
      ...catalog.prompts.map(prompt => `  - ${prompt.name}${prompt.description === undefined ? '' : ` — ${normalizedDescription(prompt.description)}`}`),
    ]),
  ].join('\n')
}

async function capabilityResult(
  arguments_: McpCapabilityArguments,
  runtime: McpRuntimeView | undefined,
): Promise<CommandResult> {
  if (runtime === undefined) return { kind: 'error', text: `/mcp ${arguments_.view} needs the MCP runtime service.` }
  try {
    if (arguments_.view === 'resources') {
      if (arguments_.target !== undefined) {
        if (arguments_.server === undefined) return { kind: 'error', text: USAGE }
        if (runtime.readResource === undefined) return { kind: 'error', text: '/mcp resources needs a runtime that supports resource reads.' }
        const contents = await runtime.readResource(arguments_.server, arguments_.target)
        return {
          kind: 'success',
          text: [
            `MCP resource ${arguments_.server}:${arguments_.target} (${countLabel(contents.length, 'item')})`,
            ...contents.map(content => `- ${content.uri} · ${content.mimeType ?? (content.text === undefined ? 'binary' : 'text')} · ${content.text ?? '<base64 data>'}`),
          ].join('\n'),
        }
      }
      if (runtime.resources === undefined) return { kind: 'error', text: '/mcp resources needs a runtime that supports resources.' }
      return { kind: 'success', text: resourceCatalogText(await runtime.resources(arguments_.server)) }
    }
    if (arguments_.target !== undefined) {
      if (arguments_.server === undefined) return { kind: 'error', text: USAGE }
      if (runtime.getPrompt === undefined) return { kind: 'error', text: '/mcp prompts needs a runtime that supports prompt expansion.' }
      const expansion = await runtime.getPrompt(arguments_.server, arguments_.target)
      return {
        kind: 'success',
        text: [
          `MCP prompt ${arguments_.server}:${arguments_.target} (${countLabel(expansion.messages.length, 'message')})`,
          ...(expansion.description === undefined ? [] : [expansion.description]),
          ...expansion.messages.map(message => `- ${message.role}: ${formatPromptContent(message.content)}`),
        ].join('\n'),
      }
    }
    if (runtime.prompts === undefined) return { kind: 'error', text: '/mcp prompts needs a runtime that supports prompts.' }
    return { kind: 'success', text: promptCatalogText(await runtime.prompts(arguments_.server)) }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
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
  if (arguments_.view === 'resources' || arguments_.view === 'prompts') {
    return capabilityResult({
      view: arguments_.view,
      ...(arguments_.server === undefined ? {} : { server: arguments_.server }),
      ...(arguments_.target === undefined ? {} : { target: arguments_.target }),
    }, options.runtime)
  }
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
