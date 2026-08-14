import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
  ModelSelection,
  ModelSelectionRef,
  ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  type Session,
  type SessionEvent,
  type SessionEventType,
  type SessionHeader,
  type UserMessage,
} from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import {
  openTerminalSession,
  summarizeTurn,
  TerminalCliSession,
} from '../src/session.ts'

const installedSelections = vi.hoisted((): unknown[] => [])
vi.mock('@deepseek-ai/dsh-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-agent')>()
  return {
    ...actual,
    installModelSelection(ctx: Context, selection: ModelSelectionRef) {
      installedSelections.push(selection)
      return actual.installModelSelection(ctx, selection)
    },
  }
})

function event<T extends SessionEventType>(type: T, data: SessionEvent<T>['data'], seq: number): SessionEvent<T> {
  return { type, data, seq, time: 1 } as SessionEvent<T>
}

function assistant(seq: number, text: string, turn = 1, step = 1): SessionEvent<'assistant/message'> {
  return event('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'test-provider', model: 'test-model' },
    }),
  }, seq)
}

function header(
  id: string,
  createdAt: number,
  cwd: string | undefined = process.cwd(),
  origin?: 'subagent',
  agentPreset?: string,
): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt,
    ...cwd === undefined ? {} : { cwd },
    ...origin === undefined ? {} : { origin },
    ...agentPreset === undefined ? {} : { agentPreset },
  }
}

interface OpeningBench {
  ctx: Context
  capture: {
    create?: CreateAgentOptions
    resume?: ResumeAgentOptions
    disposed: number
  }
  setDefaults(next: ModelSelection): void
}

async function openingBench(options: {
  headers?: SessionHeader[]
  defaults?: ModelSelection
  inspectionEvents?: Readonly<Record<string, readonly SessionEvent[]>>
  seed?(session: Session): void
} = {}): Promise<OpeningBench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  let defaults = options.defaults ?? { provider: 'default-provider', model: 'default-model' }
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ ...defaults }),
  } as never)
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve(options.headers ?? []),
    inspect: (id: SessionId) => {
      const meta = (options.headers ?? []).find(candidate => candidate.id === id)
      if (meta === undefined) return Promise.reject(new Error(`missing inspection ${id}`))
      return Promise.resolve({ meta, events: options.inspectionEvents?.[String(id)] ?? [] })
    },
  } as never)
  const capture: OpeningBench['capture'] = { disposed: 0 }

  const makeHandle = async (
    ownerCtx: Context,
    id: SessionId,
    meta: { cwd?: string; createdAt?: number } | undefined,
    agentOptions: CreateAgentOptions['agentOptions'],
    setup: CreateAgentOptions['setup'],
  ): Promise<AgentHandle> => {
    const session = ctx.sessions.create(id, {
      ...meta === undefined ? {} : { meta },
    })
    const agent = {} as Agent
    const agentCtx = ownerCtx.extend({ agent })
    Object.assign(agent, {
      id,
      options: agentOptions ?? {},
      session,
      status: 'idle',
      ctx: agentCtx,
      cancel: vi.fn(),
      whenIdle: vi.fn(() => Promise.resolve()),
      followup: vi.fn(),
    } satisfies Partial<Agent>)
    options.seed?.(session)
    await setup?.(agentCtx)
    const unregister = ctx.agents.register(agent)
    return {
      agent,
      async dispose() {
        capture.disposed += 1
        unregister()
      },
    }
  }

  ctx.agents.setFactory({
    async createAgent(ownerCtx, createOptions) {
      capture.create = createOptions
      return await makeHandle(
        ownerCtx,
        createOptions.sessionId,
        createOptions.meta,
        createOptions.agentOptions,
        createOptions.setup,
      )
    },
    async resume(ownerCtx, resumeOptions) {
      capture.resume = resumeOptions
      const stored = (options.headers ?? []).find(candidate => candidate.id === resumeOptions.resumeSessionId)
      return await makeHandle(
        ownerCtx,
        resumeOptions.resumeSessionId,
        stored === undefined
          ? undefined
          : {
            ...stored.cwd === undefined ? {} : { cwd: stored.cwd },
            createdAt: stored.createdAt,
          },
        resumeOptions.agentOptions,
        resumeOptions.setup,
      )
    },
  })

  return {
    ctx,
    capture,
    setDefaults(next) { defaults = next },
  }
}

describe('summarizeTurn', () => {
  it('uses only the owned started interval and keeps its last visible message and boundary', () => {
    const events: SessionEvent[] = [
      event('turn/start', { turn: 0 }, 0),
      assistant(1, 'old answer', 0),
      event('turn/end', { turn: 0, reason: { kind: 'completed' } }, 2),
      assistant(3, 'between-turn noise'),
      event('turn/start', { turn: 1 }, 4),
      assistant(5, 'first answer'),
      event('assistant/message', {
        turn: 1,
        step: 2,
        message: createAssistantMessage({
          content: [{ type: 'reasoning', text: 'not visible' }],
          source: { provider: 'test-provider', model: 'test-model' },
        }),
      }, 6),
      assistant(7, 'final answer', 1, 3),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 8),
      event('turn/end', {
        turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } },
      }, 9),
    ]

    expect(summarizeTurn(events, 3)).toEqual({
      text: 'final answer',
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    })
  })

  it('returns an empty outcome when the interval never starts a turn', () => {
    expect(summarizeTurn([assistant(0, 'noise')], 0)).toEqual({ text: '', reason: undefined })
  })
})

describe('TerminalCliSession', () => {
  it('drives one idle-to-idle turn, flushes it, exposes selection, cancels, and closes in order', async () => {
    const events: SessionEvent[] = []
    const fakeSession = {
      get seq() { return events.length },
      get events() { return events },
    } as unknown as Session
    const order: string[] = []
    let delivered: UserMessage | undefined
    const cancel = vi.fn(() => { order.push('cancel') })
    const agent = {
      id: SessionId('direct-session'),
      session: fakeSession,
      whenIdle: vi.fn(async () => { order.push('idle') }),
      followup: vi.fn((message: UserMessage) => {
        delivered = message
        order.push('followup')
        events.push(
          event('turn/start', { turn: 1 }, 0),
          assistant(1, 'answer'),
          event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2),
        )
      }),
      cancel,
    } as unknown as Agent
    const handle: AgentHandle = {
      agent,
      dispose: vi.fn(async () => { order.push('dispose') }),
    }
    const ctx = new Context()
    ctx.provide('sessions', {
      flush: vi.fn(async () => { order.push('flush'); return true }),
    } as never)
    let selection: ModelSelection = { provider: 'p', model: 'm' }
    const terminal = new TerminalCliSession(ctx, handle, () => selection)

    expect(terminal.agent).toBe(agent)
    expect(terminal.selection()).toEqual({ provider: 'p', model: 'm' })
    selection = { provider: 'p2', model: 'm2', reasoningEffort: ReasoningEffortId('high') }
    expect(terminal.selection()).toEqual(selection)
    await expect(terminal.runTurn('do it')).resolves.toEqual({
      text: 'answer', reason: { kind: 'completed' },
    })
    expect(delivered).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'do it' }],
      source: { kind: 'user' },
    })
    expect(order).toEqual(['idle', 'followup', 'idle', 'flush'])

    terminal.cancel()
    await terminal.close()
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(order).toEqual(['idle', 'followup', 'idle', 'flush', 'cancel', 'idle', 'flush', 'dispose'])
    await ctx.fiber.dispose()
  })

  it.each([
    {
      name: 'flush',
      flushError: new Error('flush failed'),
      disposeError: undefined,
      message: 'flush failed',
    },
    {
      name: 'dispose',
      flushError: undefined,
      disposeError: new Error('dispose failed'),
      message: 'dispose failed',
    },
    {
      name: 'flush and dispose',
      flushError: new Error('flush failed'),
      disposeError: new Error('dispose failed'),
      message: 'Session flush and disposal both failed',
    },
    {
      name: 'non-Error flush rejection',
      flushError: 'plain flush rejection' as unknown as Error,
      disposeError: undefined,
      message: 'terminal CLI Session flush rejected: plain flush rejection',
    },
  ])('releases its Agent exactly once when $name fails', async ({ flushError, disposeError, message }) => {
    const ctx = new Context()
    const whenIdle = vi.fn(() => Promise.resolve())
    const agent = {
      id: SessionId('failing-close'),
      session: {} as Session,
      whenIdle,
    } as unknown as Agent
    const flush = vi.fn(async () => {
      if (flushError !== undefined) throw flushError
    })
    ctx.provide('sessions', { flush } as never)
    const dispose = vi.fn(async () => {
      if (disposeError !== undefined) throw disposeError
    })
    const terminal = new TerminalCliSession(ctx, { agent, dispose }, () => ({ provider: 'p', model: 'm' }))

    await expect(terminal.close()).rejects.toThrow(message)
    await expect(terminal.close()).rejects.toThrow(message)
    expect(whenIdle).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })
})

describe('openTerminalSession', () => {
  it('creates a fresh cwd-bound Session with explicit model and permission overrides', async () => {
    const bench = await openingBench({
      defaults: {
        provider: 'default-provider',
        model: 'default-model',
        reasoningEffort: ReasoningEffortId('medium'),
      },
    })

    const terminal = await openTerminalSession(bench.ctx, 'interactive', {
      provider: 'cli-provider',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
      approval: 'ask',
    })

    expect(bench.capture.create?.sessionId).toMatch(/^session-/u)
    expect(bench.capture.create?.meta).toEqual({ cwd: process.cwd() })
    expect(bench.capture.create?.agentOptions).toEqual({
      provider: 'cli-provider', model: 'default-model',
    })
    expect(terminal.selection()).toEqual({
      provider: 'cli-provider',
      model: 'default-model',
      reasoningEffort: ReasoningEffortId('high'),
    })
    const installed = installedSelections.at(-1) as ModelSelectionRef
    expect(installed.current).toEqual(terminal.selection())
    installed.current = { provider: 'picked-provider', model: 'picked-model' }
    expect(installed.current).toEqual({ provider: 'picked-provider', model: 'picked-model' })
    installed.current = undefined
    expect(installed.current).toEqual(terminal.selection())
    const setup = bench.capture.create?.setup
    expect(() => { void setup?.(new Context()) }).toThrow('Agent setup has no scoped Agent')
    expect(terminal.agent.session.events.filter(entry => entry.type === 'sandbox/mode'))
      .toHaveLength(1)
    expect(terminal.agent.session.events.filter(entry => entry.type === 'approval/policy'))
      .toHaveLength(1)

    await terminal.close()
    expect(bench.capture.disposed).toBe(1)
    await bench.ctx.fiber.dispose()
  })

  it('does not append redundant permission overrides', async () => {
    const bench = await openingBench({
      seed(session) {
        setSandboxMode(session, 'read-only')
        setApprovalPolicy(session, 'never')
      },
    })

    const terminal = await openTerminalSession(bench.ctx, 'exec', {
      sandbox: 'read-only', approval: 'never',
    })

    expect(terminal.agent.session.events.filter(entry => entry.type === 'sandbox/mode')).toHaveLength(1)
    expect(terminal.agent.session.events.filter(entry => entry.type === 'approval/policy')).toHaveLength(1)
    await terminal.close()
    await bench.ctx.fiber.dispose()
  })

  it('reads defaults live before a request when no logged selection exists', async () => {
    const bench = await openingBench()
    const terminal = await openTerminalSession(bench.ctx, 'exec', {})

    expect(bench.capture.create?.agentOptions).toEqual({
      provider: 'default-provider', model: 'default-model',
    })
    bench.setDefaults({
      provider: 'new-provider',
      model: 'new-model',
      reasoningEffort: ReasoningEffortId('low'),
    })
    expect(terminal.selection()).toEqual({
      provider: 'new-provider',
      model: 'new-model',
      reasoningEffort: ReasoningEffortId('low'),
    })

    await terminal.close()
    await bench.ctx.fiber.dispose()
  })

  it('prefers logged selection on resume, then merges only explicit CLI fields', async () => {
    const stored = header('stored', 10)
    const bench = await openingBench({
      headers: [stored],
      seed(session) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('request/header', {
          header: {
            config: {
              provider: 'logged-provider',
              model: 'logged-model',
              reasoningEffort: ReasoningEffortId('logged-effort'),
            },
          },
          reason: 'initial',
        })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    })

    const terminal = await openTerminalSession(bench.ctx, 'resume', {
      sessionId: 'stored', model: 'cli-model',
    })

    expect(bench.capture.resume?.resumeSessionId).toBe('stored')
    expect(bench.capture.resume?.agentOptions).toEqual({
      provider: 'default-provider', model: 'cli-model',
    })
    expect(terminal.selection()).toEqual({
      provider: 'logged-provider',
      model: 'cli-model',
    })
    terminal.agent.session.append('turn/start', { turn: 2 })
    terminal.agent.session.append('step/start', { turn: 2, step: 1 })
    terminal.agent.session.append('request/header', {
      header: { config: { provider: 'logged-provider-2', model: 'logged-model-2' } },
      reason: 'change',
    })
    terminal.agent.session.append('step/end', { turn: 2, step: 1 })
    terminal.agent.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(terminal.selection()).toEqual({
      provider: 'logged-provider-2', model: 'cli-model',
    })

    await terminal.close()
    await bench.ctx.fiber.dispose()
  })

  it('selects the newest eligible cwd Session, using descending id as the tie-breaker', async () => {
    const headers = [
      header('older', 1),
      header('tie-a', 5),
      header('tie-b', 5),
      header('newer-other-cwd', 20, '/other'),
      header('newer-subagent', 30, process.cwd(), 'subagent'),
      header('newer-selected-preset', 35),
      header('newer-preset', 40, process.cwd(), undefined, 'code'),
    ]
    const bench = await openingBench({
      headers,
      inspectionEvents: {
        'newer-selected-preset': [event('agent-preset/selected', { agentPreset: 'minimal' }, 0)],
      },
    })

    const terminal = await openTerminalSession(bench.ctx, 'resume', {})

    expect(bench.capture.resume?.resumeSessionId).toBe('tie-b')
    await terminal.close()
    await bench.ctx.fiber.dispose()
  })

  it('fails when no resumable Session exists in the current cwd', async () => {
    const ctx = new Context()
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'p', model: 'm' }),
    } as never)
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([
        header('foreign', 2, '/other'),
        header('child', 3, process.cwd(), 'subagent'),
      ]),
    } as never)

    await expect(openTerminalSession(ctx, 'resume', {}))
      .rejects.toThrow(`no resumable Session was found in ${process.cwd()}`)
    await ctx.fiber.dispose()
  })

  it.each([
    {
      name: 'missing',
      requested: 'missing',
      headers: [header('present', 1)],
      message: 'Session "missing" was not found',
    },
    {
      name: 'subagent',
      requested: 'child',
      headers: [header('child', 1, process.cwd(), 'subagent')],
      message: 'Session "child" belongs to a subagent and cannot be resumed as a terminal root',
    },
    {
      name: 'other cwd',
      requested: 'foreign',
      headers: [header('foreign', 1, '/other')],
      message: 'Session "foreign" belongs to /other; relaunch with -C for that workspace',
    },
    {
      name: 'Agent preset',
      requested: 'preset',
      headers: [header('preset', 1, process.cwd(), undefined, 'minimal')],
      message: 'Session "preset" uses Agent preset "minimal" and cannot be resumed by the terminal CLI profile',
    },
    {
      name: 'missing cwd',
      requested: 'legacy',
      headers: [{ version: SESSION_FORMAT_VERSION, id: SessionId('legacy'), createdAt: 1 }],
      message: 'Session "legacy" belongs to <no cwd>; relaunch with -C for that workspace',
    },
    {
      name: 'log-selected Agent preset',
      requested: 'selected-preset',
      headers: [header('selected-preset', 1)],
      inspectEvents: [event('agent-preset/selected', { agentPreset: 'code' }, 0)],
      message: 'Session "selected-preset" uses Agent preset "code" and cannot be resumed by the terminal CLI profile',
    },
  ])('rejects an explicitly requested $name Session', async ({ requested, headers, message, inspectEvents }) => {
    const ctx = new Context()
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'p', model: 'm' }),
    } as never)
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve(headers),
      inspect: (id: SessionId) => {
        const meta = headers.find(candidate => candidate.id === id)
        if (meta === undefined) return Promise.reject(new Error(`missing inspection ${id}`))
        return Promise.resolve({ meta, events: inspectEvents ?? [] })
      },
    } as never)

    await expect(openTerminalSession(ctx, 'resume', { sessionId: requested })).rejects.toThrow(message)
    await ctx.fiber.dispose()
  })
})
