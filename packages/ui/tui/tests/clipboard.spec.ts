import { describe, expect, it } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  latestVisibleAssistantText,
  OSC52_MAX_RAW_BYTES,
  osc52ClipboardSequence,
} from '../src/chat/clipboard.ts'

function appendAssistant(
  session: Session,
  text: string,
  surfaceOp: 'append' | 'replace' = 'append',
): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, surfaceOp === 'append'
    ? { surfaceOp }
    : { surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] })
}

describe('TUI clipboard helpers', () => {
  it('selects the latest non-empty append-origin assistant response', () => {
    const session = Session.create(SessionId('clipboard'))
    appendAssistant(session, 'first')
    appendAssistant(session, 'model-only replacement', 'replace')
    appendAssistant(session, '   ')

    expect(latestVisibleAssistantText(session.events)).toBe('first')
  })

  it('returns no response for an empty session', () => {
    expect(latestVisibleAssistantText([])).toBeUndefined()
  })

  it('base64-frames Unicode without exposing its terminal controls', () => {
    const text = '你好\n\x1b]2;unsafe\x07'
    const sequence = osc52ClipboardSequence(text)

    expect(sequence).toBe(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`)
    expect(sequence).not.toContain('unsafe')
  })

  it('preserves response markdown and wraps terminal copy for tmux', () => {
    const session = Session.create(SessionId('clipboard-markdown'))
    appendAssistant(session, '  **answer**\n')

    expect(latestVisibleAssistantText(session.events)).toBe('  **answer**\n')
    expect(osc52ClipboardSequence('hello', true)).toBe(
      `\x1bPtmux;\x1b\x1b]52;c;${Buffer.from('hello').toString('base64')}\x07\x1b\\`,
    )
  })

  it('rejects oversized terminal clipboard payloads before encoding', () => {
    expect(() => osc52ClipboardSequence('a'.repeat(OSC52_MAX_RAW_BYTES + 1))).toThrow(
      `maximum is ${String(OSC52_MAX_RAW_BYTES)}`,
    )
  })
})
