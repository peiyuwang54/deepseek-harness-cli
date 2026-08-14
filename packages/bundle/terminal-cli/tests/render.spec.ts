import { Readable, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  type ContentBlock,
} from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionEvent,
  type SessionEventType,
} from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CliOutput, TerminalCliIo } from '../src/io.ts'
import { TerminalSessionRenderer, type TerminalCliJsonEvent } from '../src/render.ts'

interface CapturedOutput {
  stream: CliOutput
  text(): string
}

function output(): CapturedOutput {
  let written = ''
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      written += String(chunk)
      callback()
    },
  }) as CliOutput
  return { stream, text: () => written }
}

function io(): { value: TerminalCliIo; stdout: CapturedOutput; stderr: CapturedOutput } {
  const stdout = output()
  const stderr = output()
  return {
    value: {
      stdin: Readable.from([]),
      stdout: stdout.stream,
      stderr: stderr.stream,
      exit: vi.fn(),
    },
    stdout,
    stderr,
  }
}

function agent(id: string, cwd?: string): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, [], {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 1,
    ...cwd === undefined ? {} : { cwd },
  })
  return { id: sessionId, session } as Agent
}

function event<T extends SessionEventType>(type: T, data: SessionEvent<T>['data'], seq: number): SessionEvent<T> {
  return { type, data, seq, time: 1 } as SessionEvent<T>
}

function assistant(turn: number, step: number, text: string, seq: number): SessionEvent<'assistant/message'> {
  return event('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'test-provider', model: 'test-model' },
    }),
  }, seq)
}

function toolResult(
  turn: number,
  step: number,
  id: string,
  content: ContentBlock[],
  seq: number,
  options: {
    isError?: boolean
    error?: { name: string; code: string }
    meta?: SessionEvent<'tool/result'>['data']['meta']
  } = {},
): SessionEvent<'tool/result'> {
  return event('tool/result', {
    turn,
    step,
    message: createToolResultMessage({
      callId: CallId(id),
      content,
      isError: options.isError === true,
    }),
    ...options.error === undefined ? {} : { error: options.error },
    ...options.meta === undefined ? {} : { meta: options.meta },
  }, seq)
}

function tool(name: string, presenters: Pick<ToolDefinition, 'presentCall' | 'presentResult'>): ToolDefinition {
  return { name, ...presenters } as ToolDefinition
}

function harness(definitions: ToolDefinition[] = []): {
  ctx: Context
  definitions: Map<string, ToolDefinition>
} {
  const ctx = new Context()
  const entries = new Map(definitions.map(definition => [definition.name, definition]))
  ctx.provide('tools', {
    get(name: string) {
      if (name === 'registry-boom') throw new Error('registry\u001b[31m exploded')
      if (name === 'registry-string') throw 'registry string failure'
      return entries.get(name)
    },
  } as never)
  return { ctx, definitions: entries }
}

function emit(ctx: Context, target: Agent, entry: SessionEvent): void {
  ctx.emit('session/event', target.session, entry)
}

function jsonLines(text: string): TerminalCliJsonEvent[] {
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as TerminalCliJsonEvent)
}

describe('TerminalSessionRenderer', () => {
  it('streams interactive text once, renders tool progress, and reports non-completed turns', () => {
    const presented: unknown[] = []
    const { ctx } = harness([
      tool('shell', {
        presentCall(args) {
          presented.push(args)
          return { card: 'terminal', title: 'Run\u001b[31m' }
        },
        presentResult: () => ({ card: 'terminal', title: 'Finished', output: ' out\u0000 ' }),
      }),
    ])
    const target = agent('interactive', '/workspace')
    const foreign = agent('foreign', '/workspace')
    const streams = io()
    const renderer = new TerminalSessionRenderer(
      ctx,
      target,
      streams.value,
      'interactive',
      { provider: 'p', model: 'm' },
    )

    emit(ctx, foreign, assistant(1, 1, 'ignored', 1))
    emit(ctx, target, event('turn/start', { turn: 1 }, 1))
    emit(ctx, target, event('step/start', { turn: 1, step: 1 }, 1))
    emit(ctx, target, event('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'hidden' },
    }, 2))
    emit(ctx, target, event('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '' },
    }, 3))
    emit(ctx, target, event('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hel' },
    }, 4))
    emit(ctx, target, event('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' },
    }, 4))
    emit(ctx, target, assistant(1, 1, 'hello', 5))
    emit(ctx, target, event('tool/call', {
      turn: 1, step: 1, callId: CallId('call-1'), name: 'shell', arguments: '{"cmd":"pwd"}',
    }, 6))
    emit(ctx, target, toolResult(1, 1, 'call-1', [{ type: 'text', text: 'raw' }], 7))
    emit(ctx, target, assistant(1, 2, 'fallback', 8))
    emit(ctx, target, event('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }, 9))
    emit(ctx, target, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 9))
    emit(ctx, target, event('turn/end', {
      turn: 2,
      reason: { kind: 'error', error: { code: 'E\u001b[2J', message: 'bad\u0000 response' } },
    }, 10))
    expect((renderer as unknown as { calls: Map<string, unknown>; streamedSteps: Set<string> }).calls.size).toBe(0)
    expect((renderer as unknown as { calls: Map<string, unknown>; streamedSteps: Set<string> }).streamedSteps.size).toBe(0)
    emit(ctx, target, event('assistant/chunk', {
      turn: 3, step: 1, chunk: { type: 'text-delta', index: 0, text: 'last' },
    }, 11))
    renderer.dispose()
    emit(ctx, target, assistant(3, 1, 'after dispose', 12))

    expect(presented).toEqual([{ cmd: 'pwd' }])
    expect(streams.stdout.text()).toBe(
      'assistant> hello\n'
      + '→ Run[31m\n'
      + '✓ Finished\n'
      + 'out\n'
      + 'assistant> fallback\n'
      + 'assistant> last\n',
    )
    expect(streams.stderr.text()).toBe(
      'dsh: turn max-tokens\n'
      + 'dsh: E[2J: bad response\n',
    )
  })

  it('emits the stable JSONL lifecycle and commits one completed terminal record explicitly', () => {
    let resultInput: unknown
    const { ctx } = harness([
      tool('inspect', {
        presentCall: args => ({ card: 'generic', title: `Inspect ${(args as { path: string }).path}` }),
        presentResult: (_args, result) => {
          resultInput = result
          return { card: 'generic', title: 'Inspected', content: [{ type: 'text', text: 'summary' }] }
        },
      }),
      tool('empty', {
        presentCall: () => ({ card: 'generic', title: 'Empty' }),
        presentResult: () => ({ card: 'terminal' }),
      }),
    ])
    const target = agent('json-thread', '/repo')
    const streams = io()
    const renderer = new TerminalSessionRenderer(
      ctx,
      target,
      streams.value,
      'exec-json',
      { provider: 'deepseek', model: 'chat' },
    )

    emit(ctx, target, event('turn/start', { turn: 1 }, 1))
    emit(ctx, target, event('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' },
    }, 2))
    emit(ctx, target, assistant(1, 1, 'hi there', 3))
    emit(ctx, target, event('tool/call', {
      turn: 1, step: 1, callId: CallId('inspect-1'), name: 'inspect', arguments: '{"path":"a.ts"}',
    }, 4))
    emit(ctx, target, toolResult(
      1,
      1,
      'inspect-1',
      [{ type: 'text', text: 'raw' }],
      5,
      { error: { name: 'Error', code: 'FAILED' }, meta: { page: 2 } },
    ))
    emit(ctx, target, event('tool/call', {
      turn: 1, step: 1, callId: CallId('empty-1'), name: 'empty', arguments: '{}',
    }, 6))
    emit(ctx, target, toolResult(1, 1, 'empty-1', [{ type: 'text', text: '' }], 7))
    emit(ctx, target, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 6))
    renderer.finish()
    renderer.finish()
    renderer.dispose()

    const records = jsonLines(streams.stdout.text())
    expect(records.map(record => record.type)).toEqual([
      'thread.started',
      'turn.started',
      'item.updated',
      'item.completed',
      'item.started',
      'item.completed',
      'item.started',
      'item.completed',
      'turn.completed',
    ])
    expect(records[0]).toEqual({
      schemaVersion: 1,
      type: 'thread.started',
      threadId: 'json-thread',
      cwd: '/repo',
      provider: 'deepseek',
      model: 'chat',
    })
    expect(records[2]).toMatchObject({
      type: 'item.updated',
      item: { id: 'message-1-1', type: 'agent_message', delta: 'hi' },
    })
    expect(records[3]).toMatchObject({
      type: 'item.completed',
      item: { id: 'message-1-1', type: 'agent_message', text: 'hi there' },
    })
    expect(records[4]).toMatchObject({
      type: 'item.started',
      item: { id: 'inspect-1', type: 'tool_call', name: 'inspect', title: 'Inspect a.ts' },
    })
    expect(records[5]).toMatchObject({
      type: 'item.completed',
      item: {
        id: 'inspect-1', type: 'tool_call', name: 'inspect', title: 'Inspected', failed: true, output: 'summary',
      },
    })
    expect(records[7]).toMatchObject({
      type: 'item.completed',
      item: { id: 'empty-1', type: 'tool_call', name: 'empty', title: 'Empty', failed: false },
    })
    expect(records[7]).not.toHaveProperty('item.output')
    expect(records[8]).toMatchObject({ type: 'turn.completed', turn: 1, seq: 6 })
    expect(resultInput).toEqual({
      content: [{ type: 'text', text: 'raw' }],
      isError: false,
      meta: { page: 2 },
    })
    expect(streams.stderr.text()).toBe('')
  })

  it('commits failed and synthetic JSON terminal records once with the real thread identity', () => {
    const cases: Array<{
      id: string
      end?: SessionEvent<'turn/end'>
      finish: 'turn' | 'failure'
      expected: Record<string, unknown>
    }> = [
      {
        id: 'model-error',
        end: event('turn/end', {
          turn: 2,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'unavailable' } },
        }, 7),
        finish: 'turn',
        expected: {
          type: 'turn.failed', threadId: 'model-error', turn: 2, seq: 7,
          reason: 'error', error: { code: 'SERVER', message: 'unavailable' },
        },
      },
      {
        id: 'aborted',
        end: event('turn/end', {
          turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } },
        }, 8),
        finish: 'turn',
        expected: { type: 'turn.failed', threadId: 'aborted', turn: 3, seq: 8, reason: 'aborted' },
      },
      {
        id: 'durability',
        end: event('turn/end', { turn: 4, reason: { kind: 'completed' } }, 9),
        finish: 'failure',
        expected: {
          type: 'turn.failed', threadId: 'durability', turn: 4, seq: 9,
          reason: 'error', error: { code: 'CLI_ERROR', message: 'flush failed' },
        },
      },
      {
        id: 'no-turn',
        finish: 'turn',
        expected: { type: 'turn.failed', threadId: 'no-turn', turn: 0, seq: 1, reason: 'no-turn' },
      },
      {
        id: 'started-only',
        finish: 'failure',
        expected: {
          type: 'turn.failed', threadId: 'started-only', turn: 5, seq: 10,
          reason: 'error', error: { code: 'CLI_ERROR', message: 'driver failed' },
        },
      },
      {
        id: 'failed-no-turn',
        finish: 'failure',
        expected: {
          type: 'turn.failed', threadId: 'failed-no-turn', turn: 0, seq: 1,
          reason: 'error', error: { code: 'CLI_ERROR', message: 'driver failed' },
        },
      },
    ]

    for (const item of cases) {
      const { ctx } = harness()
      const target = agent(item.id, '/repo')
      const streams = io()
      const renderer = new TerminalSessionRenderer(
        ctx, target, streams.value, 'exec-json', { provider: 'p', model: 'm' },
      )
      if (item.id === 'started-only') emit(ctx, target, event('turn/start', { turn: 5 }, 10))
      if (item.end !== undefined) emit(ctx, target, item.end)
      if (item.finish === 'failure') renderer.fail(item.id === 'durability' ? 'flush failed' : 'driver failed')
      else renderer.finish()
      renderer.fail('ignored duplicate')
      renderer.finish()
      renderer.dispose()

      const records = jsonLines(streams.stdout.text())
      expect(records.at(-1)).toMatchObject(item.expected)
      expect(records.filter(record => record.type === 'turn.completed' || record.type === 'turn.failed'))
        .toHaveLength(1)
      if (item.id === 'aborted') expect(records.at(-1)).not.toHaveProperty('error')
    }
  })

  it('summarizes every supported result card in human exec progress', () => {
    const definitions = [
      tool('terminal', {
        presentCall: () => ({ card: 'terminal', title: 'Run' }),
        presentResult: () => ({ card: 'terminal', output: ' terminal output ' }),
      }),
      tool('terminal-empty', {
        presentResult: () => ({ card: 'terminal' }),
      }),
      tool('generic', {
        presentResult: () => ({
          card: 'generic', title: 'Generic done', content: [{ type: 'text', text: 'visible' }],
        }),
      }),
      tool('generic-fallback', {
        presentResult: () => ({ card: 'generic', content: [] }),
      }),
      tool('generic-undefined', {
        presentResult: () => ({ card: 'generic' }),
      }),
      tool('diff', {
        presentResult: () => ({
          card: 'diff', title: 'Changed files', diffs: [
            { path: 'a.ts', oldText: 'a', newText: 'b' },
            { path: 'b.ts', oldText: null, newText: 'x' },
          ],
        }),
      }),
      tool('diff-plain', {
        presentResult: () => ({
          card: 'diff', diffs: [{ path: 'plain.ts', oldText: null, newText: 'x' }],
        }),
      }),
      tool('read', {
        presentResult: () => ({
          card: 'read', title: 'Read a.ts', path: 'a.ts', offset: 1,
          lines: [{ number: 1, text: 'a' }, { number: 2, text: 'b' }], totalLines: 5,
        }),
      }),
      tool('read-plain', {
        presentResult: () => ({
          card: 'read', path: 'plain.ts', offset: 1, lines: [], totalLines: 0,
        }),
      }),
      tool('search-one', {
        presentResult: () => ({
          card: 'search', shape: 'paths', title: 'Found one', paths: ['a'], total: 1, truncated: false,
        }),
      }),
      tool('search-many', {
        presentResult: () => ({
          card: 'search', shape: 'matches', files: [], total: 3, truncated: true,
        }),
      }),
      tool('web-one', {
        presentResult: () => ({
          card: 'web', kind: 'search', title: 'One source',
          sources: [{ url: 'https://one.test' }], truncated: false,
        }),
      }),
      tool('web-many', {
        presentResult: () => ({
          card: 'web', kind: 'search', sources: [{ url: 'a' }, { url: 'b' }], truncated: true,
        }),
      }),
      tool('fetch', {
        presentResult: () => ({
          card: 'web', kind: 'fetch', url: 'https://example.test/final', statusCode: 206, truncated: true,
        }),
      }),
      tool('throwing', {
        presentCall: () => { throw new Error('call presenter failed') },
        presentResult: () => { throw new Error('result presenter failed') },
      }),
      tool('future', {
        presentResult: () => ({ card: 'future' } as never),
      }),
    ]
    const { ctx } = harness(definitions)
    const target = agent('human')
    const streams = io()
    const renderer = new TerminalSessionRenderer(
      ctx,
      target,
      streams.value,
      'exec-human',
      { provider: 'p', model: 'm' },
    )
    let seq = 1
    emit(ctx, target, event('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'not human progress' },
    }, seq++))
    const complete = (
      name: string,
      raw: string,
      options: { arguments?: string; isError?: boolean } = {},
    ): void => {
      const id = `call-${seq}`
      emit(ctx, target, event('tool/call', {
        turn: 1,
        step: 1,
        callId: CallId(id),
        name,
        arguments: options.arguments ?? '{}',
      }, seq++))
      emit(ctx, target, toolResult(
        1,
        1,
        id,
        [{ type: 'text', text: raw }],
        seq++,
        options.isError === undefined ? {} : { isError: options.isError },
      ))
    }

    complete('terminal', 'raw')
    complete('terminal-empty', 'raw')
    complete('generic', 'raw')
    complete('generic-fallback', 'raw fallback')
    complete('generic-undefined', 'undefined fallback')
    complete('diff', 'raw')
    complete('diff-plain', 'raw')
    complete('read', 'raw')
    complete('read-plain', 'raw')
    complete('search-one', 'raw')
    complete('search-many', 'raw')
    complete('web-one', 'raw')
    complete('web-many', 'raw')
    complete('fetch', 'raw')
    complete('throwing', 'presenter fallback', { arguments: '{broken', isError: true })
    complete('future', 'future fallback')
    emit(ctx, target, toolResult(1, 1, 'orphan', [{ type: 'text', text: 'orphan raw' }], seq++))
    renderer.finish()
    renderer.dispose()

    const text = streams.stderr.text()
    expect(text).toContain('→ Run\n✓ Run\nterminal output\n')
    expect(text).toContain('→ terminal-empty\n✓ terminal-empty\n')
    expect(text).toContain('→ generic\n✓ Generic done\nvisible\n')
    expect(text).toContain('→ generic-fallback\n✓ generic-fallback\nraw fallback\n')
    expect(text).toContain('→ generic-undefined\n✓ generic-undefined\nundefined fallback\n')
    expect(text).toContain('→ diff\n✓ Changed files\na.ts, b.ts\n')
    expect(text).toContain('→ diff-plain\n✓ diff-plain\nplain.ts\n')
    expect(text).toContain('→ read\n✓ Read a.ts\na.ts: 2/5 lines\n')
    expect(text).toContain('→ read-plain\n✓ read-plain\nplain.ts: 0/0 lines\n')
    expect(text).toContain('→ search-one\n✓ Found one\n1 result\n')
    expect(text).toContain('→ search-many\n✓ search-many\n3 results (truncated)\n')
    expect(text).toContain('→ web-one\n✓ One source\n1 source\n')
    expect(text).toContain('→ web-many\n✓ web-many\n2 sources (truncated)\n')
    expect(text).toContain('→ fetch\n✓ fetch\nhttps://example.test/final (206)\n')
    expect(text).toContain('→ throwing\n✗ throwing\npresenter fallback\n')
    expect(text).toContain('→ future\n✓ future\nfuture fallback\n')
    expect(text).toContain('✓ tool\norphan raw\n')
    expect(streams.stdout.text()).toBe('')
  })

  it('contains renderer failures, sanitizes diagnostics, and removes its listener on dispose', () => {
    const { ctx } = harness()
    const target = agent('failure')
    const streams = io()
    const renderer = new TerminalSessionRenderer(
      ctx,
      target,
      streams.value,
      'exec-human',
      { provider: 'p', model: 'm' },
    )

    emit(ctx, target, event('tool/call', {
      turn: 1, step: 1, callId: CallId('boom'), name: 'registry-boom', arguments: '{}',
    }, 1))
    emit(ctx, target, event('tool/call', {
      turn: 1, step: 1, callId: CallId('string'), name: 'registry-string', arguments: '{}',
    }, 2))
    renderer.dispose()
    emit(ctx, target, assistant(1, 1, 'ignored', 2))

    expect(streams.stderr.text()).toBe(
      'dsh: renderer: registry[31m exploded\n'
      + 'dsh: renderer: registry string failure\n',
    )
    expect(streams.stdout.text()).toBe('')
  })

  it('uses the process cwd when a JSON thread has no stored workspace', () => {
    const { ctx } = harness()
    const target = agent('cwd-fallback')
    const streams = io()
    const renderer = new TerminalSessionRenderer(
      ctx,
      target,
      streams.value,
      'exec-json',
      { provider: 'p', model: 'm' },
    )
    renderer.dispose()

    expect(jsonLines(streams.stdout.text())[0]).toMatchObject({ cwd: process.cwd() })
  })
})
