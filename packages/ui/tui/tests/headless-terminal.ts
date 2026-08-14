import type { Terminal } from '@earendil-works/pi-tui'
import { Terminal as XtermTerminal, type IBufferCell } from '@xterm/headless'

const FRAME_END = '\x1b[?2026l'
const FRAME_TIMEOUT_MS = 2_000

const ANSI_COLORS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
] as const

interface FrameWaiter {
  target: number
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface RowSnapshot {
  text: string
  wrapped: boolean
  styles: string[]
}

export interface TerminalSnapshotOptions {
  /** Include the whole active buffer instead of only the visible viewport. */
  includeScrollback?: boolean
}

function occurrenceCount(value: string, needle: string): number {
  let count = 0
  let offset = 0
  while (true) {
    const match = value.indexOf(needle, offset)
    if (match < 0) return count
    count += 1
    offset = match + needle.length
  }
}

function colorLabel(cell: IBufferCell, kind: 'fg' | 'bg'): string | undefined {
  const isDefault = kind === 'fg' ? cell.isFgDefault() : cell.isBgDefault()
  if (isDefault) return undefined
  const isRgb = kind === 'fg' ? cell.isFgRGB() : cell.isBgRGB()
  const value = kind === 'fg' ? cell.getFgColor() : cell.getBgColor()
  if (isRgb) return `${kind}=#${value.toString(16).padStart(6, '0')}`
  const name = ANSI_COLORS[value]
  return `${kind}=${name ?? `ansi-${value}`}`
}

function styleLabel(cell: IBufferCell): string {
  const labels = [
    colorLabel(cell, 'fg'),
    colorLabel(cell, 'bg'),
    cell.isBold() !== 0 ? 'bold' : undefined,
    cell.isDim() !== 0 ? 'dim' : undefined,
    cell.isItalic() !== 0 ? 'italic' : undefined,
    cell.isUnderline() !== 0 ? 'underline' : undefined,
    cell.isBlink() !== 0 ? 'blink' : undefined,
    cell.isInverse() !== 0 ? 'inverse' : undefined,
    cell.isInvisible() !== 0 ? 'invisible' : undefined,
    cell.isStrikethrough() !== 0 ? 'strike' : undefined,
    cell.isOverline() !== 0 ? 'overline' : undefined,
  ].filter((label): label is string => label !== undefined)
  return labels.join(' ')
}

function snapshotRow(terminal: XtermTerminal, row: number): RowSnapshot {
  const line = terminal.buffer.active.getLine(row)
  if (line === undefined) return { text: '', wrapped: false, styles: [] }
  const styles: string[] = []
  let activeStyle = ''
  let activeStart = 0
  for (let column = 0; column <= terminal.cols; column++) {
    const cell = column < terminal.cols ? line.getCell(column) : undefined
    const style = cell === undefined ? '' : styleLabel(cell)
    if (style === activeStyle) continue
    if (activeStyle !== '') styles.push(`${activeStart}-${column - 1} ${activeStyle}`)
    activeStyle = style
    activeStart = column
  }
  return {
    text: line.translateToString(true),
    wrapped: line.isWrapped,
    styles,
  }
}

function renderRows(rows: readonly RowSnapshot[], firstRow: number): string[] {
  const rendered: string[] = []
  let blankStart: number | undefined
  const flushBlanks = (end: number): void => {
    if (blankStart === undefined) return
    rendered.push(blankStart === end ? `${blankStart}| <blank>` : `${blankStart}-${end}| <blank>`)
    blankStart = undefined
  }
  for (let index = 0; index < rows.length; index++) {
    const absoluteRow = firstRow + index
    const row = rows[index] as RowSnapshot
    if (row.text === '' && row.styles.length === 0 && !row.wrapped) {
      blankStart ??= absoluteRow
      continue
    }
    flushBlanks(absoluteRow - 1)
    rendered.push(`${absoluteRow}${row.wrapped ? '~' : ''}| ${JSON.stringify(row.text)}`)
    for (const style of row.styles) rendered.push(`  style ${style}`)
  }
  flushBlanks(firstRow + rows.length - 1)
  return rendered
}

/**
 * Terminal emulator used by TUI snapshots. It consumes the same ANSI stream as
 * a real terminal and exposes completed synchronized frames as an awaitable boundary.
 */
export class HeadlessTerminal implements Terminal {
  readonly kittyProtocolActive = false
  readonly drainInput = (): Promise<void> => Promise.resolve()
  started = 0
  stopped = 0
  title = ''
  progress = false
  cursorVisible = true
  frames = 0
  private readonly emulator: XtermTerminal
  private onInput: (data: string) => void = () => {}
  private onResize: () => void = () => {}
  private pendingWrite: Promise<void> = Promise.resolve()
  private readonly frameWaiters = new Set<FrameWaiter>()

  constructor(columns = 80, rows = 24) {
    this.emulator = new XtermTerminal({
      cols: columns,
      rows,
      scrollback: 1_000,
      allowProposedApi: true,
      drawBoldTextInBrightColors: false,
      logLevel: 'off',
    })
  }

  get columns(): number {
    return this.emulator.cols
  }

  get rows(): number {
    return this.emulator.rows
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.started += 1
    this.onInput = onInput
    this.onResize = onResize
  }

  stop(): void {
    this.stopped += 1
  }

  write(data: string): void {
    const completedFrames = occurrenceCount(data, FRAME_END)
    this.pendingWrite = new Promise((resolve) => {
      this.emulator.write(data, () => {
        this.frames += completedFrames
        for (const waiter of this.frameWaiters) {
          if (this.frames < waiter.target) continue
          clearTimeout(waiter.timer)
          this.frameWaiters.delete(waiter)
          waiter.resolve()
        }
        resolve()
      })
    })
  }

  moveBy(lines: number): void {
    if (lines > 0) this.write(`\x1b[${lines}B`)
    if (lines < 0) this.write(`\x1b[${-lines}A`)
  }

  hideCursor(): void {
    this.cursorVisible = false
    this.write('\x1b[?25l')
  }

  showCursor(): void {
    this.cursorVisible = true
    this.write('\x1b[?25h')
  }

  clearLine(): void {
    this.write('\x1b[K')
  }

  clearFromCursor(): void {
    this.write('\x1b[J')
  }

  clearScreen(): void {
    this.write('\x1b[2J\x1b[H')
  }

  setTitle(title: string): void {
    this.title = title
    this.write(`\x1b]0;${title}\x07`)
  }

  setProgress(active: boolean): void {
    this.progress = active
  }

  send(data: string): void {
    this.onInput(data)
  }

  resize(columns: number, rows = this.rows): void {
    this.emulator.resize(columns, rows)
    this.onResize()
  }

  /** Wait until pi-tui completes a synchronized frame newer than `after`. */
  async waitForFrame(after = this.frames): Promise<void> {
    if (this.frames <= after) {
      await new Promise<void>((resolve, reject) => {
        const waiter: FrameWaiter = {
          target: after + 1,
          resolve,
          reject,
          timer: setTimeout(() => {
            this.frameWaiters.delete(waiter)
            reject(new Error(`TUI did not complete frame ${after + 1} within ${FRAME_TIMEOUT_MS}ms`))
          }, FRAME_TIMEOUT_MS),
        }
        this.frameWaiters.add(waiter)
      })
    }
    await this.flush()
  }

  /** Await every terminal write queued through the current task. */
  async flush(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = this.pendingWrite
      await pending
    } while (pending !== this.pendingWrite)
  }

  /**
   * Reject palette output that would become theme-specific in a user's terminal.
   * @returns One location per RGB, extended-palette, or explicit-background cell.
   */
  themeViolations(): string[] {
    const violations: string[] = []
    const buffer = this.emulator.buffer.active
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row)
      if (line === undefined) continue
      for (let column = 0; column < this.columns; column++) {
        const cell = line.getCell(column)
        if (cell === undefined) continue
        const reasons = [
          cell.isFgRGB() ? 'rgb-fg' : undefined,
          cell.isBgRGB() ? 'rgb-bg' : undefined,
          cell.isFgPalette() && cell.getFgColor() > 15 ? `extended-fg-${cell.getFgColor()}` : undefined,
          cell.isBgPalette() && cell.getBgColor() > 15 ? `extended-bg-${cell.getBgColor()}` : undefined,
          !cell.isBgDefault() ? 'explicit-bg' : undefined,
        ].filter((reason): reason is string => reason !== undefined)
        if (reasons.length > 0) violations.push(`${row}:${column} ${reasons.join(',')}`)
      }
    }
    return violations
  }

  /** Serialize terminal cells and metadata into a stable, reviewable expected output. */
  async snapshot(options: TerminalSnapshotOptions = {}): Promise<string> {
    await this.flush()
    const buffer = this.emulator.buffer.active
    const firstRow = options.includeScrollback === true ? 0 : buffer.viewportY
    const rowCount = options.includeScrollback === true ? buffer.length : this.rows
    const rows = Array.from({ length: rowCount }, (_, index) => snapshotRow(this.emulator, firstRow + index))
    const cursorBufferRow = buffer.baseY + buffer.cursorY
    const cursorViewportRow = cursorBufferRow - buffer.viewportY
    return [
      `terminal ${this.columns}x${this.rows} buffer=${buffer.type} length=${buffer.length} base=${buffer.baseY} viewport=${buffer.viewportY}`,
      `lifecycle started=${this.started} stopped=${this.stopped} progress=${this.progress ? 'active' : 'inactive'}`,
      `title ${JSON.stringify(this.title)}`,
      `cursor ${this.cursorVisible ? 'visible' : 'hidden'} column=${buffer.cursorX} viewportRow=${cursorViewportRow} bufferRow=${cursorBufferRow}`,
      options.includeScrollback === true ? 'buffer' : 'viewport',
      ...renderRows(rows, firstRow),
      '',
    ].join('\n')
  }

  async dispose(): Promise<void> {
    await this.flush()
    for (const waiter of this.frameWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('terminal disposed before the requested frame completed'))
    }
    this.frameWaiters.clear()
    this.emulator.dispose()
  }
}
