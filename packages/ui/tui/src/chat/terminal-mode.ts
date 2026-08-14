/**
 * Alternate-screen and SGR mouse ownership for the interactive TUI. The
 * renderer keeps these terminal modes outside pi-tui so it can restore them
 * together after pi-tui has released raw input.
 * @module @deepseek-ai/dsh-tui/chat/terminal-mode
 */

import type { Terminal } from '@earendil-works/pi-tui'

const ENTER_ALTERNATE_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H'
const LEAVE_ALTERNATE_SCREEN = '\x1b[?1049l'
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h'
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1000l'

/** Application mouse input decoded from the terminal's SGR 1006 protocol. */
export interface TuiMouseEvent {
  /** Button or wheel direction after stripping modifier bits. */
  readonly button: 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down'
  /** One-based terminal column. */
  readonly column: number
  /** One-based terminal row. */
  readonly row: number
  /** Whether this is a press, release, or wheel tick. */
  readonly action: 'press' | 'release' | 'wheel'
}

/**
 * Parse one SGR 1006 mouse input sequence.
 * @param data - Raw terminal input sequence.
 * @returns The decoded event, or `undefined` for non-mouse or unsupported motion input.
 */
export function parseTuiMouseEvent(data: string): TuiMouseEvent | undefined {
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/u.exec(data)
  if (match === null) return undefined
  const code = Number(match[1])
  const column = Number(match[2])
  const row = Number(match[3])
  const terminator = match[4]
  if (column < 1 || row < 1 || (code & 32) !== 0) return undefined
  if ((code & 64) !== 0) {
    const direction = code & 1
    return {
      button: direction === 0 ? 'wheel-up' : 'wheel-down',
      column,
      row,
      action: 'wheel',
    }
  }
  const button = code & 3
  if (button === 3) return undefined
  return {
    button: button === 0 ? 'left' : button === 1 ? 'middle' : 'right',
    column,
    row,
    action: terminator === 'm' ? 'release' : 'press',
  }
}

/** Options for terminal modes owned outside pi-tui. */
export interface TuiTerminalModeOptions {
  /** Render in the terminal's alternate screen. */
  readonly fullscreen: boolean
  /** Enable application mouse input while the alternate screen is active. */
  readonly mouse: boolean
}

/**
 * Own alternate-screen and mouse modes for one mounted renderer.
 *
 * `leave()` is idempotent and reverses only modes whose enable write began.
 * @param terminal - Terminal receiving mode-control sequences.
 * @param options - Full-screen and application-mouse choices.
 * @returns Lifecycle handle entered immediately before pi-tui starts and left after it stops.
 */
export function createTuiTerminalMode(
  terminal: Pick<Terminal, 'write'>,
  options: TuiTerminalModeOptions,
): { enter(): void; leave(): void } {
  let alternateScreenActive = false
  let mouseActive = false
  return {
    enter(): void {
      if (options.fullscreen && !alternateScreenActive) {
        alternateScreenActive = true
        terminal.write(ENTER_ALTERNATE_SCREEN)
      }
      if (options.fullscreen && options.mouse && !mouseActive) {
        mouseActive = true
        terminal.write(ENABLE_MOUSE)
      }
    },
    leave(): void {
      if (mouseActive) {
        mouseActive = false
        terminal.write(DISABLE_MOUSE)
      }
      if (alternateScreenActive) {
        alternateScreenActive = false
        terminal.write(LEAVE_ALTERNATE_SCREEN)
      }
    },
  }
}
