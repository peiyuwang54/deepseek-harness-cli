/** Direct one-shot Agent driving, durable aggregation, flushing, and exit mapping. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader, UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, Config, internals } from '../src/index.ts'
import type { HeadlessStartupValues } from '../src/startup.ts'

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

interface Script {
  before?(session: Session): void
  afterPrompt(session: Session, message: UserMessage, agent: Agent): Promise<void> | void
}

const DEFAULT_STARTUP: HeadlessStartupValues = {
  task: 'do the thing',
  json: false,
  ephemeral: false,
  images: [],
  permissionMode: 'default',
}

interface BenchOptions {
  startup?: HeadlessStartupValues
  headers?: SessionHeader[]
  permissionPresets?: {
    fullAccessPreset?: string
    fullAutoPreset?: string
    set(session: Session, preset: string): void
  }
  saveImages?: (inputs: readonly SaveImageAttachment[]) => Promise<readonly ImageAttachmentRef[]>
}

/** Provide runner seams that are not under test in the scripted bench. */
function provideRunnerServices(ctx: Context, options: BenchOptions = {}): void {
  ctx.provide('headlessStartup', options.startup ?? DEFAULT_STARTUP)
  ctx.provide('agentPresets', {
    resolve: () => Promise.resolve({ id: 'standard' }),
    mount: () => Promise.resolve({ id: 'standard' }),
  } as never)
  ctx.provide('permissionPresets', options.permissionPresets ?? {} as never)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve(options.headers ?? []) } as never)
  ctx.provide('attachments', {
    saveImages: options.saveImages ?? (() => Promise.resolve([])),
  } as never)
}

function appendTurn(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string | undefined,
  completed: boolean,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== undefined) {
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', {
    turn,
    reason: completed
      ? { kind: 'completed' }
      : { kind: 'aborted', reason: { kind: 'user' } },
  })
}

/** Mount the real registries around a small scripted Agent factory. */
async function bench(script: Script, options: BenchOptions = {}): Promise<{
  ctx: Context
  calls: { create: CreateAgentOptions[]; resume: ResumeAgentOptions[] }
  run(): Promise<{ code: number; out: string; err: string; order: string[] }>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  provideRunnerServices(ctx, options)
  const calls: { create: CreateAgentOptions[]; resume: ResumeAgentOptions[] } = { create: [], resume: [] }

  async function createScriptedAgent(
    ownerCtx: Context,
    session: Session,
    setup: CreateAgentOptions['setup'],
  ): Promise<AgentHandle> {
    let idle = Promise.resolve()
    const agent = {} as Agent
    const agentCtx = ownerCtx.extend({ agent })
    Object.assign(agent, {
      id: session.id,
      options: {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx: agentCtx,
      cancel: () => {},
      runMaintenance: () => Promise.reject(new Error('not used')),
      send: () => {},
      followup: (message: UserMessage) => {
        agent.inbox.append('next-turn', message)
        idle = Promise.resolve().then(() => script.afterPrompt(session, message, agent))
      },
      steer: () => {},
      inject: () => {},
      whenIdle: () => idle,
    } satisfies Partial<Agent>)
    await setup?.(agentCtx)
    script.before?.(session)
    ctx.agents.register(agent)
    return { agent, dispose: () => Promise.resolve() }
  }

  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      calls.create.push(options)
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      return createScriptedAgent(ownerCtx, session, options.setup)
    },
    async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
      calls.resume.push(options)
      const session = ctx.sessions.create(options.resumeSessionId, {
        meta: { cwd: process.cwd(), agentPreset: 'standard' },
      })
      return createScriptedAgent(ownerCtx, session, options.setup)
    },
  })
  return {
    ctx,
    calls,
    run: async () => {
      let out = ''
      let err = ''
      const order: string[] = []
      ctx.on('session/flush', () => { order.push('flush') })
      internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      const exited = new Promise<number>((resolve) => {
        ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
      })
      apply(ctx)
      return { code: await exited, out, err, order }
    },
  }
}

describe('headless runner', () => {
  it('aggregates the final text across the complete idle-to-idle interval and flushes before exit', async () => {
    const test = await bench({
      before(session) {
        const setupMessage = {
          role: 'user', content: [{ type: 'text', text: 'setup' }], source: { kind: 'user' }, id: 'setup',
        } as UserMessage
        appendTurn(session, 0, setupMessage, 'pre-task noise', true)
      },
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, '', true)
        appendTurn(session, 2, message, 'final answer', true)
      },
    })
    const result = await test.run()
    expect(result).toEqual({
      code: 0,
      out: 'final answer\n',
      err: '',
      order: ['flush', 'exit'],
    })
    await test.ctx.fiber.dispose()
  })

  it('waits for asynchronously appended events instead of racing Agent idleness', async () => {
    const test = await bench({
      afterPrompt: async (session, message) => {
        await new Promise(resolve => setTimeout(resolve, 5))
        appendTurn(session, 1, message, 'race-free answer', true)
      },
    })
    expect(await test.run()).toMatchObject({ code: 0, out: 'race-free answer\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the final turn does not complete', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, undefined, false) },
    })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('prints the durable model failure when the final turn ends in error', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'provider unavailable' } },
        })
      },
    })
    expect(await test.run()).toMatchObject({
      code: 1,
      out: '\n',
      err: 'deepseek exec: SERVER: provider unavailable\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the owned interval contains no turn', async () => {
    const test = await bench({ afterPrompt: () => {} })
    expect(await test.run()).toMatchObject({ code: 1, out: '\n', err: '' })
    await test.ctx.fiber.dispose()
  })

  it('emits a machine-readable lifecycle with accumulated token usage', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: 'json answer' }],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
          usage: { inputTokens: 8, outputTokens: 3, cacheReadTokens: 5 },
        }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    }, { startup: { ...DEFAULT_STARTUP, json: true } })

    const result = await test.run()
    expect(result.code).toBe(0)
    expect(result.err).toBe('')
    const records = result.out.trim().split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)
    expect(records).toHaveLength(4)
    expect(records[0]).toMatchObject({ type: 'thread.started' })
    expect(typeof records[0]?.thread_id).toBe('string')
    expect(records[0]?.thread_id).toMatch(/^session-/)
    expect(records[1]).toEqual({ type: 'turn.started' })
    expect(records[2]).toMatchObject({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'json answer' },
    })
    const messageItem = records[2]?.item
    expect(messageItem).toBeTypeOf('object')
    expect((messageItem as Record<string, unknown>).id).toMatch(/^message_\d+$/)
    expect(records[3]).toEqual({
      type: 'turn.completed',
      usage: {
        input_tokens: 8,
        cached_input_tokens: 5,
        cache_write_input_tokens: 0,
        output_tokens: 3,
        reasoning_output_tokens: 0,
      },
    })
    await test.ctx.fiber.dispose()
  })

  it('marks fresh ephemeral sessions without changing the ordinary preset', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'temporary', true) },
    }, { startup: { ...DEFAULT_STARTUP, ephemeral: true } })
    expect(await test.run()).toMatchObject({ code: 0 })
    expect(test.calls.create).toHaveLength(1)
    expect(test.calls.create[0]?.meta).toMatchObject({ ephemeral: true, agentPreset: 'standard' })
    await test.ctx.fiber.dispose()
  })

  it.each([
    ['full-auto', 'full-auto'],
    ['yolo', 'danger-full-access'],
  ] as const)('pins the %s permission shortcut before Agent publication', async (permissionMode, preset) => {
    const applied: Array<{ session: Session; preset: string }> = []
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'permitted', true) },
    }, {
      startup: { ...DEFAULT_STARTUP, permissionMode },
      permissionPresets: {
        fullAccessPreset: 'danger-full-access',
        fullAutoPreset: 'full-auto',
        set: (session, selected) => void applied.push({ session, preset: selected }),
      },
    })
    expect(await test.run()).toMatchObject({ code: 0 })
    expect(applied).toHaveLength(1)
    expect(applied[0]?.preset).toBe(preset)
    expect(applied[0]?.session.id).toBe(test.calls.create[0]?.sessionId)
    await test.ctx.fiber.dispose()
  })

  it('resumes an explicit session instead of creating a replacement', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'continued', true) },
    }, {
      startup: {
        ...DEFAULT_STARTUP,
        resume: { sessionId: 'persisted-1', last: false, all: false },
      },
    })
    expect(await test.run()).toMatchObject({ code: 0, out: 'continued\n' })
    expect(test.calls.create).toEqual([])
    expect(test.calls.resume[0]?.resumeSessionId).toBe(SessionId('persisted-1'))
    await test.ctx.fiber.dispose()
  })

  it('selects the newest persisted session in the current workspace by default', async () => {
    const cwd = process.cwd()
    const headers: SessionHeader[] = [
      { version: 0, id: SessionId('older-local'), createdAt: 10, cwd },
      { version: 0, id: SessionId('newer-foreign'), createdAt: 30, cwd: '/elsewhere' },
      { version: 0, id: SessionId('newer-local'), createdAt: 20, cwd },
    ]
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'latest', true) },
    }, {
      startup: { ...DEFAULT_STARTUP, resume: { last: true, all: false } },
      headers,
    })
    expect(await test.run()).toMatchObject({ code: 0 })
    expect(test.calls.resume[0]?.resumeSessionId).toBe(SessionId('newer-local'))
    await test.ctx.fiber.dispose()
  })

  it('admits ordered image files and writes the last result to the requested path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-exec-images-'))
    const imagePath = join(dir, 'screen.png')
    const outputPath = join(dir, 'last.txt')
    await writeFile(imagePath, new Uint8Array([1, 2, 3]))
    let saved: readonly SaveImageAttachment[] = []
    let submitted: UserMessage | undefined
    const test = await bench({
      afterPrompt(session, message) {
        submitted = message
        appendTurn(session, 1, message, 'fixed', true)
      },
    }, {
      startup: {
        ...DEFAULT_STARTUP,
        images: [imagePath],
        outputLastMessage: outputPath,
      },
      saveImages: (inputs) => {
        saved = inputs
        return Promise.resolve([{
          attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
          mediaType: 'image/png',
          bytes: 3,
          width: 1,
          height: 1,
          name: 'screen.png',
        }])
      },
    })
    try {
      expect(await test.run()).toMatchObject({ code: 0, out: 'fixed\n', err: '' })
      expect(saved).toHaveLength(1)
      expect(Array.from(saved[0]?.data ?? [])).toEqual([1, 2, 3])
      expect(saved[0]).toMatchObject({ mediaType: 'image/png', name: 'screen.png' })
      expect(submitted?.content).toEqual([
        { type: 'text', text: 'do the thing' },
        {
          type: 'image',
          attachment: {
            attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
            mediaType: 'image/png',
            bytes: 3,
            width: 1,
            height: 1,
            name: 'screen.png',
          },
        },
      ])
      expect(await readFile(outputPath, 'utf8')).toBe('fixed')
    } finally {
      await test.ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses schema-valid structured output as the final result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-exec-schema-'))
    const schemaPath = join(dir, 'result.schema.json')
    await writeFile(schemaPath, JSON.stringify({
      type: 'object',
      properties: { score: { type: 'number' } },
      required: ['score'],
      additionalProperties: false,
    }))
    const test = await bench({
      async afterPrompt(session, message, agent) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        await agent.ctx.tools.execute({
          callId: CallId('structured-1'),
          name: 'structured_output',
          arguments: { score: 9 },
          agent,
          signal: new AbortController().signal,
        })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      },
    }, { startup: { ...DEFAULT_STARTUP, outputSchema: schemaPath } })
    try {
      expect(await test.run()).toMatchObject({ code: 0, out: '{"score":9}\n', err: '' })
    } finally {
      await test.ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a direct Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')) } as never)
    provideRunnerServices(ctx)
    apply(ctx)
    expect(await exited).toBe(1)
    expect(err).toBe('deepseek exec: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('stringifies a non-Error Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    const rejected = {
      then(_resolve: (value: never) => void, reject: (reason: unknown) => void): void {
        reject('factory exploded')
      },
    }
    ctx.provide('agents', { create: () => rejected } as never)
    provideRunnerServices(ctx)
    apply(ctx)
    expect(await exited).toBe(1)
    expect(err).toBe('deepseek exec: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('abandons a run when the tree is disposed during Loader settlement', async () => {
    const ctx = new Context()
    let exited = false
    internals.stdout = { write: () => true }
    internals.stderr = { write: () => true }
    ctx.provide('appExit', () => { exited = true })
    provideRunnerServices(ctx)
    const services = ctx.plugin((child: Context) => {
      child.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
      child.provide('sessions', {} as never)
      child.provide('agents', {} as never)
    })
    await services
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('loader', { await: () => settlement } as never)
    apply(ctx)
    await services.dispose()
    release!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    provideRunnerServices(ctx)
    expect(() => { apply(ctx) }).toThrow('must provide ctx.appExit')
  })

  it('keeps runner deployment config empty', () => {
    expect(new Config({})).toEqual({})
  })
})
