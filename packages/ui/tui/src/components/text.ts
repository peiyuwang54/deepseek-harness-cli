/**
 * Terminal text sanitization shared across the pi-tui front door. External text
 * (model output, tool results, clipboard) is escaped or stripped of C0/C1
 * controls before the TUI adds its own application-owned ANSI.
 * @module @deepseek-ai/dsh-tui/components/text
 */

const TERMINAL_CONTROL_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu
const TERMINAL_OSC_PATTERN = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
const TERMINAL_CSI_PATTERN = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
const TERMINAL_ESCAPE_PATTERN = /\u001B[@-_]/gu

/** Bracketed-paste start marker emitted by terminals around pasted content. */
export const BRACKETED_PASTE_START = '\u001B[200~'
/** Bracketed-paste end marker emitted by terminals around pasted content. */
export const BRACKETED_PASTE_END = '\u001B[201~'

/**
 * Escape external C0/C1 controls before pi-tui adds application-owned ANSI.
 * Line feeds remain structural so transcript and tool output retain their layout.
 * @param text - Untrusted text to render.
 * @returns The text with control characters escaped as `\xNN`.
 */
export function displayText(text: string): string {
  return text.replace(TERMINAL_CONTROL_PATTERN, control =>
    `\\x${control.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

/**
 * Escape external controls for terminal fields that must remain on one line.
 * @param text - Untrusted text to render inline.
 * @returns The escaped text with newlines rendered as `\x0a`.
 */
export function displayInlineText(text: string): string {
  return displayText(text).replaceAll('\n', '\\x0a')
}

/**
 * Remove terminal controls from clipboard text before an editable field stores it.
 * @param text - Raw pasted clipboard text.
 * @returns The text stripped of OSC, CSI, escape, and control sequences.
 */
export function sanitizePastedText(text: string): string {
  return text
    .replace(TERMINAL_OSC_PATTERN, '')
    .replace(TERMINAL_CSI_PATTERN, '')
    .replace(TERMINAL_ESCAPE_PATTERN, '')
    .replace(TERMINAL_CONTROL_PATTERN, '')
}
