/**
 * Ordered preview for messages submitted while a turn is running.
 * @module @deepseek-ai/dsh-tui/components/pending-input-preview
 */

import { truncateToWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import { tuiCopy, type TuiLocale } from '../chat/language.ts'
import { displayText } from './text.ts'
import type { Palette } from './theme.ts'

/** Maximum wrapped lines shown for one pending steering message. */
const PENDING_STEERING_PREVIEW_LINES = 3

/** Pending running-turn input shown immediately above the composer. */
export class PendingInputPreviewComponent implements Component {
  private messages: string[] = []

  /**
   * @param locale - Active interface locale.
   * @param palette - Semantic terminal palette.
   */
  constructor(
    private readonly locale: () => TuiLocale,
    private readonly palette: Palette,
  ) {}

  /**
   * Replace the ordered messages still waiting for a step boundary.
   * @param messages - Submitted human text in queue order.
   */
  update(messages: readonly string[]): void {
    this.messages = [...messages]
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.messages.length === 0 || width < 4) return []
    const copy = tuiCopy(this.locale())
    const header = `${this.palette.accent('•')} ${this.palette.text(copy.pendingSteering)}`
      + this.palette.dim(` (${copy.pendingSteeringInterrupt})`)
    const lines = wrapTextWithAnsi(header, width - 2)
      .map((line, index) => index === 0 ? line : `  ${line}`)
    const bodyWidth = width - 4
    for (const message of this.messages) {
      const wrapped = displayText(message).split('\n').flatMap(line =>
        wrapTextWithAnsi(this.palette.dim(line), bodyWidth))
      const visible = wrapped.slice(0, PENDING_STEERING_PREVIEW_LINES)
      for (let index = 0; index < visible.length; index += 1) {
        lines.push(`${this.palette.dim(index === 0 ? '  ↳ ' : '    ')}${visible[index] as string}`)
      }
      if (wrapped.length > PENDING_STEERING_PREVIEW_LINES) lines.push(this.palette.dim('    …'))
    }
    return lines.map(line => truncateToWidth(line, width, ''))
  }
}
