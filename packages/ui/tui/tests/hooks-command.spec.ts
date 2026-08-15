import { describe, expect, it } from 'vitest'
import { hooksCommandResult } from '../src/chat/hooks-command.ts'

const registry = {
  list: () => [{
    dialect: 'codex' as const,
    configPath: '/workspace/.codex/hooks.json',
    handlerCount: 2,
    points: [
      {
        point: 'SessionStart',
        groups: [{ handlers: [{ command: 'node start.mjs' }] }],
      },
      {
        point: 'PreToolUse',
        groups: [{
          matcher: 'bash|read',
          handlers: [{ command: 'node guard.mjs', timeoutSec: 30 }],
        }],
      },
    ],
    skipped: [{ point: 'Stop', reason: 'async hook' }],
  }],
}

describe('/hooks diagnostics', () => {
  it('renders active sources and per-event handler totals by default', () => {
    expect(hooksCommandResult('', registry)).toEqual({
      kind: 'success',
      text: [
        'Lifecycle hooks',
        'Codex · 2 handlers · /workspace/.codex/hooks.json',
        '  SessionStart · 1 handler',
        '  PreToolUse · 1 handler',
        '  Skipped · 1',
      ].join('\n'),
    })
  })

  it('renders matcher, command, timeout, and skip details in verbose mode', () => {
    const result = hooksCommandResult(' verbose ', registry)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('matcher: bash|read')
    expect(result.text).toContain('$ node guard.mjs · timeout 30s')
    expect(result.text).toContain('skipped Stop: async hook')
  })

  it('reports empty, unavailable, and invalid states explicitly', () => {
    expect(hooksCommandResult('', { list: () => [] })).toEqual({
      kind: 'success',
      text: 'No lifecycle hooks are configured. Add a Codex or Claude Code hook bridge to this profile to load an existing hooks.json.',
    })
    expect(hooksCommandResult('', undefined)).toEqual({
      kind: 'error',
      text: 'Hook diagnostics are not available in this profile.',
    })
    expect(hooksCommandResult('detail', registry)).toEqual({
      kind: 'error',
      text: 'Usage: /hooks [verbose]',
    })
  })
})
