import { describe, expect, it, vi } from 'vitest'
import { mcpCommandResult } from '../src/chat/mcp-command.ts'

describe('mcp command', () => {
  it('lists only MCP-qualified tools in stable order', () => {
    expect(mcpCommandResult('', [
      { name: 'read', description: 'Local file reader', parameters: {} },
      { name: 'mcp__github__search', description: 'Search repositories', parameters: { query: { type: 'string' } } },
      { name: 'mcp__filesystem__read_file', description: 'Read remote files', parameters: { path: { type: 'string' } } },
    ])).toEqual({
      kind: 'success',
      text: [
        'MCP servers visible to this session (2 servers · 2 tools)',
        '- filesystem · 1 tool',
        '  - mcp__filesystem__read_file',
        '- github · 1 tool',
        '  - mcp__github__search',
      ].join('\n'),
    })
  })

  it('accepts tools as an explicit alias for the default list view', () => {
    const tools = [
      { name: 'mcp__github__search', description: 'Search repositories', parameters: {} },
    ]
    expect(mcpCommandResult('tools', tools)).toEqual(mcpCommandResult('', tools))
  })

  it('points chat users to the boot-free OAuth command', () => {
    expect(mcpCommandResult('auth remote', [])).toEqual({
      kind: 'success',
      text: [
        'MCP OAuth for remote',
        'Run: deepseek mcp auth remote',
        'The browser callback and token storage are handled by the boot-free MCP manager.',
      ].join('\n'),
    })
  })

  it('adds normalized descriptions in desc and legacy verbose modes', () => {
    const tools = [
      { name: 'mcp__github__search', description: 'Search\n  repositories', parameters: {} },
      { name: 'mcp__empty__tool', description: '  ', parameters: {} },
    ]
    const expected = {
      kind: 'success',
      text: [
        'MCP servers visible to this session (2 servers · 2 tools)',
        '- empty · 1 tool',
        '  - mcp__empty__tool — No description',
        '- github · 1 tool',
        '  - mcp__github__search — Search repositories',
      ].join('\n'),
    }
    expect(mcpCommandResult(' DeSc ', tools)).toEqual(expected)
    expect(mcpCommandResult(' VeRbOsE ', tools)).toEqual(expected)
  })

  it('filters one server and prints tool parameter schemas', () => {
    expect(mcpCommandResult('schema GitHub', [
      { name: 'mcp__filesystem__read_file', description: 'Read remote files', parameters: {} },
      { name: 'mcp__GitHub__search', description: 'Search repositories', parameters: { query: { type: 'string' } } },
      { name: 'mcp__GitHub__issues', description: 'List issues', parameters: {} },
    ])).toEqual({
      kind: 'success',
      text: [
        'MCP servers visible to this session (1 server · 2 tools)',
        '- GitHub · 2 tools',
        '  - mcp__GitHub__issues — List issues',
        '    schema: {}',
        '  - mcp__GitHub__search — Search repositories',
        '    schema: {"query":{"type":"string"}}',
      ].join('\n'),
    })
  })

  it('reports absence, missing filters, malformed names, and unknown arguments', () => {
    expect(mcpCommandResult('', [])).toEqual({
      kind: 'success',
      text: 'No MCP tools are available to this session.',
    })
    expect(mcpCommandResult('list missing', [
      { name: 'mcp____invalid', description: '', parameters: {} },
      { name: 'mcp__github__search', description: '', parameters: {} },
    ])).toEqual({
      kind: 'success',
      text: 'MCP server "missing" is not configured or visible to this session.',
    })
    expect(mcpCommandResult('details', [])).toEqual({
      kind: 'error',
      text: 'Usage: /mcp [list|ls|tools|desc|verbose|schema|reload|auth|resources|prompts] [server] [uri|prompt]',
    })
    expect(mcpCommandResult('schema github extra', [])).toEqual({
      kind: 'error',
      text: 'Usage: /mcp [list|ls|tools|desc|verbose|schema|reload|auth|resources|prompts] [server] [uri|prompt]',
    })
  })

  it('includes configured servers, connection state, transport, and visible counts', () => {
    const runtime = {
      list: () => [
        {
          name: 'empty', transport: 'streamable-http' as const, state: 'failed' as const,
          toolCount: 0, reconnectAttempt: 10, maxReconnectAttempts: 10,
        },
        {
          name: 'github', transport: 'stdio' as const, state: 'reconnecting' as const,
          toolCount: 2, reconnectAttempt: 1, maxReconnectAttempts: 10,
        },
      ],
      reload: async () => [],
    }
    expect(mcpCommandResult('desc', [
      { name: 'mcp__github__search', description: 'Search', parameters: {} },
    ], { runtime })).toEqual({
      kind: 'success',
      text: [
        'MCP servers visible to this session (2 servers · 1 visible tool)',
        '- empty · failed · 0 tools',
        '  transport: streamable-http',
        '- github · reconnecting · 2 tools · 1 visible',
        '  transport: stdio',
        '  reconnect: 1/10',
        '  - mcp__github__search — Search',
      ].join('\n'),
    })
  })

  it('reloads one server, reports failed immediate attempts, and requires idle runtime state', async () => {
    const reload = vi.fn(async (name?: string) => [{
      name: name ?? 'github',
      reloaded: false,
      status: {
        name: name ?? 'github', transport: 'stdio' as const, state: 'reconnecting' as const,
        toolCount: 1, reconnectAttempt: 1, maxReconnectAttempts: 10,
      },
    }])
    const runtime = { list: () => [], reload }

    await expect(mcpCommandResult('reload github', [], { runtime })).resolves.toEqual({
      kind: 'success',
      text: [
        'MCP reload complete (0/1 reloaded)',
        '- github · immediate attempt failed · reconnecting · 1 tool',
      ].join('\n'),
    })
    expect(reload).toHaveBeenCalledWith('github')
    await expect(mcpCommandResult('reload', [], { runtime, busyAgentStatus: 'running' })).resolves.toEqual({
      kind: 'error',
      text: '/mcp reload requires every live agent to be idle (busy status: running).',
    })
    await expect(mcpCommandResult('reload', [])).resolves.toEqual({
      kind: 'error',
      text: '/mcp reload needs the MCP runtime service.',
    })
  })

  it('lists MCP resources and prompts and can inspect one item', async () => {
    const runtime = {
      list: () => [],
      reload: async () => [],
      resources: async (name?: string) => [{
        name: name ?? 'docs',
        resources: [{ uri: 'file:///README.md', name: 'README', description: 'Project docs' }],
        templates: [{ uriTemplate: 'file:///{path}', name: 'file' }],
      }],
      prompts: async (name?: string) => [{
        name: name ?? 'docs',
        prompts: [{ name: 'summarize', description: 'Summarize a file' }],
      }],
      readResource: async () => [{ uri: 'file:///README.md', mimeType: 'text/plain', text: 'hello' }],
      getPrompt: async () => ({ messages: [{ role: 'user' as const, content: { type: 'text', text: 'hi' } }] }),
    }
    await expect(mcpCommandResult('resources docs', [], { runtime })).resolves.toEqual({
      kind: 'success',
      text: [
        'MCP resources (1 server · 1 resource · 1 template)',
        '- docs · 1 resource · 1 template',
        '  - README · file:///README.md — Project docs',
        '  - file · file:///{path}',
      ].join('\n'),
    })
    await expect(mcpCommandResult('resources docs file:///README.md', [], { runtime })).resolves.toEqual({
      kind: 'success',
      text: [
        'MCP resource docs:file:///README.md (1 item)',
        '- file:///README.md · text/plain · hello',
      ].join('\n'),
    })
    await expect(mcpCommandResult('prompts docs', [], { runtime })).resolves.toEqual({
      kind: 'success',
      text: [
        'MCP prompts (1 server · 1 prompt)',
        '- docs · 1 prompt',
        '  - summarize — Summarize a file',
      ].join('\n'),
    })
    await expect(mcpCommandResult('prompts docs summarize', [], { runtime })).resolves.toEqual({
      kind: 'success',
      text: [
        'MCP prompt docs:summarize (1 message)',
        '- user: {"type":"text","text":"hi"}',
      ].join('\n'),
    })
  })
})
