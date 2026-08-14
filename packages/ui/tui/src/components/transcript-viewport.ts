/**
 * Scrollable transcript viewport used by alternate-screen rendering. It owns
 * only presentation position; the complete transcript remains in its child.
 * @module @deepseek-ai/dsh-tui/components/transcript-viewport
 */

import type { Component } from '@earendil-works/pi-tui'

/** Height resolver for a transcript render; `undefined` leaves inline output unclipped. */
export type TranscriptViewportHeight = (width: number) => number | undefined

/** Clip a transcript to the available viewport while retaining explicit scroll position. */
export class TranscriptViewport implements Component {
  private top = 0
  private visibleRows = 0
  private contentRows = 0
  private followingTail = true

  /**
   * @param content - Complete transcript component.
   * @param height - Available rows, or `undefined` for inline rendering.
   */
  constructor(
    private readonly content: Component,
    private readonly height: TranscriptViewportHeight,
  ) {}

  invalidate(): void {
    this.content.invalidate()
  }

  render(width: number): string[] {
    const lines = this.content.render(width)
    const requestedHeight = this.height(width)
    if (requestedHeight === undefined) {
      this.top = 0
      this.visibleRows = lines.length
      this.contentRows = lines.length
      this.followingTail = true
      return lines
    }
    const height = Math.max(0, Math.floor(requestedHeight))
    const maximumTop = Math.max(0, lines.length - height)
    if (this.followingTail) {
      this.top = maximumTop
    } else {
      this.top = Math.min(this.top, maximumTop)
      // A transcript rebuild can remove enough rows that the user's retained
      // position becomes the newest page. Treat that as reaching the tail so
      // later streaming output does not remain pinned above the answer.
      if (this.top === maximumTop) this.followingTail = true
    }
    this.visibleRows = height
    this.contentRows = lines.length
    const visible = lines.slice(this.top, this.top + height)
    while (visible.length < height) visible.push('')
    return visible
  }

  /**
   * Move by transcript rows and stop following new output unless the move reaches the tail.
   * @param rows - Positive scrolls toward newer content; negative scrolls toward older content.
   */
  scrollRows(rows: number): void {
    if (this.visibleRows <= 0) return
    const maximumTop = Math.max(0, this.contentRows - this.visibleRows)
    this.top = Math.max(0, Math.min(maximumTop, this.top + rows))
    this.followingTail = this.top === maximumTop
  }

  /**
   * Move one viewport page.
   * @param direction - `-1` for older content or `1` for newer content.
   */
  page(direction: -1 | 1): void {
    this.scrollRows(direction * Math.max(1, this.visibleRows - 2))
  }

  /** Resume following the newest transcript rows. */
  followTail(): void {
    this.followingTail = true
  }
}
