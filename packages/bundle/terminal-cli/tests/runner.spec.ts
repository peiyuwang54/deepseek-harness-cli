import { PassThrough, Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { AppInterrupt } from '@deepseek-ai/dsh-cmdline'
import { CommandId, type CommandDescriptor, type CommandExecution } from '@deepseek-ai/dsh-commands'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionEvent,
  type SessionEventMap,
  type UserMessage,
} from '@deepseek-ai/dsh-session'
import type { TerminalCliStartupValues } from '../src/startup.ts'
import type { CliInput, CliOutput, TerminalCliIo } from '../src/io.ts'
import type { TerminalCliJsonEvent } from '../src/render.ts'
import type { TerminalCliSession } from '../src/session.ts'

type OpenSession = typeof import('../src/session.ts')['openTerminalSession']
type ResolvePrompt = typeof import('../src/io.ts')['resolveExecPrompt']
type LineAnswer = string | undefined | Error | Promise<string | undefined>

interface LineScript {
  answers: LineAnswer[]
  prompts: Array<{ prompt: string; signal?: AbortSignal }>
  closeCount: number
  interrupt?: () => void
  onClose?: () => void
}

const runnerState = vi.hoisted(() => ({
  openSession: undefined as OpenSession | undefined,
  resolvePrompt: undefined as ResolvePrompt | undefined,
  lines: [] as LineScript[],
  interactionInstalls: 0,
  interactionDisposals: 0,
}))

vi.mock('../src/session.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/session.ts')>()
  return {
    ...actual,
    async openTerminalSession(...args: Parameters<OpenSession>): ReturnType<OpenSession> {
      const open = runnerState.openSession
      if (open === undefined) throw new Error('runner test did not provide a Session')
      return await open(...args)
    },
  }
})

vi.mock('../src/io.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/io.ts')>()
  class ScriptedLineInput {
    private readonly script: LineScript

    constructor(_input: CliInput, _output: CliOutput, onInterrupt: () => void) {
      const script = runnerState.lines.shift()
      if (script === undefined) throw new Error('runner test did not provide line input')
      this.script = script
      script.interrupt = onInterrupt
    }

    async read(prompt: string, signal?: AbortSignal): Promise<string | undefined> {
      this.script.prompts.push({ prompt, ...signal === undefined ? {} : { signal } })
      const answer = this.script.answers.shift()
      if (answer instanceof Error) throw answer
      return await Promise.resolve(answer)
    }

    close(): void {
      this.script.closeCount += 1
      this.script.onClose?.()
    }
  }
  return {
    ...actual,
    LineInput: ScriptedLineInput,
    async resolveExecPrompt(...args: Parameters<ResolvePrompt>): ReturnType<ResolvePrompt> {
      return await (runnerState.resolvePrompt ?? actual.resolveExecPrompt)(...args)
    },
  }
})

vi.mock('../src/interactions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/interactions.ts')>()
  return {
    ...actual,
    installTerminalInteractions(): () => void {
      runnerState.interactionInstalls += 1
      return () => { runnerState.interactionDisposals += 1 }
    },
  }
})

import { internals as processIo } from '../src/io.ts'
import { apply } from '../src/index.ts'
import { TerminalCliSession as RealTerminalCliSession } from '../src/session.ts'

const originalProcessIo = { ...processIo }

function lineScript(...answers: LineAnswer[]): LineScript {
  return { answers: [...answers], prompts: [], closeCount: 0 }
}

interface CapturedOutput {
  stream: CliOutput
  text(): string
}

function capturedOutput(isTTY: boolean): CapturedOutput {
  let text = ''
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk)
      callback()
    },
  }) as CliOutput
  stream.isTTY = isTTY
  return { stream, text: () => text }
}

function installIo(options: {
  stdinTTY?: boolean
  stdoutTTY?: boolean
  stdin?: string
} = {}): { io: Pick<TerminalCliIo, 'stdin' | 'stdout' | 'stderr'>; stdout: CapturedOutput; stderr: CapturedOutput } {
  const stdinStream = new PassThrough()
  const stdin = stdinStream as CliInput
  stdin.isTTY = options.stdinTTY ?? true
  stdinStream.end(options.stdin ?? '')
  const stdout = capturedOutput(options.stdoutTTY ?? true)
  const stderr = capturedOutput(false)
  const io = { stdin, stdout: stdout.stream, stderr: stderr.stream }
  Object.assign(processIo, io)
  return { io, stdout, stderr }
}

function baseContext(commands?: {
  list(agent: Agent): readonly CommandDescriptor[]
  execute(agent: Agent, line: string, signal: AbortSignal): Promise<CommandExecution | undefined>
}): Context {
  const ctx = new Context()
  ctx.provide('tools', { get: () => undefined } as never)
  ctx.provide('commands', commands ?? {
    list: () => [],
    execute: () => Promise.resolve(undefined),
  } as never)
  return ctx
}

function eventJson(text: string): TerminalCliJsonEvent[] {
  return text.trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as TerminalCliJsonEvent)
}

function launch(ctx: Context, startup: TerminalCliStartupValues): {
  exited: Promise<number>
  codes: number[]
} {
  const codes: number[] = []
  const exit = Promise.withResolvers<number>()
  ctx.provide('terminalCliStartup', { value: startup })
  ctx.provide('appExit', (code: number) => {
    codes.push(code)
    exit.resolve(code)
  })
  apply(ctx)
  return { exited: exit.promise, codes }
}

interface RealSessionFixture {
  terminal: TerminalCliSession
  session: Session
  agent: Agent
  cancel: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  flush: ReturnType<typeof vi.fn>
}

function realSession(ctx: Context, options: {
  id?: string
  cwd?: string
  text?: string
  reason?: SessionEventMap['turn/end']['reason']
  noTurn?: boolean
  flush?: Array<Error | undefined>
  permissions?: { sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'; approval: 'ask' | 'never' }
} = {}): RealSessionFixture {
  const id = SessionId(options.id ?? 'runner-session')
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1,
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
  })
  if (options.permissions !== undefined) {
    session.append('sandbox/mode', { mode: options.permissions.sandbox })
    session.append('approval/policy', { policy: options.permissions.approval })
  }
  const failures = [...(options.flush ?? [])]
  const flush = vi.fn(async () => {
    const failure = failures.shift()
    if (failure !== undefined) throw failure
    return true
  })
  ctx.provide('sessions', { flush } as never)
  const cancel = vi.fn()
  const dispose = vi.fn(async () => {})
  const publish = (logged: SessionEvent): void => {
    ctx.emit('session/event', session, logged)
  }
  const agent = {
    id,
    options: {},
    session,
    status: 'idle',
    ctx,
    cancel,
    whenIdle: vi.fn(() => Promise.resolve()),
    followup: vi.fn((message: UserMessage) => {
      if (options.noTurn === true) return
      publish(session.append('turn/start', { turn: 1 }))
      publish(session.append('step/start', { turn: 1, step: 1 }))
      publish(session.append('user/message', message, { surfaceOp: 'append' }))
      publish(session.append('assistant/message', {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: options.text ?? 'done' }],
          source: { provider: 'test-provider', model: 'test-model' },
        }),
      }, { surfaceOp: 'append' }))
      publish(session.append('step/end', { turn: 1, step: 1 }))
      publish(session.append('turn/end', { turn: 1, reason: options.reason ?? { kind: 'completed' } }))
    }),
  } as unknown as Agent
  const handle: AgentHandle = { agent, dispose }
  const selection: ModelSelection = { provider: 'test-provider', model: 'test-model' }
  const terminal = new RealTerminalCliSession(ctx, handle, () => selection)
  return { terminal, session, agent, cancel, dispose, flush }
}

function bareSession(options: {
  status?: () => 'idle' | 'running'
  cwd?: string
  permissions?: boolean
  runTurn?: (prompt: string) => Promise<{ text: string; reason: SessionEventMap['turn/end']['reason'] | undefined }>
} = {}): {
  terminal: TerminalCliSession
  cancel: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  runTurn: ReturnType<typeof vi.fn>
} {
  const id = SessionId('bare-session')
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1,
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
  })
  if (options.permissions === true) {
    session.append('sandbox/mode', { mode: 'workspace-write' })
    session.append('approval/policy', { policy: 'ask' })
  }
  const cancel = vi.fn()
  const close = vi.fn(() => Promise.resolve())
  const runTurn = vi.fn(options.runTurn ?? (() => Promise.resolve({
    text: 'done', reason: { kind: 'completed' },
  })))
  const agent = {
    id,
    session,
    get status() { return options.status?.() ?? 'idle' },
  } as Agent
  const terminal = {
    agent,
    selection: () => ({ provider: 'test-provider', model: 'test-model' }),
    runTurn,
    cancel,
    close,
  } as unknown as TerminalCliSession
  return { terminal, cancel, close, runTurn }
}

beforeEach(() => {
  runnerState.openSession = undefined
  runnerState.resolvePrompt = undefined
  runnerState.lines = []
  runnerState.interactionInstalls = 0
  runnerState.interactionDisposals = 0
})

afterEach(() => {
  Object.assign(processIo, originalProcessIo)
  vi.restoreAllMocks()
})

describe('terminal CLI runner exec', () => {
  it('prints one human answer after a successful flushed and disposed turn', async () => {
    const ctx = baseContext()
    const streams = installIo()
    const fixture = realSession(ctx, { text: 'answer\u0000', cwd: '/repo' })
    runnerState.openSession = vi.fn(async () => fixture.terminal)

    const run = launch(ctx, { mode: 'exec', prompt: ['do', 'it'], json: false })

    await expect(run.exited).resolves.toBe(0)
    expect(streams.stdout.text()).toBe('answer\n')
    expect(streams.stderr.text()).toBe('')
    expect(runnerState.openSession).toHaveBeenCalledWith(ctx, 'exec', {
      mode: 'exec', prompt: ['do', 'it'], json: false, sandbox: 'read-only', approval: 'never',
    })
    expect(fixture.flush).toHaveBeenCalledTimes(2)
    expect(fixture.dispose).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('emits one completed JSON terminal record only after successful close', async () => {
    const ctx = baseContext()
    const streams = installIo()
    const fixture = realSession(ctx, { id: 'json-success', text: 'answer', cwd: '/repo' })
    runnerState.openSession = vi.fn(async () => fixture.terminal)

    const run = launch(ctx, { mode: 'exec', prompt: ['task'], json: true })

    await expect(run.exited).resolves.toBe(0)
    const records = eventJson(streams.stdout.text())
    expect(records.map(record => record.type)).toEqual([
      'thread.started', 'turn.started', 'item.completed', 'turn.completed',
    ])
    expect(records.filter(record => record.type === 'turn.completed')).toEqual([
      expect.objectContaining({ threadId: 'json-success', turn: 1 }),
    ])
    expect(streams.stderr.text()).toBe('')
    expect(fixture.dispose).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it.each(['run', 'close'] as const)(
    'emits one real-session JSON failure and disposes when the %s flush fails',
    async (phase) => {
      const ctx = baseContext()
      const streams = installIo()
      const failure = new Error(`${phase} flush failed`)
      const fixture = realSession(ctx, {
        id: `json-${phase}-failure`,
        flush: phase === 'run' ? [failure, failure] : [undefined, failure],
      })
      runnerState.openSession = vi.fn(async () => fixture.terminal)

      const run = launch(ctx, { mode: 'exec', prompt: ['task'], json: true })

      await expect(run.exited).resolves.toBe(1)
      const records = eventJson(streams.stdout.text())
      const terminal = records.filter(record => record.type === 'turn.failed')
      expect(terminal).toEqual([expect.objectContaining({
        threadId: `json-${phase}-failure`,
        turn: 1,
        reason: 'error',
        error: { code: 'CLI_ERROR', message: `${phase} flush failed` },
      })])
      expect(records.some(record => record.type === 'turn.failed' && record.threadId === '')).toBe(false)
      expect(streams.stderr.text()).toBe(`dsh: ${phase} flush failed\n`)
      expect(fixture.dispose).toHaveBeenCalledTimes(1)
      await ctx.fiber.dispose()
    },
  )

  it('reports a human flush failure after the real Session handle is disposed', async () => {
    const ctx = baseContext()
    const streams = installIo()
    const failure = new Error('human flush failed')
    const fixture = realSession(ctx, { flush: [failure, failure] })
    runnerState.openSession = vi.fn(async () => fixture.terminal)

    const run = launch(ctx, { mode: 'exec', prompt: ['task'], json: false })

    await expect(run.exited).resolves.toBe(1)
    expect(streams.stdout.text()).toBe('')
    expect(streams.stderr.text()).toBe('dsh: human flush failed\n')
    expect(fixture.dispose).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('normalizes non-Error prompt and in-session failures', async () => {
    const promptCtx = baseContext()
    const promptStreams = installIo()
    runnerState.resolvePrompt = async () => { throw 'prompt failed' }
    runnerState.openSession = vi.fn(async () => { throw new Error('must not open') })
    const promptRun = launch(promptCtx, { mode: 'exec', prompt: ['task'], json: false })
    await expect(promptRun.exited).resolves.toBe(1)
    expect(promptStreams.stderr.text()).toBe('dsh: prompt failed\n')
    expect(runnerState.openSession).not.toHaveBeenCalled()
    await promptCtx.fiber.dispose()

    runnerState.resolvePrompt = undefined
    const sessionCtx = baseContext()
    const sessionStreams = installIo()
    const fixture = bareSession({
      runTurn: async () => { throw 'turn failed' },
    })
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const sessionRun = launch(sessionCtx, { mode: 'exec', prompt: ['task'], json: true })
    await expect(sessionRun.exited).resolves.toBe(1)
    expect(eventJson(sessionStreams.stdout.text()).at(-1)).toMatchObject({
      type: 'turn.failed', threadId: 'bare-session',
      error: { code: 'CLI_ERROR', message: 'turn failed' },
    })
    expect(fixture.close).toHaveBeenCalledTimes(1)
    await sessionCtx.fiber.dispose()
  })

  it('reports no-turn and non-completed outcomes as JSON failures', async () => {
    const noTurnCtx = baseContext()
    const noTurnStreams = installIo()
    const noTurn = realSession(noTurnCtx, { id: 'no-turn', noTurn: true })
    runnerState.openSession = vi.fn(async () => noTurn.terminal)
    const first = launch(noTurnCtx, { mode: 'exec', prompt: ['task'], json: true })
    await expect(first.exited).resolves.toBe(1)
    expect(eventJson(noTurnStreams.stdout.text()).at(-1)).toMatchObject({
      type: 'turn.failed', threadId: 'no-turn', reason: 'no-turn', turn: 0,
    })
    await noTurnCtx.fiber.dispose()

    const abortedCtx = baseContext()
    const abortedStreams = installIo()
    const aborted = realSession(abortedCtx, {
      id: 'aborted-turn', reason: { kind: 'aborted', reason: { kind: 'user' } },
    })
    runnerState.openSession = vi.fn(async () => aborted.terminal)
    const second = launch(abortedCtx, { mode: 'exec', prompt: ['task'], json: true })
    await expect(second.exited).resolves.toBe(1)
    expect(eventJson(abortedStreams.stdout.text()).at(-1)).toMatchObject({
      type: 'turn.failed', threadId: 'aborted-turn', reason: 'aborted', turn: 1,
    })
    await abortedCtx.fiber.dispose()
  })

  it('maps invalid prompt input and pre-session JSON failures without opening a Session', async () => {
    const usageCtx = baseContext()
    const usageStreams = installIo({ stdinTTY: true })
    runnerState.openSession = vi.fn(async () => { throw new Error('must not open') })
    const usage = launch(usageCtx, { mode: 'exec', prompt: [], json: false })
    await expect(usage.exited).resolves.toBe(1)
    expect(usageStreams.stderr.text()).toContain('a prompt is required')
    expect(runnerState.openSession).not.toHaveBeenCalled()
    await usageCtx.fiber.dispose()

    const jsonCtx = baseContext()
    const jsonStreams = installIo()
    runnerState.openSession = vi.fn(async () => { throw 'factory failed' })
    const json = launch(jsonCtx, { mode: 'exec', prompt: ['task'], json: true })
    await expect(json.exited).resolves.toBe(1)
    expect(eventJson(jsonStreams.stdout.text())).toEqual([expect.objectContaining({
      type: 'turn.failed', threadId: '', error: { code: 'CLI_ERROR', message: 'factory failed' },
    })])
    expect(jsonStreams.stderr.text()).toBe('')
    await jsonCtx.fiber.dispose()
  })
})

describe('terminal CLI runner interactive', () => {
  it.each([
    { stdinTTY: false, stdoutTTY: true },
    { stdinTTY: true, stdoutTTY: false },
  ])('rejects non-TTY input/output before opening a Session', async ({ stdinTTY, stdoutTTY }) => {
    const ctx = baseContext()
    const streams = installIo({ stdinTTY, stdoutTTY })
    runnerState.openSession = vi.fn(async () => { throw new Error('must not open') })

    const run = launch(ctx, { mode: 'interactive', prompt: [] })

    await expect(run.exited).resolves.toBe(1)
    expect(streams.stderr.text()).toContain('interactive mode requires a TTY')
    expect(runnerState.openSession).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('renders help and command outcomes while keeping ordinary text in Agent turns', async () => {
    const executions: string[] = []
    const commands = {
      list: () => [
        { name: 'alpha', description: 'Alpha command' },
        { name: 'beta', description: 'Beta command', input: { hint: '<value>' } },
      ],
      async execute(_agent: Agent, line: string): Promise<CommandExecution | undefined> {
        executions.push(line)
        if (line === '/unknown value') return undefined
        if (line === '/ok') {
          return { commandId: CommandId('ok'), result: { kind: 'success', text: 'ok\u0000 text' } }
        }
        if (line === '/bad') {
          return { commandId: CommandId('bad'), result: { kind: 'error', text: 'bad text' } }
        }
        if (line === '/silent') {
          return { commandId: CommandId('silent'), result: { kind: 'success' } }
        }
        if (line === '/boom') throw new Error('command exploded\u001b[2J')
        if (line === '/string-boom') throw 'string command failure'
        throw new Error(`unexpected command ${line}`)
      },
    }
    const ctx = baseContext(commands)
    const streams = installIo()
    const fixture = realSession(ctx, {
      id: 'interactive-commands', cwd: '/repo', text: 'turn answer',
      permissions: { sandbox: 'workspace-write', approval: 'ask' },
    })
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const lines = lineScript(
      '', '/help details', '/unknown value', '/ok', '/bad', '/silent', '/boom', '/string-boom',
      'ordinary prompt', '/exit',
    )
    runnerState.lines.push(lines)

    const run = launch(ctx, { mode: 'interactive', prompt: ['   '] })

    await expect(run.exited).resolves.toBe(0)
    expect(streams.stdout.text()).toContain('DeepSeek Harness CLI\n')
    expect(streams.stdout.text()).toContain('cwd: /repo\n')
    expect(streams.stdout.text()).toContain('permissions: workspace-write, approval ask\n')
    expect(streams.stdout.text()).toContain('/alpha  Alpha command\n')
    expect(streams.stdout.text()).toContain('/beta <value>  Beta command\n')
    expect(streams.stdout.text()).toContain('ok text\n')
    expect(streams.stdout.text()).toContain('assistant> turn answer\n')
    expect(streams.stderr.text()).toContain('unknown command /unknown; use /help\n')
    expect(streams.stderr.text()).toContain('bad text\n')
    expect(streams.stderr.text()).toContain('command exploded[2J\n')
    expect(streams.stderr.text()).toContain('string command failure\n')
    expect(executions).toEqual(['/unknown value', '/ok', '/bad', '/silent', '/boom', '/string-boom'])
    expect(lines.prompts.every(entry => entry.prompt === '› ')).toBe(true)
    expect(runnerState.interactionInstalls).toBe(1)
    expect(runnerState.interactionDisposals).toBe(1)
    expect(fixture.dispose).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('runs an initial resume prompt and uses composition defaults when permission events are absent', async () => {
    const ctx = baseContext()
    const streams = installIo()
    const fixture = realSession(ctx, { id: 'resumed', text: 'continued' })
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const lines = lineScript(undefined)
    runnerState.lines.push(lines)

    const run = launch(ctx, { mode: 'resume', sessionId: 'resumed', prompt: ['continue', 'now'] })

    await expect(run.exited).resolves.toBe(0)
    expect(runnerState.openSession).toHaveBeenCalledWith(ctx, 'resume', {
      mode: 'resume', sessionId: 'resumed', prompt: ['continue', 'now'],
    })
    expect(streams.stdout.text()).toContain(`cwd: ${process.cwd()}\n`)
    expect(streams.stdout.text()).toContain('permissions: composition-default, approval composition-default\n')
    expect(streams.stdout.text()).toContain('assistant> continued\n')
    expect(fixture.flush).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('aborts an active command without cancelling the Agent', async () => {
    const commandStarted = Promise.withResolvers<AbortSignal>()
    const commands = {
      list: () => [],
      execute(_agent: Agent, _line: string, signal: AbortSignal): Promise<CommandExecution> {
        commandStarted.resolve(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('command aborted')) }, { once: true })
        })
      },
    }
    const ctx = baseContext(commands)
    installIo()
    const fixture = bareSession()
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const lines = lineScript('/hang', '/exit')
    runnerState.lines.push(lines)
    const run = launch(ctx, { mode: 'interactive', prompt: [] })

    await commandStarted.promise
    lines.interrupt?.()

    await expect(run.exited).resolves.toBe(0)
    expect(fixture.cancel).not.toHaveBeenCalled()
    expect(fixture.close).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('escalates a second terminal interrupt while the command abort is settling', async () => {
    const commandStarted = Promise.withResolvers<AbortSignal>()
    const commands = {
      list: () => [],
      execute(_agent: Agent, _line: string, signal: AbortSignal): Promise<CommandExecution> {
        commandStarted.resolve(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('command aborted')) }, { once: true })
        })
      },
    }
    const escalate = vi.fn()
    const ctx = baseContext(commands)
    ctx.provide('appInterrupt', {
      register: () => () => {},
      escalate,
    })
    installIo()
    const fixture = bareSession()
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const lines = lineScript('/hang', '/exit')
    runnerState.lines.push(lines)
    const run = launch(ctx, { mode: 'interactive', prompt: [] })
    await commandStarted.promise

    lines.interrupt?.()
    lines.interrupt?.()

    expect(escalate).toHaveBeenCalledWith(130)
    await expect(run.exited).resolves.toBe(0)
    expect(fixture.cancel).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('falls back to exit 130 on a command second interrupt without an interrupt service', async () => {
    const commandStarted = Promise.withResolvers<AbortSignal>()
    const commands = {
      list: () => [],
      execute(_agent: Agent, _line: string, signal: AbortSignal): Promise<CommandExecution> {
        commandStarted.resolve(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('command aborted')) }, { once: true })
        })
      },
    }
    const ctx = baseContext(commands)
    installIo()
    const fixture = bareSession()
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const lines = lineScript('/hang', '/exit')
    runnerState.lines.push(lines)
    const run = launch(ctx, { mode: 'interactive', prompt: [] })
    await commandStarted.promise

    lines.interrupt?.()
    lines.interrupt?.()

    await expect(run.exited).resolves.toBe(130)
    await vi.waitFor(() => { expect(run.codes).toContain(0) })
    expect(run.codes).toEqual([130, 0])
    await ctx.fiber.dispose()
  })

  it('delegates a launcher second interrupt while the command abort is settling', async () => {
    const commandStarted = Promise.withResolvers<AbortSignal>()
    const commands = {
      list: () => [],
      execute(_agent: Agent, _line: string, signal: AbortSignal): Promise<CommandExecution> {
        commandStarted.resolve(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('command aborted')) }, { once: true })
        })
      },
    }
    let handler: (() => boolean) | undefined
    const ctx = baseContext(commands)
    ctx.provide('appInterrupt', {
      register(next: () => boolean) {
        handler = next
        return () => { handler = undefined }
      },
      escalate: vi.fn(),
    })
    installIo()
    const fixture = bareSession()
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    runnerState.lines.push(lineScript('/hang', '/exit'))
    const run = launch(ctx, { mode: 'interactive', prompt: [] })
    await commandStarted.promise

    expect(handler?.()).toBe(true)
    expect(handler?.()).toBe(false)

    await expect(run.exited).resolves.toBe(0)
    await ctx.fiber.dispose()
  })

  it('cancels on the first terminal interrupt and escalates the second', async () => {
    let status: 'idle' | 'running' = 'running'
    const disposeInterrupt = vi.fn()
    const escalate = vi.fn()
    const appInterrupt: AppInterrupt = {
      register(next) {
        void next
        return disposeInterrupt
      },
      escalate,
    }
    const ctx = baseContext()
    ctx.provide('appInterrupt', appInterrupt)
    installIo()
    const fixture = bareSession({ status: () => status })
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const pending = Promise.withResolvers<string | undefined>()
    const lines = lineScript(pending.promise)
    runnerState.lines.push(lines)
    const run = launch(ctx, { mode: 'interactive', prompt: [] })
    await vi.waitFor(() => { expect(lines.interrupt).toBeDefined() })

    lines.interrupt?.()
    status = 'idle'
    lines.interrupt?.()
    expect(fixture.cancel).toHaveBeenCalledTimes(1)
    expect(escalate).toHaveBeenCalledWith(130)

    pending.resolve(undefined)
    await expect(run.exited).resolves.toBe(0)
    expect(disposeInterrupt).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('escalates a repeated interrupt while an idle turn is still settling', async () => {
    const escalate = vi.fn()
    const ctx = baseContext()
    ctx.provide('appInterrupt', {
      register: () => () => {},
      escalate,
    })
    installIo()
    const settled = Promise.withResolvers<{
      text: string
      reason: SessionEventMap['turn/end']['reason'] | undefined
    }>()
    const fixture = bareSession({ status: () => 'idle', runTurn: () => settled.promise })
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const lines = lineScript()
    runnerState.lines.push(lines)
    const run = launch(ctx, { mode: 'interactive', prompt: ['task'] })
    await vi.waitFor(() => { expect(fixture.runTurn).toHaveBeenCalledWith('task') })

    lines.interrupt?.()
    lines.interrupt?.()

    expect(escalate).toHaveBeenCalledWith(130)
    settled.resolve({ text: 'done', reason: { kind: 'completed' } })
    await expect(run.exited).resolves.toBe(0)
    await ctx.fiber.dispose()
  })

  it('delegates a launcher-delivered second interrupt to launcher shutdown', async () => {
    let handler: (() => boolean) | undefined
    const appInterrupt: AppInterrupt = {
      register(next) {
        handler = next
        return () => { handler = undefined }
      },
      escalate: vi.fn(),
    }
    const ctx = baseContext()
    ctx.provide('appInterrupt', appInterrupt)
    installIo()
    const fixture = bareSession({ status: () => 'running' })
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const pending = Promise.withResolvers<string | undefined>()
    const lines = lineScript(pending.promise)
    runnerState.lines.push(lines)
    const run = launch(ctx, { mode: 'interactive', prompt: [] })
    await vi.waitFor(() => { expect(handler).toBeDefined() })

    expect(handler?.()).toBe(true)
    expect(handler?.()).toBe(false)
    expect(fixture.cancel).toHaveBeenCalledTimes(1)

    pending.resolve(undefined)
    await expect(run.exited).resolves.toBe(0)
    await ctx.fiber.dispose()
  })

  it('falls back to exit 130 on a second terminal interrupt without an interrupt service', async () => {
    const ctx = baseContext()
    installIo()
    const fixture = bareSession({ status: () => 'running' })
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const pending = Promise.withResolvers<string | undefined>()
    const lines = lineScript(pending.promise)
    runnerState.lines.push(lines)
    const run = launch(ctx, { mode: 'interactive', prompt: [] })
    await vi.waitFor(() => { expect(lines.interrupt).toBeDefined() })

    lines.interrupt?.()
    lines.interrupt?.()

    await expect(run.exited).resolves.toBe(130)
    pending.resolve(undefined)
    await vi.waitFor(() => { expect(run.codes).toContain(0) })
    expect(run.codes).toEqual([130, 0])
    await ctx.fiber.dispose()
  })

  it('closes pending input when interrupted while idle', async () => {
    const ctx = baseContext()
    installIo()
    const fixture = bareSession({ status: () => 'idle' })
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const pending = Promise.withResolvers<string | undefined>()
    const lines = lineScript(pending.promise)
    lines.onClose = () => { pending.resolve(undefined) }
    runnerState.lines.push(lines)
    const run = launch(ctx, { mode: 'interactive', prompt: [] })
    await vi.waitFor(() => { expect(lines.interrupt).toBeDefined() })

    lines.interrupt?.()

    await expect(run.exited).resolves.toBe(0)
    expect(lines.closeCount).toBeGreaterThanOrEqual(2)
    expect(fixture.cancel).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

describe('terminal CLI runner lifecycle', () => {
  it('waits for Loader settlement before choosing a mode', async () => {
    const ctx = baseContext()
    installIo()
    const fixture = realSession(ctx)
    runnerState.openSession = vi.fn(async () => fixture.terminal)
    const settlement = Promise.withResolvers<undefined>()
    ctx.provide('loader', { await: () => settlement.promise } as never)

    const run = launch(ctx, { mode: 'exec', prompt: ['task'], json: false })
    await Promise.resolve()
    expect(runnerState.openSession).not.toHaveBeenCalled()
    settlement.resolve(undefined)

    await expect(run.exited).resolves.toBe(0)
    await ctx.fiber.dispose()
  })

  it('fails loud when the launcher did not provide an exit request', () => {
    const ctx = baseContext()
    ctx.provide('terminalCliStartup', { value: { mode: 'exec', prompt: ['task'], json: false } })
    expect(() => { apply(ctx) }).toThrow('must provide ctx.appExit')
  })
})
