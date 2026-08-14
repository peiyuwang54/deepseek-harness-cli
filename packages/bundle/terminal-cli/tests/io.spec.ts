import { PassThrough, Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boundText,
  LineInput,
  MAX_STDIN_BYTES,
  readStdin,
  resolveExecPrompt,
  sanitizeTerminal,
} from '../src/io.ts'

const readlineFactory = vi.hoisted(() => ({
  create: undefined as ((options: unknown) => unknown) | undefined,
}))

vi.mock('node:readline/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:readline/promises')>()
  return {
    ...actual,
    createInterface(options: Parameters<typeof actual.createInterface>[0]) {
      return readlineFactory.create?.(options) ?? actual.createInterface(options)
    },
  }
})

class FakeReadline {
  private closeListener: (() => void) | undefined
  private interruptListener: (() => void) | undefined
  readonly question = vi.fn<(prompt: string, options: { signal: AbortSignal }) => Promise<string>>()
  readonly close = vi.fn(() => { this.emitClose() })

  once(event: 'close', listener: () => void): this {
    expect(event).toBe('close')
    this.closeListener = listener
    return this
  }

  on(event: 'SIGINT', listener: () => void): this {
    expect(event).toBe('SIGINT')
    this.interruptListener = listener
    return this
  }

  emitClose(): void {
    this.closeListener?.()
  }

  emitInterrupt(): void {
    this.interruptListener?.()
  }
}

function lineHarness(): { input: LineInput; readline: FakeReadline; interrupt: ReturnType<typeof vi.fn> } {
  const readline = new FakeReadline()
  const interrupt = vi.fn()
  readlineFactory.create = () => readline
  return {
    input: new LineInput(new PassThrough(), new PassThrough(), interrupt),
    readline,
    interrupt,
  }
}

function input(text: string, isTTY = false): PassThrough & { isTTY?: boolean } {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean }
  stream.isTTY = isTTY
  stream.end(text)
  return stream
}

afterEach(() => {
  readlineFactory.create = undefined
})

describe('terminal CLI IO', () => {
  it('keeps positional and piped input in deterministic order', async () => {
    await expect(resolveExecPrompt(['review', 'this'], input('file context')))
      .resolves.toBe('review this\n\nfile context')
    await expect(resolveExecPrompt(['-'], input('from stdin'))).resolves.toBe('from stdin')
    await expect(resolveExecPrompt([], input('implicit stdin'))).resolves.toBe('implicit stdin')
  })

  it('does not wait on a TTY when positional text already exists', async () => {
    await expect(resolveExecPrompt(['task'], input('', true))).resolves.toBe('task')
  })

  it('rejects empty input and bounded stdin overflow', async () => {
    await expect(resolveExecPrompt([], input('', true))).rejects.toThrow('prompt is required')
    await expect(resolveExecPrompt(['-'], input('   '))).rejects.toThrow('prompt is required')
    await expect(readStdin(input('x'.repeat(MAX_STDIN_BYTES + 1)))).rejects.toThrow('byte limit')
  })

  it('reads string and Buffer chunks through the same UTF-8 result', async () => {
    const strings = Readable.from(['plain text'], { objectMode: true })
    await expect(readStdin(strings)).resolves.toBe('plain text')
    await expect(readStdin(input('buffer text'))).resolves.toBe('buffer text')
  })

  it('removes terminal controls while preserving transcript whitespace', () => {
    expect(sanitizeTerminal('ok\u001b]52;c;secret\u0007\rOVER\nnext\tcell'))
      .toBe('ok]52;c;secretOVER\nnext\tcell')
  })

  it('keeps short detail and bounds longer detail at positive and zero limits', () => {
    expect(boundText('abc', 3)).toBe('abc')
    expect(boundText('abcd', 3)).toBe('ab…')
    expect(boundText('abcd', 0)).toBe('…')
  })
})

describe('LineInput', () => {
  it('serializes questions and preserves explicit or generated abort signals', async () => {
    const test = lineHarness()
    const first = Promise.withResolvers<string>()
    const controller = new AbortController()
    test.readline.question
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce('second answer')

    const firstAnswer = test.input.read('first> ')
    const secondAnswer = test.input.read('second> ', controller.signal)
    await Promise.resolve()
    expect(test.readline.question).toHaveBeenCalledTimes(1)

    first.resolve('first answer')
    await expect(firstAnswer).resolves.toBe('first answer')
    await expect(secondAnswer).resolves.toBe('second answer')
    const generatedSignal = test.readline.question.mock.calls[0]?.[1].signal
    expect(generatedSignal).toBeInstanceOf(AbortSignal)
    expect(test.readline.question.mock.calls).toEqual([
      ['first> ', { signal: generatedSignal }],
      ['second> ', { signal: controller.signal }],
    ])
  })

  it('continues the serialized queue after an ordinary question failure', async () => {
    const test = lineHarness()
    const failure = new Error('readline failed')
    test.readline.question
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('recovered')

    await expect(test.input.read('first> ')).rejects.toBe(failure)
    await expect(test.input.read('second> ')).resolves.toBe('recovered')
    expect(test.readline.question).toHaveBeenCalledTimes(2)
  })

  it('propagates an aborted question and treats use-after-close as EOF', async () => {
    const test = lineHarness()
    const controller = new AbortController()
    const aborted = new Error('aborted')
    const useAfterClose = Object.assign(new Error('closed'), { code: 'ERR_USE_AFTER_CLOSE' })
    controller.abort(aborted)
    test.readline.question
      .mockRejectedValueOnce(aborted)
      .mockRejectedValueOnce(useAfterClose)

    await expect(test.input.read('aborted> ', controller.signal)).rejects.toBe(aborted)
    await expect(test.input.read('closed> ')).resolves.toBeUndefined()
  })

  it('treats closure during a pending question as EOF', async () => {
    const test = lineHarness()
    const pending = Promise.withResolvers<string>()
    test.readline.question.mockImplementationOnce(() => pending.promise)

    const answer = test.input.read('pending> ')
    await Promise.resolve()
    test.readline.emitClose()
    pending.reject(new Error('closed while pending'))

    await expect(answer).resolves.toBeUndefined()
  })

  it('forwards SIGINT and closes only once before future reads return EOF', async () => {
    const test = lineHarness()

    test.readline.emitInterrupt()
    test.input.close()
    test.input.close()

    expect(test.interrupt).toHaveBeenCalledTimes(1)
    expect(test.readline.close).toHaveBeenCalledTimes(1)
    await expect(test.input.read('closed> ')).resolves.toBeUndefined()
    expect(test.readline.question).not.toHaveBeenCalled()
  })
})
