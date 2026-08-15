import { describe, expect, it } from 'vitest'
import { mcpCommandResult } from '../src/chat/mcp-command.ts'

describe('mcp command', () => {
  it('lists only MCP-qualified tools in stable order', () => {
    expect(mcpCommandResult('', [
      { name: 'read', description: 'Local file reader' },
      { name: 'mcp__github__search', description: 'Search repositories' },
      { name: 'mcp__filesystem__read_file', description: 'Read remote files' },
    ])).toEqual({
      kind: 'success',
      text: [
        'MCP tools visible to this session (2)',
        '- mcp__filesystem__read_file',
        '- mcp__github__search',
      ].join('\n'),
    })
  })

  it('adds normalized descriptions in verbose mode', () => {
    expect(mcpCommandResult(' VeRbOsE ', [
      { name: 'mcp__github__search', description: 'Search\n  repositories' },
      { name: 'mcp__empty__tool', description: '  ' },
    ])).toEqual({
      kind: 'success',
      text: [
        'MCP tools visible to this session (2)',
        '- mcp__empty__tool — No description',
        '- mcp__github__search — Search repositories',
      ].join('\n'),
    })
  })

  it('reports absence and rejects unknown arguments', () => {
    expect(mcpCommandResult('', [])).toEqual({
      kind: 'success',
      text: 'No MCP tools are available to this session.',
    })
    expect(mcpCommandResult('details', [])).toEqual({
      kind: 'error',
      text: 'Usage: /mcp [verbose]',
    })
  })
})
