/** Stable JSONL projection for non-interactive execution. */

import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { ExecJsonlEmitter } from '../src/exec-events.ts'

function event<T extends SessionEventType>(
  type: T,
  data: SessionEventMap[T],
  seq: number,
): SessionEvent<T> {
  return { type, data, seq, time: 1 } as SessionEvent<T>
}

function capture(): { emitter: ExecJsonlEmitter; lines: Readonly<Record<string, unknown>>[] } {
  const lines: Readonly<Record<string, unknown>>[] = []
  return { emitter: new ExecJsonlEmitter(value => void lines.push(value)), lines }
}

describe('exec JSONL events', () => {
  it('projects the thread, model, tool, todo, usage, and completed-turn lifecycle', () => {
    const { emitter, lines } = capture()
    emitter.threadStarted('session-1')
    emitter.event(event('turn/start', { turn: 1 }, 0))
    emitter.event(event('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'checking' },
          { type: 'text', text: 'done' },
        ],
        source: { provider: 'test', model: 'test' },
      }),
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        reasoningTokens: 5,
      },
    }, 1))
    emitter.event(event('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('call-1'),
      name: 'bash',
      arguments: '{"command":"pwd"}',
    }, 2))
    emitter.event(event('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-1'),
        content: [{ type: 'text', text: '/workspace' }],
        isError: false,
      }),
    }, 3))
    emitter.event(event('todo/write', {
      todos: [{ content: 'inspect', status: 'completed' }],
    }, 4))
    emitter.event(event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    emitter.finish()

    expect(lines).toEqual([
      { type: 'thread.started', thread_id: 'session-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'reasoning_1', type: 'reasoning', text: 'checking' } },
      { type: 'item.completed', item: { id: 'message_1', type: 'agent_message', text: 'done' } },
      {
        type: 'item.started',
        item: {
          id: 'call-1',
          type: 'tool_call',
          name: 'bash',
          arguments: '{"command":"pwd"}',
          status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'call-1',
          type: 'tool_call',
          status: 'completed',
          content: [{ type: 'text', text: '/workspace' }],
        },
      },
      {
        type: 'item.updated',
        item: { id: 'todo', type: 'todo_list', items: [{ content: 'inspect', status: 'completed' }] },
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 11,
          cached_input_tokens: 3,
          cache_write_input_tokens: 2,
          output_tokens: 7,
          reasoning_output_tokens: 5,
        },
      },
    ])
  })

  it('emits stable runner errors, structured results, and failed turns', () => {
    const { emitter, lines } = capture()
    emitter.structuredResult({ score: 1 })
    emitter.event(event('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'SERVER', message: 'unavailable' } },
    }, 0))
    emitter.finish()
    emitter.error('runner failed')

    expect(lines).toEqual([
      {
        type: 'item.completed',
        item: { id: 'structured_output', type: 'agent_message', text: '{"score":1}' },
      },
      { type: 'turn.failed', error: { message: 'SERVER: unavailable' } },
      { type: 'error', message: 'runner failed' },
    ])
  })

  it('ignores events without a public exec representation', () => {
    const { emitter, lines } = capture()
    emitter.event(event('step/start', { turn: 1, step: 1 }, 0))
    emitter.event(event('step/end', { turn: 1, step: 1 }, 1))
    expect(lines).toEqual([])
  })

  it('lets a command-level validation failure replace a completed turn', () => {
    const { emitter, lines } = capture()
    emitter.event(event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 0))
    emitter.finish('structured output missing')
    expect(lines).toEqual([
      { type: 'turn.failed', error: { message: 'structured output missing' } },
    ])
  })

  it('closes an earlier turn before a later turn starts', () => {
    const { emitter, lines } = capture()
    emitter.event(event('turn/start', { turn: 1 }, 0))
    emitter.event(event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 1))
    emitter.event(event('turn/start', { turn: 2 }, 2))
    emitter.event(event('turn/end', {
      turn: 2,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    }, 3))
    emitter.finish()
    expect(lines).toEqual([
      { type: 'turn.started' },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      },
      { type: 'turn.started' },
      { type: 'turn.failed', error: { message: 'turn aborted (user)' } },
    ])
  })
})
