import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmService, { createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk , createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandService from '@deepseek-ai/dsh-commands'
import UserInteractionService from '@deepseek-ai/dsh-user-questions'
import SessionReferenceResolver, { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { createTuiChat, TuiPromptService } from '../src/index.ts'
import { HeadlessTerminal } from './headless-terminal.ts'
import { TestSessionQueryService } from './session-query.ts'

const EXPECTED = join(dirname(fileURLToPath(import.meta.url)), 'snapshots/session-reference.expected.txt')
const REFRESHING = process.env.DSH_SNAPSHOT === 'refresh'

class SnapshotAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    // The snapshot is injected into next-step before the waking user prompt
    // enters next-turn, so the loop claims and logs the context first.
    const [context, prompt] = options.messages.slice(-2)
    if (context?.role !== 'user' || prompt?.role !== 'user'
      || prompt.content[0]?.type !== 'text' || prompt.content[0].text !== 'Use @Source session') {
      throw new Error('session reference context did not follow the direct user message')
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Combined reference request accepted.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Combined reference request accepted.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function nextIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

describe('TUI session-reference snapshot', () => {
  it('snapshots compacted current-surface context on send and displays only its reference card', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 6, 21, 12, 30, 0).getTime())
    const ctx = new Context()
    await ctx.plugin(LlmService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandService)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(TuiPromptService)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TestSessionQueryService)
    await ctx.plugin(SessionReferenceResolver)

    const adapter = new SnapshotAdapter()
    ctx.llm.registerAdapter(['mock'], adapter)
    const source = ctx.sessions.create(SessionId('source-session'), { meta: { cwd: '/workspace/project', createdAt: 1 } })
    const oldUser = source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'SHADOWED OLD USER' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const oldAssistant = source.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'SHADOWED OLD ASSISTANT' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, { surfaceOp: 'append' })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<compacted-summary>Retained checkpoint.</compacted-summary>' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', start: oldUser.seq, end: oldAssistant.seq },
      sourceEventSeqs: [oldUser.seq, oldAssistant.seq],
    })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Recent retained question.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const target = ctx.agentLoop.create(
      SessionId('target-session'),
      { provider: 'mock', model: 'mock' },
      { cwd: '/workspace/project' },
    )
    const terminal = new HeadlessTerminal(96, 24)
    const controller = createTuiChat(ctx, {
      sessionId: target.id,
      theme: { color: true },
      title: 'DSH session reference',
    }, { terminal, exit: () => {} })
    await terminal.waitForFrame(0)

    const mention = formatSessionReferenceMention({ sessionId: source.id, label: 'Source session' })
    const idle = nextIdle(ctx, target)
    const frame = terminal.frames
    terminal.send(`Use ${mention}`)
    terminal.send('\r')
    await idle
    await terminal.waitForFrame(frame)

    const request = JSON.stringify(adapter.requests[0]?.messages)
    expect(request).toContain('untrusted, read-only snapshot')
    expect(request).toContain('Retained checkpoint.')
    expect(request).toContain('Recent retained question.')
    expect(request).not.toContain('SHADOWED OLD USER')
    expect(request).not.toContain('SHADOWED OLD ASSISTANT')
    const context = target.session.events.find(event =>
      event.type === 'user/message' && event.data.source.kind === 'session-reference')
    expect(context?.type === 'user/message' && context.data.source).toMatchObject({
      kind: 'session-reference',
      references: [{ sessionId: 'source-session', compacted: true }],
    })
    const user = target.session.events.find(event =>
      event.type === 'user/message' && event.data.source.kind === 'user')
    expect(user?.type === 'user/message' && user.data.content).toEqual([
      { type: 'text', text: 'Use @Source session' },
    ])

    const snapshot = await terminal.snapshot({ includeScrollback: true })
    if (REFRESHING) {
      await mkdir(dirname(EXPECTED), { recursive: true })
      await writeFile(EXPECTED, snapshot)
    }
    await expect(snapshot).toMatchFileSnapshot(EXPECTED)

    await controller.dispose()
    await ctx.fiber.dispose()
    await terminal.dispose()
    clock.mockRestore()
  })
})
