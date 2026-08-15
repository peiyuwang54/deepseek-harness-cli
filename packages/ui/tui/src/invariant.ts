/** Package-owned durable TUI event invariants. @module @deepseek-ai/dsh-tui/invariant */

/* jscpd:ignore-start */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './chat/user-shell.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui'

/** Cordis companion plugin name. */
export const name = 'tui-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

interface UserShellTrace {
  starts: Set<string>
  settled: Set<string>
}

type UserShellTransition = { kind: 'start' | 'result'; id: string }

/** Validate one direct-shell event against the committed pairing state. */
function validateUserShellEvent(
  trace: UserShellTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): UserShellTransition | undefined {
  if (event.type === 'tui/user-shell-start') {
    if (event.data.id.length === 0 || event.data.command.trim().length === 0) {
      fail('tui/user-shell-start id and command must be non-empty')
    }
    if (!isAbsolute(event.data.cwd)) fail('tui/user-shell-start cwd must be absolute')
    if (trace.starts.has(event.data.id)) {
      fail(`tui/user-shell-start repeats id ${JSON.stringify(event.data.id)}`)
    }
    return { kind: 'start', id: event.data.id }
  }
  if (event.type !== 'tui/user-shell-result') return undefined
  if (!trace.starts.has(event.data.id) || trace.settled.has(event.data.id)) {
    fail(`tui/user-shell-result has no unmatched start for ${JSON.stringify(event.data.id)}`)
  }
  if (!Number.isFinite(event.data.durationMs) || event.data.durationMs < 0) {
    fail('tui/user-shell-result durationMs must be a non-negative finite number')
  }
  const result = event.data.result
  if (result.exitCode !== null && (!Number.isSafeInteger(result.exitCode) || result.exitCode < 0)) {
    fail('tui/user-shell-result exitCode must be null or a non-negative safe integer')
  }
  if (typeof result.timedOut !== 'boolean' || typeof result.aborted !== 'boolean') {
    fail('tui/user-shell-result timedOut and aborted must be booleans')
  }
  if (typeof result.stdout.text !== 'string' || typeof result.stdout.truncated !== 'boolean'
    || typeof result.stderr.text !== 'string' || typeof result.stderr.truncated !== 'boolean') {
    fail('tui/user-shell-result stdout and stderr must be captured outputs')
  }
  return { kind: 'result', id: event.data.id }
}

/** Apply one validated pairing transition. */
function applyTransition(trace: UserShellTrace, transition: UserShellTransition): void {
  if (transition.kind === 'start') trace.starts.add(transition.id)
  else trace.settled.add(transition.id)
}

/** Install loaded-log and pre-commit checks for direct-shell event pairs. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, UserShellTrace>()
  const staged = new WeakMap<SessionEvent, { session: Session; transition: UserShellTransition }>()
  const seed = (session: Session): UserShellTrace => {
    const trace: UserShellTrace = { starts: new Set(), settled: new Set() }
    traces.set(session, trace)
    for (const event of session.events) {
      const transition = validateUserShellEvent(trace, event, fail)
      if (transition !== undefined) applyTransition(trace, transition)
    }
    return trace
  }
  const traceFor = (session: Session): UserShellTrace => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const transition = validateUserShellEvent(traceFor(session), event, fail)
    if (transition !== undefined) staged.set(event, { session, transition })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'tui/user-shell-start' && event.type !== 'tui/user-shell-result') return
    const candidate = staged.get(event)
    /* v8 ignore next -- internal/dispatch stages every TUI shell event. */
    if (candidate === undefined || candidate.session !== session) {
      fail('TUI user-shell event published without pre-commit validation')
      return
    }
    staged.delete(event)
    applyTransition(traceFor(session), candidate.transition)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the TUI package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
