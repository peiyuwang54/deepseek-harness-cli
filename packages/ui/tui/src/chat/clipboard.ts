/**
 * Terminal clipboard helpers for the `/copy` command.
 * @module @deepseek-ai/dsh-tui/chat/clipboard
 */

import { isReplacementSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'
import { contentText } from '../components/content.ts'

/** Maximum raw UTF-8 response size accepted by the OSC 52 clipboard path. */
export const OSC52_MAX_RAW_BYTES = 100_000

/**
 * Return the newest assistant response rendered in the transcript.
 * Model-only replacement messages are excluded because the TUI does not show
 * them as assistant responses.
 * @param events - Durable events for the active session.
 * @returns The response text, or `undefined` when no visible response exists.
 */
export function latestVisibleAssistantText(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message' || isReplacementSurfaceEvent(event)) continue
    const text = contentText(event.data.message.content)
    if (text.trim() !== '') return text
  }
  return undefined
}

/**
 * Encode trusted text as an OSC 52 clipboard-write sequence.
 * Base64 keeps response text from injecting terminal controls into the frame.
 * @param text - Text to place on the terminal clipboard.
 * @param tmux - Wrap the sequence for tmux passthrough.
 * @returns One complete OSC 52 sequence using the default clipboard selector.
 * @throws {RangeError} when the raw UTF-8 payload exceeds the terminal-safe bound.
 */
export function osc52ClipboardSequence(text: string, tmux = false): string {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > OSC52_MAX_RAW_BYTES) {
    throw new RangeError(`OSC 52 payload is ${String(bytes)} bytes; maximum is ${String(OSC52_MAX_RAW_BYTES)}`)
  }
  const sequence = `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`
  return tmux ? `\x1bPtmux;\x1b${sequence}\x1b\\` : sequence
}
