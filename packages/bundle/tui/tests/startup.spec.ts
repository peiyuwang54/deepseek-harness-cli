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
    expect(startup).toEqual({ identity: { id: 'main-session-fixed-id', resume: false }, permissionMode: 'default', additionalWritableRoots: [] })
    expect(ctx.get('mainSessionId')).toEqual(startup?.identity)
    expect(ctx.get('tuiGoodbyeMessage')).toBe('To resume this session: deepseek --resume=main-session-fixed-id')
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('preserves an explicitly resumed persisted identity', () => {
    const { ctx, observed, startup } = parse(['--resume', 'persisted-session'])
    expect(startup).toEqual({ identity: { id: 'persisted-session', resume: true }, permissionMode: 'default', additionalWritableRoots: [] })
    expect(ctx.get('mainSessionId')).toEqual(startup?.identity)
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('collects repeatable additional writable directories', () => {
    const { observed, startup } = parse(['--add-dir', '../shared', '--add-dir=/tmp/cache'])
    expect(startup?.additionalWritableRoots).toEqual(['../shared', '/tmp/cache'])
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('publishes independent sandbox and approval selections', () => {
    const { observed, startup } = parse([
      '--sandbox', 'read-only', '--ask-for-approval', 'never',
    ])
    expect(startup).toMatchObject({
      permissionMode: 'default',
      permissionPolicy: { sandbox: 'read-only', approval: 'never' },
    })
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('publishes unrestricted startup intent for the yolo flag', () => {
    const { observed, startup } = parse(['--yolo'])
    expect(startup).toMatchObject({
      identity: { resume: false },
      permissionMode: 'yolo',
    })
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('accepts the official long alias for unrestricted startup', () => {
    const { observed, startup } = parse(['--dangerously-bypass-approvals-and-sandbox'])
    expect(startup).toMatchObject({ permissionMode: 'yolo' })
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('publishes workspace-confined unattended startup intent for full-auto', () => {
    const { observed, startup } = parse(['--full-auto'])
    expect(startup).toMatchObject({ permissionMode: 'full-auto' })
    expect(observed).toEqual({ exits: [], output: '' })
  })

  it('rejects conflicting permission shortcuts', () => {
    const { observed, startup } = parse(['--full-auto', '--yolo'])
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([1])
    expect(observed.output).toContain('mutually exclusive')
  })

  it('rejects combining a permission shortcut with an independent knob', () => {
    const { observed, startup } = parse(['--full-auto', '--sandbox', 'read-only'])
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([1])
    expect(observed.output).toContain('cannot be combined')
  })

  it('rejects an unknown sandbox mode', () => {
    const { observed, startup } = parse(['--sandbox', 'unknown'])
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([1])
    expect(observed.output).toContain('Allowed choices are')
  })

  it('prints help without requiring a TTY and leaves the runner pending', () => {
    const { observed, startup } = parse(['--help'], false)
    expect(startup).toBeUndefined()
    expect(observed.exits).toEqual([0])
    expect(observed.output).toContain('Usage: deepseek')
    expect(observed.output).toContain('--resume <session>')
    expect(observed.output).toContain('--add-dir <dir>')
    expect(observed.output).toContain('--sandbox <mode>')
    expect(observed.output).toContain('--ask-for-approval <policy>')
    expect(observed.output).toContain('--full-auto')
    expect(observed.output).toContain('--yolo')
    expect(observed.output).toContain('--dangerously-bypass-approvals-and-sandbox')
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
