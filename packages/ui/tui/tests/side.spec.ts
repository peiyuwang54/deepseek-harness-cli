import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-plan-mode'
import {
  SIDE_CONVERSATION_BOUNDARY,
  SIDE_CONVERSATION_INSTRUCTIONS,
  completedTurnPrefix,
  createSideConversation,
  discardSideConversation,
  hasStartedConversation,
} from '../src/chat/side.ts'

/** Minimal Agent view for the pure fork-prefix helpers. */
function parentWith(session: Session): Agent {
  return { session } as Agent
}

describe('side conversation fork inputs', () => {
  it('inherits only the latest balanced completed-turn prefix', () => {
    const session = Session.create(SessionId('parent'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'completed request' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'still running' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const seed = completedTurnPrefix(parentWith(session))
    expect(seed).toHaveLength(3)
    expect(seed.at(-1)?.type).toBe('turn/end')
    expect(JSON.stringify(seed)).not.toContain('still running')
    expect(hasStartedConversation(seed)).toBe(true)
  })

  it('requires a completed direct user conversation', () => {
    const session = Session.create(SessionId('context-only'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'injected context' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(hasStartedConversation(completedTurnPrefix(parentWith(session)))).toBe(false)
  })

  it('defines explicit inherited-instruction and mutation limits', () => {
    expect(SIDE_CONVERSATION_INSTRUCTIONS).toContain('Only user messages submitted after that boundary')
    expect(SIDE_CONVERSATION_INSTRUCTIONS).toContain('Do not use subagents or workflows')
    expect(SIDE_CONVERSATION_INSTRUCTIONS).toContain('unless the user explicitly requests that mutation')
    expect(SIDE_CONVERSATION_BOUNDARY).toContain('Treat all earlier messages as reference context only')
  })

  it('creates an ephemeral child on the parent route and logs the boundary through injection', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const parentSession = Session.create(SessionId('parent'))
    parentSession.append('turn/start', { turn: 1 })
    parentSession.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'parent request' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    parentSession.append('plan/mode', { active: true })
    parentSession.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const parent = {
      id: parentSession.id,
      options: { provider: 'deepseek', model: 'deepseek-v4-pro', maxTokens: 4096 },
      session: parentSession,
      ctx,
    } as Agent
    const injected = vi.fn()
    const dispose = vi.fn(() => Promise.resolve())
    const create = vi.spyOn(ctx.agents, 'create').mockImplementation((options) => {
      const childSession = Session.create(options.sessionId, options.seed, {
        version: 0,
        id: options.sessionId,
        createdAt: 1,
        ...options.meta,
      })
      const child = {
        id: options.sessionId,
        options: options.agentOptions ?? {},
        session: childSession,
        ctx,
        inbox: new Inbox(childSession, { inserted() {}, discarded() {}, claimed() {} }),
        status: 'idle',
        inject: injected,
      } as unknown as Agent
      return Promise.resolve({ agent: child, dispose })
    })

    const side = await createSideConversation(parent, new AbortController().signal)
    const options = create.mock.calls[0]?.[0]
    expect(options?.meta).toMatchObject({ parentSession: parent.id, ephemeral: true, seedLength: 4 })
    expect(options?.agentOptions).toEqual(parent.options)
    expect(options?.seed).toEqual(parentSession.events)
    expect(typeof options?.setup).toBe('function')
    expect(side.parentSessionId).toBe(parent.id)
    expect(side.transcriptStartSeq).toBe(side.handle.agent.session.events.length)
    expect(injected).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: 'plugin', plugin: 'ui-tui-side', form: 'instructions' },
    }))

    const childCtx = new Context()
    await childCtx.plugin(SystemPrompt)
    await childCtx.plugin(ToolRegistry)
    Object.defineProperty(childCtx, 'agent', { configurable: true, value: side.handle.agent })
    await options?.setup?.(childCtx)
    expect(side.handle.agent.session.events.at(-1)).toMatchObject({
      type: 'plan/mode', data: { active: false },
    })
    for (const name of ['subagent', 'subagent_custom', 'workflow', 'workflow_custom', 'ralph', 'safe']) {
      childCtx.tools.register({
        name,
        description: name,
        parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
        execute: () => Promise.resolve(name),
      })
    }
    const execute = async (name: string): Promise<string | undefined> => {
      const result = await childCtx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId(`side-${name}`),
        name,
        arguments: {},
      })
      const first = result.content[0]
      return first?.type === 'text' ? first.text : undefined
    }
    for (const name of ['subagent', 'subagent_custom', 'workflow', 'workflow_custom', 'ralph']) {
      expect(await execute(name)).toContain('is unavailable in a side conversation')
    }
    expect(await execute('safe')).toBe('safe')

    await discardSideConversation(side)
    expect(dispose).toHaveBeenCalledOnce()
    await childCtx.fiber.dispose()
    await ctx.fiber.dispose()
  })
})
