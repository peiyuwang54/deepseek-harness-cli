import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type ContentBlock,
} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  renderMarkdownTranscript,
  renderRawTranscript,
  resolveTranscriptExportPath,
  transcriptExportFilename,
  writeMarkdownTranscript,
} from '../src/chat/transcript-export.ts'

const roots: string[] = []

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-export-'))
  roots.push(root)
  return root
}

function image(name?: string): ContentBlock {
  return {
    type: 'image',
    attachment: {
      attachmentId: 'attachment-1' as never,
      mediaType: 'image/png',
      bytes: 10,
      width: 2,
      height: 3,
      ...name === undefined ? {} : { name },
    },
  }
}

function appendDirectUser(session: Session, content: ContentBlock[]): void {
  session.append('user/message', createUserMessage({
    content,
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

function appendAssistant(session: Session, content: ContentBlock[]): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({ content, source: { provider: 'mock', model: 'mock' } }),
  }, { surfaceOp: 'append' })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Markdown transcript rendering', () => {
  it('renders copy-friendly source without roles or rich prefixes', () => {
    const session = Session.create(SessionId('raw-transcript'))
    expect(renderRawTranscript(session.events, false)).toBe('')
    appendDirectUser(session, [{ type: 'text', text: 'Keep **source**.\n' }])
    appendAssistant(session, [
      { type: 'reasoning', text: 'Inspect `raw`.' },
      { type: 'text', text: '- one\n- two\n' },
    ])

    expect(renderRawTranscript(session.events, false)).toBe([
      'Keep **source**.',
      '- one\n- two',
    ].join('\n\n'))
    expect(renderRawTranscript(session.events, true)).toBe([
      'Keep **source**.',
      'Inspect `raw`.',
      '- one\n- two',
    ].join('\n\n'))
  })

  it('rejects a snapshot with no human-visible conversation', () => {
    const session = Session.create(SessionId('empty-export'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'internal instructions' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: 'append' })

    expect(() => renderMarkdownTranscript(session.events, false))
      .toThrow('No conversation content to export.')
  })

  it('preserves raw Markdown and images while following reasoning visibility', () => {
    const session = Session.create(SessionId('conversation-export'))
    appendDirectUser(session, [{ type: 'text', text: '   ' }])
    appendDirectUser(session, [
      { type: 'text', text: '  **question**\n' },
      image('diagram.png'),
      image(),
    ])
    appendAssistant(session, [
      { type: 'reasoning', text: '_private analysis_' },
      { type: 'text', text: '**answer**\n' },
      { type: 'text', text: 'second block' },
      image('result.png'),
    ])
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'replacement summary' }],
        source: { provider: 'mock', model: 'mock' },
      }),
    }, {
      surfaceOp: { op: 'replace', start: 0, end: 1 },
      sourceEventSeqs: [0, 1],
    })

    const hidden = renderMarkdownTranscript(session.events, false)
    expect(hidden).toBe([
      '# DeepSeek conversation',
      '',
      '## User',
      '',
      '  **question**\n',
      '',
      '[Image: diagram.png]',
      '',
      '[Image: attachment-1]',
      '',
      '## Assistant',
      '',
      '**answer**\n',
      '',
      'second block',
      '',
      '[Image: result.png]',
      '',
    ].join('\n'))
    expect(hidden).not.toContain('replacement summary')
    expect(hidden).not.toContain('private analysis')
    expect(renderMarkdownTranscript(session.events, true)).toContain(
      '## Reasoning\n\n_private analysis_\n',
    )
  })

  it('exports only tool activity paired to a visible assistant request', () => {
    const session = Session.create(SessionId('activity-export'))
    const callId = CallId('visible-call')
    const successfulCallId = CallId('successful-call')
    const eventErrorCallId = CallId('event-error-call')
    appendAssistant(session, [
      {
        type: 'tool-call',
        id: callId,
        name: 'read',
        arguments: '{"path":"README.md"}',
      },
      { type: 'tool-call', id: successfulCallId, name: 'status', arguments: '{}' },
      { type: 'tool-call', id: eventErrorCallId, name: 'write', arguments: '{}' },
    ])
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'read',
      arguments: '{"path":"README.md"}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        isError: true,
        content: [
          { type: 'text', text: '' },
          { type: 'text', text: 'permission denied' },
          image(),
          {
            type: 'tool-result',
            toolCallId: callId,
            content: [{ type: 'reasoning', text: 'nested detail' }],
          },
          { type: 'tool-call', id: CallId('nested'), name: 'nested', arguments: '{}' },
          { type: 'custom-result' } as unknown as ContentBlock,
        ],
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: successfulCallId,
      name: 'status',
      arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: successfulCallId,
        isError: false,
        content: [],
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: eventErrorCallId,
      name: 'write',
      arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: eventErrorCallId,
        isError: false,
        content: [{ type: 'text', text: 'not written' }],
      }),
      error: { name: 'ToolError', code: 'WRITE_FAILED' },
    }, { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('orphan'),
      name: 'secret',
      arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('orphan'),
        isError: false,
        content: [{ type: 'text', text: 'hidden orphan result' }],
      }),
    }, { surfaceOp: 'append' })

    expect(renderMarkdownTranscript(session.events, false)).toContain([
      '## Activity',
      '',
      '    read({"path":"README.md"})',
      '',
      '## Activity',
      '',
      '    read result (error)',
      '    permission denied',
      '    [Image: attachment-1]',
      '    nested detail',
      '    nested({})',
      '    [custom-result]',
    ].join('\n'))
    expect(renderMarkdownTranscript(session.events, false)).not.toContain('secret')
    expect(renderMarkdownTranscript(session.events, false)).not.toContain('hidden orphan result')
    expect(renderMarkdownTranscript(session.events, false)).toContain('    status result\n')
    expect(renderMarkdownTranscript(session.events, false)).toContain('    write result (error)\n')
  })

  it('retains merge-extended content labels without trusting their payload', () => {
    const custom = { type: 'custom-block' } as unknown as ContentBlock
    const untyped = { value: 'opaque' } as unknown as ContentBlock
    const callId = CallId('user-call')
    const session = Session.create(SessionId('extended-export'))
    appendDirectUser(session, [
      { type: 'text', text: '' },
      { type: 'reasoning', text: 'user note' },
      { type: 'tool-call', id: callId, name: 'user-tool', arguments: '{}' },
      {
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text: 'user result' }],
      },
      custom,
      untyped,
    ])
    appendAssistant(session, [
      custom,
      untyped,
      { type: 'tool-call', id: callId, name: 'ignored', arguments: '{}' },
      { type: 'tool-result', toolCallId: callId, content: [] },
      { type: 'text', text: '   ' },
      { type: 'text', text: 'trailing newline\n' },
    ])

    const markdown = renderMarkdownTranscript(session.events, true)
    expect(markdown).toContain('user note\n\nuser-tool({})\n\nuser result')
    expect(markdown).toContain('[custom-block]')
    expect(markdown).toContain('[content]')
  })

  it('assembles only the current open stream after retry and settled boundaries', () => {
    const chunk = (seq: number, turn: number, text: string): SessionEvent => ({
      type: 'assistant/chunk',
      seq,
      time: seq,
      data: { turn, step: 1, chunk: { type: 'text-delta', index: 0, text } },
    })
    const events = [
      chunk(0, 1, 'discarded'),
      {
        type: 'llm/retry',
        seq: 1,
        time: 1,
        data: {
          retryId: 'retry-1',
          turn: 1,
          step: 1,
          provider: 'mock',
          mode: 'normal',
          policyKey: 'test',
          retry: 1,
          maxRetries: 2,
          delayMs: 1,
          failure: { message: 'retry', code: 'RETRY' },
        },
      } as SessionEvent,
      chunk(2, 1, 'live **answer**'),
      chunk(3, 2, 'step ended'),
      { type: 'step/end', seq: 4, time: 4, data: { turn: 2, step: 1 } } as SessionEvent,
      chunk(5, 3, 'message settled'),
      {
        type: 'assistant/message',
        seq: 6,
        time: 6,
        data: {
          turn: 3,
          step: 1,
          message: createAssistantMessage({
            content: [],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        surfaceOp: 'append',
      } as SessionEvent,
      chunk(7, 4, 'turn ended'),
      { type: 'turn/end', seq: 8, time: 8, data: { turn: 4, reason: { kind: 'completed' } } } as SessionEvent,
      chunk(9, 5, 'other open stream'),
      chunk(10, 5, ' continued'),
    ]

    expect(renderMarkdownTranscript(events, false)).toBe([
      '# DeepSeek conversation',
      '',
      '## Assistant',
      '',
      'live **answer**',
      '',
      '## Assistant',
      '',
      'other open stream continued',
      '',
    ].join('\n'))
  })
})

describe('transcript export paths', () => {
  it('resolves workspace, absolute, and home-relative destinations', () => {
    const cwd = resolve('/workspace/project')
    const absolute = resolve('/tmp/absolute-export.md')
    expect(resolveTranscriptExportPath(cwd, ' nested/export.md '))
      .toBe(resolve(cwd, 'nested/export.md'))
    expect(resolveTranscriptExportPath(cwd, absolute)).toBe(absolute)
    expect(resolveTranscriptExportPath(cwd, '~')).toBe(resolve(homedir()))
    expect(resolveTranscriptExportPath(cwd, '~/export.md')).toBe(resolve(homedir(), 'export.md'))
    expect(resolveTranscriptExportPath(cwd, '~\\folder/export.md'))
      .toBe(resolve(homedir(), 'folder/export.md'))
  })

  it('creates portable defaults from opaque session ids', () => {
    expect(transcriptExportFilename('session-123')).toBe('deepseek-session-session-123.md')
    expect(transcriptExportFilename(' /\u001b\n ')).toBe('deepseek-session-session.md')
  })

  it('publishes synced contents without leaving a sibling temp file', async () => {
    const root = await temporaryDirectory()
    const controller = new AbortController()
    const path = await writeMarkdownTranscript(root, 'conversation.md', '# transcript\n', controller.signal)

    expect(path).toBe(join(root, 'conversation.md'))
    expect(await readFile(path, 'utf8')).toBe('# transcript\n')
    expect(await readdir(root)).toEqual(['conversation.md'])
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
  })

  it('never overwrites an existing destination', async () => {
    const root = await temporaryDirectory()
    const path = join(root, 'conversation.md')
    await writeFile(path, 'keep me')

    await expect(writeMarkdownTranscript(
      root,
      'conversation.md',
      'replacement',
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path, 'utf8')).toBe('keep me')
    expect(await readdir(root)).toEqual(['conversation.md'])
  })

  it('rejects missing parents and pre-publication cancellation without residue', async () => {
    const root = await temporaryDirectory()
    await expect(writeMarkdownTranscript(
      root,
      'missing/conversation.md',
      'content',
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'ENOENT' })

    const controller = new AbortController()
    controller.abort(new Error('cancelled by test'))
    await expect(writeMarkdownTranscript(root, 'cancelled.md', 'content', controller.signal))
      .rejects.toThrow('cancelled by test')
    expect(await readdir(root)).toEqual([])
  })
})
