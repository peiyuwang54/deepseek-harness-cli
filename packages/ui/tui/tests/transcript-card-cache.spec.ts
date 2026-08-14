import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, CallId } from '@deepseek-ai/dsh-llm'
import { ContextCardComponent, ToolCardComponent } from '../src/components/transcript.ts'
import { parseArguments } from '../src/components/content.ts'
import { createPalette, markdownTheme } from '../src/components/theme.ts'

const palette = createPalette(false)
const mdTheme = markdownTheme(palette)

function toolCard(): ToolCardComponent {
  return new ToolCardComponent('bash', parseArguments('{"command":"ls"}'), undefined, 10, 2_000, palette, mdTheme)
}

function toolResult(text: string): Extract<SessionEvent, { type: 'tool/result' }>['data'] {
  const message = createToolResultMessage({
    callId: CallId('call-1'),
    content: [{ type: 'text', text }],
    isError: false,
  })
  return { turn: 1, step: 1, message }
}

// pi-tui re-renders every component each frame; the cards must serve repeat
// same-width renders from their line cache and drop it on every state change.
describe('transcript card render caches', () => {
  it('tool card: repeat same-width renders return the cached rows', () => {
    const card = toolCard()
    const first = card.render(80)
    expect(card.render(80)).toBe(first)
    const narrower = card.render(60)
    expect(narrower).not.toBe(first)
    expect(card.render(60)).toBe(narrower)
  })

  it('tool card: result, visibility, and invalidate() each drop the cache', () => {
    const card = toolCard()
    const pending = card.render(80)
    card.updateResult(toolResult('output line'))
    const settled = card.render(80)
    expect(settled).not.toBe(pending)
    expect(settled.join('\n')).toContain('●')

    card.setVisibility('hidden')
    expect(card.render(80)).toEqual([])

    card.setVisibility('collapsed')
    const restored = card.render(80)
    expect(restored).toEqual(settled)
    expect(restored).not.toBe(settled)

    card.invalidate()
    expect(card.render(80)).not.toBe(restored)
  })

  it('context card: caches by width and drops on setExpanded and invalidate()', () => {
    const card = new ContextCardComponent('workspace-context', 'line one\nline two', 10, palette)
    const first = card.render(80)
    expect(card.render(80)).toBe(first)

    // Same width across the mutation, so a hit here would prove a kept cache.
    card.setExpanded(true)
    const expanded = card.render(80)
    expect(expanded).not.toBe(first)
    expect(card.render(80)).toBe(expanded)

    card.invalidate()
    const reRendered = card.render(80)
    expect(reRendered).not.toBe(expanded)
    expect(reRendered).toEqual(expanded)

    expect(card.render(60)).not.toBe(reRendered)
  })
})
