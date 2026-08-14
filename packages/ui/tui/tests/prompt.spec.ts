import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TuiPromptService, {
  parseTuiPromptTemplate,
  renderTuiPromptTemplate,
} from '../src/prompt.ts'

const tick = (): Promise<void> => new Promise((resolve) => { queueMicrotask(resolve) })

describe('TUI prompt values', () => {
  it('registers, updates, and disposes mutable values', async () => {
    const ctx = new Context()
    await ctx.plugin(TuiPromptService)

    const value = ctx.tuiPrompt.register('git/worktree', '\x1b[32m(main)\x1b[0m')
    expect(ctx.tuiPrompt.get('git/worktree')).toBe('\x1b[32m(main)\x1b[0m')
    value.set('next')
    expect(ctx.tuiPrompt.get('git/worktree')).toBe('next')

    value.set(undefined)
    expect(ctx.tuiPrompt.get('git/worktree')).toBeUndefined()
    value.dispose()
    expect(() => { value.set('late') }).toThrow(/disposed/)
    await ctx.fiber.dispose()
  })

  it('coalesces a change burst into one notification and contains each observer', async () => {
    const ctx = new Context()
    await ctx.plugin(TuiPromptService)
    // Capture the containment warnings so the rejected-promise and sync-throw
    // paths are each pinned (removing either catch drops its warning).
    const warnings: string[] = []
    ctx.logger.warn = ((message: string) => void warnings.push(message)) as typeof ctx.logger.warn
    // A synchronous thrower, an async rejecter, and a thrower whose error is
    // hostile to string coercion all sit BEFORE the observed listener, so
    // proving `after` still runs proves none of them starves it (a naive
    // `String(error)` inside the containment would itself throw on the last).
    const hostile = { toString() { throw new Error('hostile coercion') } }
    const thrower = vi.fn(() => { throw new Error('sync observer boom') })
    const rejecter = vi.fn(async () => { throw new Error('async observer boom') })
    const hostileThrower = vi.fn(() => { throw hostile })
    const after = vi.fn()
    ctx.tuiPrompt.subscribe(thrower)
    ctx.tuiPrompt.subscribe(rejecter)
    ctx.tuiPrompt.subscribe(hostileThrower)
    const unsubscribe = ctx.tuiPrompt.subscribe(after)
    await tick() // drain the registration notifications
    thrower.mockClear()
    rejecter.mockClear()
    hostileThrower.mockClear()
    after.mockClear()

    const value = ctx.tuiPrompt.register('git/worktree', 'a')
    value.set('b')
    value.set('b') // unchanged: no additional schedule
    value.set('c')
    await tick()
    await tick() // settle the contained rejected promise
    // One coalesced callback for the whole burst; a throwing, rejecting, or
    // hostile-to-render observer is contained and does not stop later observers.
    expect(thrower).toHaveBeenCalledTimes(1)
    expect(rejecter).toHaveBeenCalledTimes(1)
    expect(hostileThrower).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(1)
    // Each contained failure logged its own warning: the sync throw, the
    // rejected promise, and the hostile-to-render throw (via non-throwing
    // errorChain). Pinning the rejected-promise warning fails if its `.catch`
    // containment is removed.
    expect(warnings.some(w => w.includes('threw: sync observer boom'))).toBe(true)
    expect(warnings.some(w => w.includes('rejected: async observer boom'))).toBe(true)
    expect(warnings.some(w => w.includes('threw: <unrenderable value>'))).toBe(true)

    // Unsubscribe stops further notifications for that listener.
    unsubscribe()
    value.set('d')
    await tick()
    expect(after).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('removes a subscription when the subscriber fiber disposes', async () => {
    const ctx = new Context()
    await ctx.plugin(TuiPromptService)
    const observed = vi.fn()
    // Subscribe from a child plugin fiber that shares the service, then dispose
    // only that fiber; the effect-owned subscription must go with it.
    const child = ctx.plugin({
      inject: ['tuiPrompt'],
      apply: (childCtx) => { childCtx.tuiPrompt.subscribe(observed) },
    })
    await tick()
    observed.mockClear()
    await child.dispose()

    const value = ctx.tuiPrompt.register('git/worktree', 'a')
    value.set('b')
    await tick()
    expect(observed).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('keeps one fiber\'s subscription when another disposes the same callback', async () => {
    const ctx = new Context()
    await ctx.plugin(TuiPromptService)
    // Both fibers subscribe the SAME function reference. Per-subscription record
    // identity (not callback identity) keeps them independent, so disposing one
    // must not silence the other.
    const shared = vi.fn()
    const first = ctx.plugin({ inject: ['tuiPrompt'], apply: (c) => { c.tuiPrompt.subscribe(shared) } })
    ctx.plugin({ inject: ['tuiPrompt'], apply: (c) => { c.tuiPrompt.subscribe(shared) } })
    await tick()
    await first.dispose()
    shared.mockClear()

    const value = ctx.tuiPrompt.register('git/worktree', 'a')
    value.set('b')
    await tick()
    // The second fiber's subscription survives the first's disposal.
    expect(shared).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('does not notify a subscription unsubscribed earlier in the same burst', async () => {
    const ctx = new Context()
    await ctx.plugin(TuiPromptService)
    const victim = vi.fn()
    // This listener is delivered first (subscribed first) and synchronously
    // unsubscribes the victim during the same notification. The snapshot must
    // re-check liveness so the later victim record does not fire this burst.
    ctx.tuiPrompt.subscribe(() => { unsubscribeVictim() })
    const unsubscribeVictim = ctx.tuiPrompt.subscribe(victim)
    await tick()
    victim.mockClear()

    const value = ctx.tuiPrompt.register('git/worktree', 'a')
    value.set('b')
    await tick()
    expect(victim).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects invalid and duplicate names', async () => {
    const ctx = new Context()
    await ctx.plugin(TuiPromptService)
    expect(() => ctx.tuiPrompt.register('Bad Name')).toThrow(/must match/)
    ctx.tuiPrompt.register('status')
    expect(() => ctx.tuiPrompt.register('status')).toThrow(/already registered/)
    await ctx.fiber.dispose()
  })
})

describe('TUI prompt templates', () => {
  it('interpolates values and removes separators around unavailable values', () => {
    const tokens = parseTuiPromptTemplate('${cwd} ${git/worktree} :: ${missing} ${model}')
    const values = new Map([['cwd', '/work'], ['model', 'deepseek-official']])
    expect(renderTuiPromptTemplate(tokens, name => values.get(name))).toBe('/work :: deepseek-official')
  })

  it('keeps a trailing literal after the last value', () => {
    const tokens = parseTuiPromptTemplate('${symbol} ${indicator} > ')
    const values = new Map([['symbol', 'dsh'], ['indicator', '●']])
    expect(renderTuiPromptTemplate(tokens, name => values.get(name))).toBe('dsh ● > ')
  })

  it('preserves trusted ANSI fragments', () => {
    const powerline = '\x1b[44m work \x1b[34;46m\x1b[0m'
    expect(renderTuiPromptTemplate(parseTuiPromptTemplate('${powerline}'), () => powerline)).toBe(powerline)
  })
})
