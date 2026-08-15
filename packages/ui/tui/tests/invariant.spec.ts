import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as TuiInvariant from '../src/invariant.ts'
import type { UserShellResult } from '../src/chat/user-shell.ts'

const start = (overrides: Record<string, unknown> = {}) => ({
  id: 'shell-1',
  command: 'git status',
  cwd: '/workspace',
  ...overrides,
})

const shellResult = (overrides: Record<string, unknown> = {}): UserShellResult => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  aborted: false,
  stdout: { text: 'clean', truncated: false },
  stderr: { text: '', truncated: false },
  ...overrides,
})

const result = (overrides: Record<string, unknown> = {}) => ({
  id: 'shell-1',
  durationMs: 12,
  result: shellResult(),
  ...overrides,
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(TuiInvariant)
  return ctx
}

function emit(ctx: Context, session: Session, event: SessionEvent): void {
  ctx.emit('session/event', session, event)
}

describe('TUI durable event invariants', () => {
  it('accepts a settled command and an unmatched interrupted start', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('tui/user-shell-start', start())
    session.append('tui/user-shell-result', result())
    session.append('tui/user-shell-start', start({ id: 'interrupted' }))
  })

  it('rebuilds an unmatched start from an existing Session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tui/user-shell-start', start())
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(TuiInvariant)
    expect(() => session.append('tui/user-shell-result', result())).not.toThrow()
  })

  it('rejects duplicate starts, unmatched results, and duplicate results', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => session.append('tui/user-shell-result', result())).toThrow(/no unmatched start/)
    session.append('tui/user-shell-start', start())
    expect(() => session.append('tui/user-shell-start', start())).toThrow(/repeats id/)
    session.append('tui/user-shell-result', result())
    expect(() => session.append('tui/user-shell-result', result())).toThrow(/no unmatched start/)
  })

  it.each([
    [start({ id: '' }), /id and command must be non-empty/],
    [start({ command: '   ' }), /id and command must be non-empty/],
    [start({ cwd: 'relative' }), /cwd must be absolute/],
  ])('rejects a malformed start %#', async (data, message) => {
    const ctx = await setup()
    expect(() => ctx.sessions.create().append('tui/user-shell-start', data as never)).toThrow(message)
  })

  it.each([
    [result({ durationMs: -1 }), /durationMs/],
    [result({ result: shellResult({ exitCode: -1 }) }), /exitCode/],
    [result({ result: shellResult({ exitCode: 1.5 }) }), /exitCode/],
    [result({ result: shellResult({ timedOut: 'no' }) }), /must be booleans/],
    [result({ result: shellResult({ aborted: 'no' }) }), /must be booleans/],
    [result({ result: shellResult({ stdout: { text: 1, truncated: false } }) }), /captured outputs/],
    [result({ result: shellResult({ stderr: { text: '', truncated: 'no' } }) }), /captured outputs/],
  ])('rejects a malformed result %#', async (data, message) => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('tui/user-shell-start', start())
    expect(() => session.append('tui/user-shell-result', data as never)).toThrow(message)
  })

  it('validates a bare Session first observed through publication and ignores unrelated events', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('bare-shell'))
    expect(() => {
      emit(ctx, session, { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } })
      emit(ctx, session, { type: 'tui/user-shell-start', seq: 1, time: 1, data: start() })
      emit(ctx, session, { type: 'tui/user-shell-result', seq: 2, time: 2, data: result() })
    }).not.toThrow()
  })
})
