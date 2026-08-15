/** Human-command projection of MCP-qualified tools visible to one Agent. */

import type { CommandResult } from '@deepseek-ai/dsh-commands'

interface VisibleTool {
  readonly name: string
  readonly description: string
}

const MCP_TOOL_PREFIX = 'mcp__'

/**
 * Render the current Agent's MCP-qualified tool catalog without exposing
 * unrelated registered tools.
 * @param rawInput - Text after `/mcp`; `verbose` includes descriptions.
 * @param tools - Tool schemas after Agent scoping and restrictions.
 * @returns A command result suitable for the terminal transcript.
 */
export function mcpCommandResult(rawInput: string, tools: readonly VisibleTool[]): CommandResult {
  const argument = rawInput.trim().toLowerCase()
  if (argument !== '' && argument !== 'verbose') {
    return { kind: 'error', text: 'Usage: /mcp [verbose]' }
  }

  const visible = tools
    .filter(tool => tool.name.startsWith(MCP_TOOL_PREFIX))
    .toSorted((left, right) => left.name.localeCompare(right.name))
  if (visible.length === 0) {
    return { kind: 'success', text: 'No MCP tools are available to this session.' }
  }

  const rows = visible.map(tool => argument === 'verbose'
    ? `- ${tool.name} — ${tool.description.replace(/\s+/gu, ' ').trim() || 'No description'}`
    : `- ${tool.name}`)
  return {
    kind: 'success',
    text: [`MCP tools visible to this session (${visible.length})`, ...rows].join('\n'),
  }
}
