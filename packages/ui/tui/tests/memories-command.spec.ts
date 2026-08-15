import { describe, expect, it } from 'vitest'
import { memoriesCommandResult } from '../src/chat/memories-command.ts'

describe('/memories capability view', () => {
  it('groups visible memory providers without including unrelated MCP tools', () => {
    expect(memoriesCommandResult('', [
      { name: 'mcp__github__search', description: 'Search repositories' },
      { name: 'mcp__reference_memory__read_graph', description: 'Read the memory graph' },
      { name: 'mcp__reference_memory__create_entities', description: 'Create entities' },
      { name: 'mcp__engram__recall', description: 'Recall knowledge' },
      { name: 'read', description: 'Read a local file' },
    ])).toEqual({
      kind: 'success',
      text: [
        'Memory MCP providers (2 providers · 3 tools)',
        '- engram · 1 tool',
        '- reference_memory · 2 tools',
        'Memory use, generation, retention, and reset remain provider-owned.',
        'Configure an optional provider outside chat; see examples/mcp-memory/README.md. /mcp verbose lists all MCP tools.',
      ].join('\n'),
    })
  })

  it('shows normalized tool diagnostics only in verbose mode', () => {
    expect(memoriesCommandResult(' verbose ', [
      { name: 'mcp__memorix__search', description: 'Search\n memory' },
      { name: 'mcp__memorix__store', description: '  ' },
    ])).toEqual({
      kind: 'success',
      text: [
        'Memory MCP providers (1 provider · 2 tools)',
        '- memorix · 2 tools',
        '  - mcp__memorix__search — Search memory',
        '  - mcp__memorix__store — No description',
        'Memory use, generation, retention, and reset remain provider-owned.',
        'Configure an optional provider outside chat; see examples/mcp-memory/README.md. /mcp verbose lists all MCP tools.',
      ].join('\n'),
    })
  })

  it('reports capability absence and rejects mutation-like arguments', () => {
    expect(memoriesCommandResult('', [])).toEqual({
      kind: 'success',
      text: [
        'No Memory MCP tools are visible to this session.',
        'DeepSeek Harness does not ship a built-in memory store.',
        'Configure an optional provider outside chat; see examples/mcp-memory/README.md. /mcp verbose lists all MCP tools.',
      ].join('\n'),
    })
    expect(memoriesCommandResult('reset', [])).toEqual({
      kind: 'error',
      text: 'Usage: /memories [verbose]',
    })
  })
})
