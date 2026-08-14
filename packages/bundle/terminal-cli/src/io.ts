/** Process IO and line-input helpers for the terminal CLI. */

import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'

/** Maximum stdin context accepted by one unattended invocation. */
export const MAX_STDIN_BYTES = 1024 * 1024

/** Readable process stream shape used by production and test doubles. */
export type CliInput = Readable & { isTTY?: boolean }
/** Writable process stream shape used by production and test doubles. */
export type CliOutput = Writable & { isTTY?: boolean }

/** Process-facing effects owned by one terminal invocation. */
export interface TerminalCliIo {
  stdin: CliInput
  stdout: CliOutput
  stderr: CliOutput
  /** Request bounded application shutdown with an exit code. */
  exit(code: number): void
}

/** Process streams; tests replace these before applying the runner. */
export const internals: Pick<TerminalCliIo, 'stdin' | 'stdout' | 'stderr'> = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}

/**
 * Remove terminal control bytes from untrusted model/tool text. Newline and
 * horizontal tab remain useful transcript characters; carriage return and
 * ESC are removed so content cannot overwrite prompts or execute ANSI/OSC.
 * @param text - untrusted display text.
 * @returns text safe for literal line-oriented terminal output.
 */
export function sanitizeTerminal(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, '')
}

/**
 * Bound one display detail without cutting its initial context silently.
 * @param text - display detail to bound.
 * @param maxChars - maximum returned character count including the ellipsis.
 * @returns the original text or its bounded prefix.
 */
export function boundText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

/**
 * Read a process stream to UTF-8 EOF with an explicit memory bound.
 * @param input - process input stream.
 * @returns the complete decoded UTF-8 input.
 */
export async function readStdin(input: CliInput): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const raw of input) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))
    bytes += chunk.byteLength
    if (bytes > MAX_STDIN_BYTES) {
      throw new Error(`stdin exceeds the ${MAX_STDIN_BYTES}-byte limit`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Resolve exec positional text and stdin without dropping either source.
 * @param words - positional prompt words from the command line.
 * @param input - process input stream, read when explicit or non-TTY.
 * @returns the non-empty prompt submitted to the Agent.
 */
export async function resolveExecPrompt(words: readonly string[], input: CliInput): Promise<string> {
  const explicitStdin = words.length === 1 && words[0] === '-'
  const positional = explicitStdin ? '' : words.join(' ')
  const shouldRead = explicitStdin || input.isTTY !== true
  const piped = shouldRead ? await readStdin(input) : ''
  const parts = [positional, piped].filter(part => part.trim() !== '')
  if (parts.length === 0) {
    throw new Error('a prompt is required; pass text or pipe stdin to `dsh exec`')
  }
  return parts.join('\n\n')
}

/** One serialized readline owner shared by prompts, approvals, and questions. */
export class LineInput {
  private readonly readline: ReadlineInterface
  private tail: Promise<void> = Promise.resolve()
  private closed = false

  constructor(input: CliInput, output: CliOutput, onInterrupt: () => void) {
    this.readline = createInterface({ input, output, terminal: true })
    this.readline.once('close', () => { this.closed = true })
    this.readline.on('SIGINT', onInterrupt)
  }

  /**
   * Ask one line after every earlier owner has settled; EOF returns undefined.
   * @param prompt - literal prompt written by readline.
   * @param signal - optional cancellation owned by the active interaction.
   * @returns the entered line, or `undefined` after EOF/closure.
   */
  read(prompt: string, signal?: AbortSignal): Promise<string | undefined> {
    const operation = this.tail.then(async () => {
      if (this.closed) return undefined
      try {
        return await this.readline.question(prompt, { signal: signal ?? new AbortController().signal })
      } catch (error: unknown) {
        if (signal?.aborted === true) throw error
        if (this.isClosed() || (error as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') return undefined
        throw error
      }
    })
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** Stop accepting input; pending readline questions settle through close. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.readline.close()
  }

  /** Read closure state after an asynchronous question settles or rejects. */
  private isClosed(): boolean {
    return this.closed
  }
}
