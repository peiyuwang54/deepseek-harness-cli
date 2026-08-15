import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { TuiRuntime } from '../src/runtime.ts'
import { createForkController, type ForkControllerDeps } from '../src/chat/fork.ts'

interface ForkHarness {
  readonly controller: ReturnType<typeof createForkController>
  readonly source: Session
  readonly child: Session
  readonly fork: ReturnType<typeof vi.fn<(source: Session) => Session>>
  readonly flush: ReturnType<typeof vi.fn<(target: Session) => Promise<boolean>>>
  readonly drainInput: ReturnType<typeof vi.fn<TuiRuntime['terminal']['drainInput']>>
  readonly host: NonNullable<TuiRuntime['handoffResume']>
  readonly releaseTerminal: ReturnType<typeof vi.fn<() => void>>
  readonly restoreTerminal: ReturnType<typeof vi.fn<() => void>>
  readonly notices: Array<{ message: string; kind: 'info' | 'warning' | 'error' | undefined }>
  setStatus(status: AgentStatus): void
  setDisposed(disposed: boolean): void
}

interface ForkHarnessOptions {
  readonly cwd?: string | null
  readonly status?: AgentStatus
  readonly persistence?: boolean
  readonly host?: TuiRuntime['handoffResume'] | null
}

function session(id: string, cwd?: string): Session {
  return {
    id: SessionId(id),
    header: {
      id: SessionId(id),
      createdAt: '2026-08-16T00:00:00.000Z',
      ...cwd === undefined ? {} : { cwd },
    },
    events: [],
  } as unknown as Session
}

function createHarness(options: ForkHarnessOptions = {}): ForkHarness {
  let status = options.status ?? 'idle'
  let disposed = false
  const source = session('source', options.cwd === null ? undefined : options.cwd ?? '/workspace')
  const child = session('child', source.header.cwd)
  const fork = vi.fn(() => child)
  const flush = vi.fn<(target: Session) => Promise<boolean>>(() => Promise.resolve(true))
  const persistence = options.persistence ?? true
  const ctx = {
    get: vi.fn(() => persistence ? {} : undefined),
    sessions: { fork, flush },
  } as unknown as Context
  const drainInput = vi.fn<TuiRuntime['terminal']['drainInput']>(() => Promise.resolve())
  const defaultHost = vi.fn<NonNullable<TuiRuntime['handoffResume']>>(
    () => Promise.reject(new Error('host retained process')),
  )
  const host = options.host === null ? undefined : options.host ?? defaultHost
  const releaseTerminal = vi.fn<() => void>()
  const restoreTerminal = vi.fn<() => void>()
  const notices: Array<{ message: string; kind: 'info' | 'warning' | 'error' | undefined }> = []
  const controller = createForkController({
    ctx,
    agent: { session: source } as Agent,
    runtime: {
      terminal: { drainInput } as unknown as TuiRuntime['terminal'],
      exit: vi.fn(),
      ...host === undefined ? {} : { handoffResume: host },
    },
    agentStatus: () => status,
    releaseTerminal,
    restoreTerminal,
    appendNotice: (message: string, kind?: 'info' | 'warning' | 'error') => { notices.push({ message, kind }) },
    isDisposed: () => disposed,
  } as unknown as ForkControllerDeps)
  return {
    controller,
    source,
    child,
    fork,
    flush,
    drainInput,
    host: host ?? vi.fn<NonNullable<TuiRuntime['handoffResume']>>(),
    releaseTerminal,
    restoreTerminal,
    notices,
    setStatus(next) { status = next },
    setDisposed(next) { disposed = next },
  }
}

async function settleFork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('current-session fork controller', () => {
  it('forks, flushes, and restores the terminal when the process host rejects', async () => {
    const harness = createHarness()

    expect(harness.controller.queueFork()).toBeUndefined()
    expect(harness.controller.queueFork()).toBe('A session fork is already in progress.')
    await settleFork()

    expect(harness.fork).toHaveBeenCalledWith(harness.source)
    expect(harness.flush.mock.calls).toEqual([[harness.child], [harness.source]])
    expect(harness.drainInput).toHaveBeenCalledWith(100, 20)
    expect(harness.host).toHaveBeenCalledWith(harness.child.id, '/workspace')
    expect(harness.releaseTerminal).toHaveBeenCalledOnce()
    expect(harness.restoreTerminal).toHaveBeenCalledOnce()
    expect(harness.notices).toEqual([{
      message: 'Forked session child remains available. Fork failed: host retained process',
      kind: 'error',
    }])
  })

  it('rejects every unsupported admission state before scheduling work', () => {
    expect(createHarness({ status: 'running' }).controller.queueFork())
      .toBe('/fork requires the current turn to finish or be cancelled first (status: running).')
    expect(createHarness({ cwd: null }).controller.queueFork())
      .toBe('/fork is unavailable because the current session has no workspace.')
    expect(createHarness({ host: null }).controller.queueFork())
      .toBe('/fork is unavailable because this host cannot switch sessions in place.')
    expect(createHarness({ persistence: false }).controller.queueFork())
      .toBe('/fork is unavailable because session persistence is not mounted.')
  })

  it('rechecks disposal and agent status before creating the child', async () => {
    const disposed = createHarness()
    expect(disposed.controller.queueFork()).toBeUndefined()
    disposed.setDisposed(true)
    await settleFork()
    expect(disposed.fork).not.toHaveBeenCalled()
    expect(disposed.notices).toEqual([])

    const busy = createHarness()
    expect(busy.controller.queueFork()).toBeUndefined()
    busy.setStatus('running')
    await settleFork()
    expect(busy.fork).not.toHaveBeenCalled()
    expect(busy.notices).toEqual([{
      message: 'Fork failed: Fork requires an idle agent (status: running).',
      kind: 'error',
    }])
  })

  it('reports an uncheckpointed child without releasing the terminal', async () => {
    const harness = createHarness()
    harness.flush.mockResolvedValueOnce(false)

    expect(harness.controller.queueFork()).toBeUndefined()
    await settleFork()

    expect(harness.releaseTerminal).not.toHaveBeenCalled()
    expect(harness.restoreTerminal).not.toHaveBeenCalled()
    expect(harness.notices[0]?.message).toContain('no session persistence checkpoint accepted the fork')
    expect(harness.notices[0]?.message).toContain('Forked session child remains available.')
  })

  it('rechecks disposal and status after both session flushes', async () => {
    const disposed = createHarness()
    disposed.flush.mockImplementation(async (target: Session) => {
      if (target === disposed.source) disposed.setDisposed(true)
      return true
    })
    expect(disposed.controller.queueFork()).toBeUndefined()
    await settleFork()
    expect(disposed.drainInput).not.toHaveBeenCalled()
    expect(disposed.notices).toEqual([])

    const busy = createHarness()
    busy.flush.mockImplementation(async (target: Session) => {
      if (target === busy.source) busy.setStatus('running')
      return true
    })
    expect(busy.controller.queueFork()).toBeUndefined()
    await settleFork()
    expect(busy.releaseTerminal).not.toHaveBeenCalled()
    expect(busy.notices[0]?.message).toContain('Fork requires an idle agent (status: running).')
  })

  it('does not release the terminal when disposal occurs while draining input', async () => {
    const harness = createHarness()
    harness.drainInput.mockImplementation(async () => { harness.setDisposed(true) })

    expect(harness.controller.queueFork()).toBeUndefined()
    await settleFork()

    expect(harness.releaseTerminal).not.toHaveBeenCalled()
    expect(harness.notices).toEqual([])
  })

  it('reports a host that returns and suppresses recovery output after disposal', async () => {
    const returningHost = vi.fn(() => Promise.resolve(undefined as never))
    const returned = createHarness({ host: returningHost })
    expect(returned.controller.queueFork()).toBeUndefined()
    await settleFork()
    expect(returned.restoreTerminal).toHaveBeenCalledOnce()
    expect(returned.notices[0]?.message).toContain('fork host returned without replacing the process')

    let rejectHost: ((error: Error) => void) | undefined
    const deferredHost = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectHost = reject }))
    const disposed = createHarness({ host: deferredHost })
    expect(disposed.controller.queueFork()).toBeUndefined()
    await settleFork()
    disposed.setDisposed(true)
    rejectHost?.(new Error('late host failure'))
    await Promise.resolve()
    expect(disposed.releaseTerminal).toHaveBeenCalledOnce()
    expect(disposed.restoreTerminal).not.toHaveBeenCalled()
    expect(disposed.notices).toEqual([])
  })

  it('cancels a queued timer during disposal and accepts disposal without a timer', async () => {
    const harness = createHarness()
    harness.controller.dispose()
    expect(harness.controller.queueFork()).toBeUndefined()
    harness.controller.dispose()
    await settleFork()

    expect(harness.fork).not.toHaveBeenCalled()
    expect(harness.controller.queueFork()).toBeUndefined()
    await settleFork()
    expect(harness.fork).toHaveBeenCalledOnce()
  })
})
