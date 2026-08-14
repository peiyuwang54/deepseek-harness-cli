/** The terminal command-line provider resolves identity before the runner activates. */

import { Context } from '@deepseek-ai/cordis'
import {
  internals as cmdlineInternals,
  provideCmdline,
} from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  internals,
  TUI_STARTUP_SERVICE,
  type TuiStartupValues,
} from '../src/startup.ts'

interface Observed {
  exits: number[]
  output: string
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  internals.stdin = process.stdin
  internals.stdout = process.stdout
  internals.randomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto)
  cmdlineInternals.stdout = process.stdout
  cmdlineInternals.stderr = process.stderr
})

/** Parse one app invocation through the real cmdline host adapter. */
function parse(args: string[], tty = true): {
  ctx: Context
  observed: Observed
  startup: TuiStartupValues | undefined
} {
  const ctx = new Context()
  contexts.push(ctx)
  const observed: Observed = { exits: [], output: '' }
  const capture = { write: (chunk: string) => { observed.output += chunk; return true } }
  cmdlineInternals.stdout = capture
  cmdlineInternals.stderr = capture
  internals.stdin = { isTTY: tty }
  internals.stdout = { isTTY: tty }
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  apply(ctx)
  return {
    ctx,
    observed,
    startup: ctx.get(TUI_STARTUP_SERVICE),
  }
}

describe('tui command-line provider', () => {
  it('mints one main identity and publishes the matching resume line', () => {
    internals.randomUUID = () => 'fixed-id'
    const { ctx, observed, startup } = parse([])
    expect(startup).toEqual({ identity: { id: 'main-session-fixed-id', resume: false } })
    expect(ctx.get('mainSessionId')).toEqual(startup?.identity)
    expect(ctx.get('tuiGoodbyeMessage')).toBe('To resume this session: dsh tui --resume=main-session-fixed-id')
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('preserves an explicitly resumed persisted identity', () => {
    const { ctx, observed, startup } = parse(['--resume', 'persisted-session'])
    expect(startup).toEqual({ identity: { id: 'persisted-session', resume: true } })
    expect(ctx.get('mainSessionId')).toEqual(startup?.identity)
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('prints help without requiring a TTY and leaves the runner pending', () => {
    const { observed, startup } = parse(['--help'], false)
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([0])
    expect(observed.output).toContain('Usage: dsh tui')
    expect(observed.output).toContain('--resume <session>')
  })

  it('fails fast on a successful non-interactive launch', () => {
    const { observed, startup } = parse([], false)
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([1])
    expect(observed.output).toContain('requires interactive stdin and stdout TTYs')
  })

  it('rejects an empty resume identity before publishing startup', () => {
    const { observed, startup } = parse(['--resume='])
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([1])
    expect(observed.output).toContain('--resume needs a non-empty session id')
  })
})
