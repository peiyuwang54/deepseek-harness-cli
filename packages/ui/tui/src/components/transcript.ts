/**
 * pi-tui transcript components: the startup banner, user/assistant messages,
 * per-step timing footer, streaming assistant buffer, tool cards, and the todo
 * panel. Each is a pure function of its inputs and the active palette.
 * @module @deepseek-ai/dsh-tui/components/transcript
 */

import {
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type MarkdownTheme,
} from '@earendil-works/pi-tui'
import { diffLines as compareLines } from 'diff'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'
import type {
  TerminalCallView,
  ToolCallView,
  ToolDefinition,
  ToolResultView,
} from '@deepseek-ai/dsh-tools'
import type { FileDiff } from '@deepseek-ai/dsh-tools'
import { preview, renderUnknownXml } from './xml-tool-output.ts'
import { displayInlineText, displayText } from './text.ts'
import { brandText, gradientText, type Palette } from './theme.ts'
import { contentText, type ParsedArguments } from './content.ts'
import {
  formatCompletionTime,
  formatTimingTotals,
  type StepPosition,
  type StepTimingTracker,
} from '../chat/timing.ts'

/** Concatenate the text of every block of one type, separated by blank lines. */
function textBlocks(content: readonly ContentBlock[], type: 'text' | 'reasoning'): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: typeof type }> => block.type === type)
    .map(block => block.text)
    .join('\n\n')
}

/** Render a value as terminal-safe text: strings escaped, other values as pretty JSON. */
function pretty(value: unknown): string {
  if (typeof value === 'string') return displayText(value)
  // JSON.stringify is typed to return string but yields undefined for e.g. symbols.
  const serialized = JSON.stringify(value, null, 2) as string | undefined
  return displayText(serialized ?? String(value))
}

interface RenderedDiff {
  lines: string[]
  added: number
  removed: number
  approximate: boolean
}

/**
 * A side's content lines under the terminator rule the Web DiffBlock also
 * applies: empty text is zero lines, a trailing newline terminates the last
 * line, and an interior blank line survives.
 */
function diffContentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * A file diff whose unchanged context stays neutral and does not affect exact
 * change totals. Comparisons beyond the edit-distance budget fall back to
 * whole-side rendering so a model-authored pending edit cannot stall the TUI.
 */
function renderDiff(
  diff: FileDiff,
  maxDiffEditLength: number,
  palette: Palette,
  repeatedPath: boolean,
): RenderedDiff {
  // The card header never names a file, so a file's first hunk carries its path.
  // Later adjacent hunks use Web DiffBlock's gap marker instead of repeating it.
  const lines = [repeatedPath ? palette.dim('⋯') : palette.bold(displayText(diff.path))]
  let added = 0
  let removed = 0
  if (diff.oldText === null) {
    const newLines = diffContentLines(displayText(diff.newText))
    added = newLines.length
    for (const line of newLines) lines.push(palette.success(`+ ${line}`))
    return { lines, added, removed, approximate: false }
  }
  const changes = compareLines(diff.oldText, diff.newText, { maxEditLength: maxDiffEditLength })
  if (changes === undefined) {
    const oldLines = diffContentLines(displayText(diff.oldText))
    const newLines = diffContentLines(displayText(diff.newText))
    lines.push(palette.dim(`[exact line diff omitted: >${maxDiffEditLength} changed lines]`))
    removed = oldLines.length
    added = newLines.length
    for (const line of oldLines) lines.push(palette.error(`- ${line}`))
    for (const line of newLines) lines.push(palette.success(`+ ${line}`))
    return { lines, added, removed, approximate: true }
  }
  for (const change of changes) {
    const changedLines = diffContentLines(displayText(change.value))
    if (change.added) {
      added += changedLines.length
      for (const line of changedLines) lines.push(palette.success(`+ ${line}`))
    } else if (change.removed) {
      removed += changedLines.length
      for (const line of changedLines) lines.push(palette.error(`- ${line}`))
    } else {
      for (const line of changedLines) lines.push(palette.dim(`  ${line}`))
    }
  }
  return { lines, added, removed, approximate: false }
}

/**
 * A message's bold, underlined role header in the role color. The underline
 * bands each role without a background fill or per-line prefix, so it reads on
 * any theme and a body drag-select copies the message text verbatim.
 */
function messageHeader(label: string, color: (text: string) => string, palette: Palette): string {
  return palette.bold(palette.underline(color(displayText(label))))
}

/** One detached session row shown on the zero-state welcome dashboard. */
export interface WelcomeRecentSession {
  /** Session title, or its id when no title was recorded. */
  readonly title: string
  /** Compact workspace label. */
  readonly workspace: string
  /** Stable creation-date label. */
  readonly date: string
}

/** Live values rendered by the zero-state welcome dashboard. */
export interface WelcomeDashboardState {
  /** Whether the current session has not started its first turn. */
  readonly expanded: boolean
  /** Agent composition id. */
  readonly preset: string
  /** Selected provider/model route. */
  readonly model: string
  /** Effective sandbox/approval preset or approval policy. */
  readonly permission: string
  /** Newest detached sessions; `undefined` while loading, `null` when history is unavailable. */
  readonly recentSessions: readonly WelcomeRecentSession[] | null | undefined
}

/** Center one ANSI-decorated line inside `width` terminal columns. */
function centered(line: string, width: number): string {
  const clipped = truncateToWidth(line, Math.max(1, width), '')
  return `${' '.repeat(Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2)))}${clipped}`
}

/** Render one compact titled field used by the welcome status row. */
function welcomeField(label: string, value: string, width: number, palette: Palette): string[] {
  const innerWidth = Math.max(1, width - 4)
  const title = ` ${displayInline(label)} `
  const top = `╭${title}${'─'.repeat(Math.max(0, width - visibleWidth(title) - 2))}╮`
  const clipped = truncateToWidth(displayInline(value), innerWidth, '')
  return [
    palette.dim(top),
    `${palette.dim('│')} ${clipped}${' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${palette.dim('│')}`,
    palette.dim(`╰${'─'.repeat(Math.max(0, width - 2))}╯`),
  ]
}

/** Escape one trusted-as-data field without allowing line breaks into a dashboard row. */
function displayInline(value: string): string {
  return displayText(value).replaceAll('\n', ' ')
}

/**
 * Braille-cell raster of the first-party DeepSeek mark in
 * `website/public/favicon.svg`. Braille's 2x4 dot grid preserves the official
 * silhouette without depending on terminal-specific image protocols.
 */
const DEEPSEEK_MARK = [
  '     ⣀⣀⣀⣀⣤⡄  ⢠⡄',
  ' ⢀⣴⣾⣿⣿⣿⣿⣿⣿⣤⡀ ⢻⣿⣶⣠⣤⣶⡟',
  '⢀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡈⠻⣿⣿⡿⠟⠁',
  '⢸⣯  ⠉⠙⠻⣿⣿⣿⣯⡙⢿⣿⣾⣿⡇',
  '⢸⣿⡄    ⠈⠻⣿⣿⣧⣤⣿⣿⣿⠁',
  ' ⢻⣿⣄  ⢀⣀ ⠙⣿⣿⣿⣿⡿⠃',
  '  ⠙⢿⣷⣤⣤⣿⣷⣦⣈⣻⣿⣿⣦⡄',
  '    ⠉⠛⠻⠿⠿⠟⠛⠉',
] as const

/** Reduced official-mark raster for a terminal that cannot fit the full dashboard. */
const DEEPSEEK_MARK_COMPACT = [
  ' ⣀⣀⣠ ⣀ ⢀',
  '⣼⠿⢿⣿⡷⣼⡿⠋',
  '⠻⣄⢀⡙⢷⣿⠃',
  ' ⠈⠛⠛⠋⠉',
] as const

/**
 * Startup header. A fresh session gets a centered DeepSeek dashboard; after
 * its first turn starts, the same component contracts to the transcript title.
 */
export class HeaderComponent implements Component {
  /** Columns of the banner currently revealed; `undefined` renders it whole. */
  private revealWidth: number | undefined

  constructor(
    private readonly agent: Agent,
    private readonly subtitle: () => string | undefined,
    private readonly palette: Palette,
    private readonly gradient: boolean,
    private readonly dashboard?: () => WelcomeDashboardState,
    private readonly terminalRows?: () => number,
  ) {}

  /**
   * Clip the banner to `width` columns (the sweep reveal); `undefined` restores it.
   * @param width - Revealed banner width in columns, or `undefined` for the whole banner.
   */
  setRevealWidth(width: number | undefined): void {
    this.revealWidth = width
  }

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.dashboard?.()
    if (state?.expanded === true) return this.renderDashboard(width, state)
    return this.renderCompact(width)
  }

  private renderCompact(width: number): string[] {
    const usable = Math.max(1, width - 2)
    const name = this.gradient
      ? this.palette.bold(gradientText('DEEPSEEK'))
      : this.palette.bold(this.palette.accent('DEEPSEEK'))
    const title = `${name} ${this.palette.bold('HARNESS')}`
    const detail = displayText(this.agent.session.id)
    const subtitle = this.subtitle()
    const lines = [
      title,
      ...subtitle === undefined ? [] : [this.palette.dim(displayText(subtitle))],
      this.palette.dim(detail),
    ]
      .flatMap(line => wrapTextWithAnsi(line, usable))
      .map(line => ` ${truncateToWidth(line, usable, '')}`)
    if (this.revealWidth === undefined) return lines
    const revealed = this.revealWidth
    return lines.map(line => truncateToWidth(line, revealed, ''))
  }

  private renderDashboard(width: number, state: WelcomeDashboardState): string[] {
    const contentWidth = Math.max(1, Math.min(88, width - 2))
    const rows = this.terminalRows?.() ?? 36
    const spacious = contentWidth >= 72 && rows >= 32
    const brand = (value: string): string => this.gradient ? brandText(value) : this.palette.brand(value)
    const product = this.gradient
      ? this.palette.bold(gradientText('DEEPSEEK'))
      : this.palette.bold(this.palette.accent('DEEPSEEK'))
    const lines: string[] = []
    const mark = spacious ? DEEPSEEK_MARK : rows >= 20 ? DEEPSEEK_MARK_COMPACT : []
    for (const line of mark) lines.push(centered(brand(line), contentWidth))
    lines.push(centered(`${product} ${this.palette.bold('HARNESS')}`, contentWidth))
    const subtitle = this.subtitle()
    if (subtitle !== undefined) lines.push(centered(this.palette.dim(displayInline(subtitle)), contentWidth))
    lines.push('')

    const fields = [
      ['PRESET', state.preset],
      ['MODEL', state.model],
      ['PERMISSIONS', state.permission],
    ] as const
    if (contentWidth >= 66) {
      const gap = 2
      const baseWidth = Math.floor((contentWidth - gap * 2) / 3)
      const widths = [baseWidth, baseWidth, contentWidth - gap * 2 - baseWidth * 2]
      const cards = fields.map(([label, value], index) =>
        welcomeField(label, value, widths[index] as number, this.palette))
      for (let row = 0; row < 3; row += 1) {
        lines.push(cards.map(card => card[row] as string).join(' '.repeat(gap)))
      }
    } else {
      lines.push(centered(fields.map(([label, value]) =>
        `${this.palette.dim(`${label.toLowerCase()}:`)} ${displayInline(value)}`).join(this.palette.dim(' · ')), contentWidth))
    }

    if (spacious) {
      lines.push('')
      lines.push(this.palette.bold('Recent sessions'))
      const recents = state.recentSessions
      if (recents === undefined) {
        lines.push(this.palette.dim('  Loading session history…'))
      } else if (recents === null) {
        lines.push(this.palette.dim('  Session history is unavailable in this profile.'))
      } else if (recents.length === 0) {
        lines.push(this.palette.dim('  No previous sessions in this profile.'))
      } else {
        for (const recent of recents.slice(0, 3)) {
          const date = displayInline(recent.date)
          const workspace = displayInline(recent.workspace)
          const suffix = this.palette.dim(`${date} · ${workspace}`)
          const suffixWidth = visibleWidth(suffix)
          const titleWidth = Math.max(1, contentWidth - suffixWidth - 5)
          const title = truncateToWidth(displayInline(recent.title), titleWidth, '…')
          const gap = ' '.repeat(Math.max(1, contentWidth - 4 - visibleWidth(title) - suffixWidth))
          lines.push(`  ${this.palette.accent('•')} ${title}${gap}${suffix}`)
        }
      }
      lines.push(this.palette.dim('  /resume opens searchable session history'))
      lines.push('')
      lines.push(this.palette.bold('Quick actions'))
      lines.push(`  ${this.palette.accent('/model')} switch model    ${this.palette.accent('/workspace')} change workspace    ${this.palette.accent('/settings')} preferences`)
      lines.push(`  ${this.palette.accent('/resume')} recent sessions  ${this.palette.accent('/help')} commands and shortcuts  ${this.palette.accent('@')} attach a file`)
    } else {
      lines.push('')
      lines.push(centered(`${this.palette.accent('/model')} model  ${this.palette.accent('/resume')} sessions  ${this.palette.accent('/workspace')} workspace  ${this.palette.accent('/help')} help`, contentWidth))
    }
    lines.push('')
    lines.push(centered(this.palette.dim('Ready · Enter sends · Shift+Enter adds a line · Alt+M switches model'), contentWidth))
    lines.push(centered(this.palette.dim(displayInline(this.agent.session.id)), contentWidth))

    const margin = ' '.repeat(Math.max(0, Math.floor((width - contentWidth) / 2)))
    const rendered = lines.map(line => `${margin}${truncateToWidth(line, contentWidth, '')}`)
    if (this.revealWidth === undefined) return rendered
    return rendered.map(line => truncateToWidth(line, this.revealWidth as number, ''))
  }
}

/**
 * A user or steering prompt in the transcript. An underlined accent role header
 * plus blank-line spacing separate it from surrounding blocks; body lines carry
 * no prefix or indent, so a terminal drag-select copies the prompt verbatim.
 */
export class UserMessageComponent extends Container {
  constructor(text: string, palette: Palette, mdTheme: MarkdownTheme, label = 'You') {
    super()
    this.addChild(new Text(messageHeader(label, palette.accent, palette), 0, 0))
    this.addChild(new Markdown(displayText(text), 0, 0, mdTheme, { color: value => palette.text(value) }, {
      preserveOrderedListMarkers: true,
      preserveBackslashEscapes: true,
    }))
  }
}

/**
 * Children of a settled assistant message: optional reasoning block then the
 * response text. A folded continuation (a later step of a turn while tool cards
 * are hidden) drops the `Assistant` header and renders nothing when it has no
 * visible body, so tool-only steps leave no blank segment behind.
 */
function assistantMessageChildren(
  content: readonly ContentBlock[],
  showReasoning: boolean,
  foldedContinuation: boolean,
  palette: Palette,
  mdTheme: MarkdownTheme,
): Component[] {
  const reasoning = displayText(textBlocks(content, 'reasoning').trim())
  const text = displayText(textBlocks(content, 'text').trim())
  const showsReasoning = reasoning !== '' && showReasoning
  if (foldedContinuation && !showsReasoning && text === '') return []
  const children: Component[] = [new Spacer(1)]
  if (!foldedContinuation) {
    children.push(new Text(messageHeader('Assistant', palette.accent, palette), 0, 0))
  }
  if (showsReasoning) {
    children.push(
      new Text(palette.italic(palette.dim('Reasoning')), 0, 0),
      new Markdown(reasoning, 0, 0, mdTheme, { color: value => palette.dim(value), italic: true }),
    )
  }
  if (text) children.push(new Markdown(text, 0, 0, mdTheme, { color: value => palette.text(value) }))
  return children
}

/**
 * A step's timing summary, rendered as a self-refreshing footer that stays at
 * the tail of the step's output. Kept separate from the assistant message so
 * the timing line trails any tool cards the step appends after its message.
 */
class StepTimingComponent extends Container {
  private completionTime: number | undefined

  constructor(
    private readonly position: StepPosition,
    private readonly events: () => readonly SessionEvent[],
    private readonly tracker: StepTimingTracker,
    private readonly now: () => number,
    private readonly palette: Palette,
  ) {
    super()
    this.rebuild()
  }

  complete(time: number): void {
    this.completionTime = time
    this.rebuild()
  }

  override invalidate(): void {
    this.rebuild()
    super.invalidate()
  }

  private rebuild(): void {
    this.clear()
    const totals = this.tracker.totalsAt(this.events(), this.position, this.completionTime ?? this.now())
    const timing = formatTimingTotals(totals, true)
    const header = this.completionTime === undefined
      ? timing
      : `${timing} · Completed ${formatCompletionTime(this.completionTime)}`
    this.addChild(new Text(this.palette.dim(header), 0, 0))
  }
}

interface StreamingBlock {
  type: string
  text: string
}

/** A live assistant step: streamed reasoning/text blocks until the message settles. */
export class StreamingAssistantComponent extends Container {
  private readonly blocks = new Map<number, StreamingBlock>()
  private settledContent: readonly ContentBlock[] | undefined
  private foldedContinuation = false
  /**
   * The step's timing footer. The renderer keeps it at the tail of the chat so
   * it trails any tool cards the step appends after this assistant message; it
   * is not a child of this component.
   */
  readonly timing: StepTimingComponent

  constructor(
    /** The step's turn/step coordinates, used to group steps into their turn. */
    readonly position: StepPosition,
    events: () => readonly SessionEvent[],
    tracker: StepTimingTracker,
    now: () => number,
    private showReasoning: boolean,
    private readonly palette: Palette,
    private readonly mdTheme: MarkdownTheme,
  ) {
    super()
    this.timing = new StepTimingComponent(position, events, tracker, now, palette)
    this.rebuild()
  }

  /**
   * Replace the streamed blocks with the step's settled content.
   * @param content - The settled assistant content blocks.
   */
  settle(content: readonly ContentBlock[]): void {
    this.settledContent = content
    this.rebuild()
  }

  /**
   * Whether this step's assistant message has settled.
   * @returns `true` once {@link settle} has run.
   */
  isSettled(): boolean {
    return this.settledContent !== undefined
  }

  /**
   * Pin the step's timing footer to its completion time.
   * @param time - Step completion time in epoch milliseconds.
   */
  complete(time: number): void {
    this.timing.complete(time)
  }

  override invalidate(): void {
    this.rebuild()
    this.timing.invalidate()
    super.invalidate()
  }

  /**
   * Fold one streamed chunk into the live block buffer and re-render.
   * @param chunk - The streamed assistant chunk.
   */
  update(chunk: StreamChunk): void {
    if (chunk.type === 'block-start') {
      this.blocks.set(chunk.index, { type: chunk.blockType, text: '' })
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
      const block = this.blocks.get(chunk.index) ?? { type, text: '' }
      block.text += chunk.text
      this.blocks.set(chunk.index, block)
    } else if (chunk.type === 'block-end' && (chunk.block.type === 'text' || chunk.block.type === 'reasoning')) {
      this.blocks.set(chunk.index, { type: chunk.block.type, text: chunk.block.text })
    }
    this.rebuild()
    this.timing.invalidate()
  }

  /**
   * Toggle whether reasoning blocks render, then re-render.
   * @param show - Whether to show reasoning blocks.
   */
  setShowReasoning(show: boolean): void {
    this.showReasoning = show
    this.rebuild()
  }

  /**
   * Mark this step as a folded continuation of its turn: no `Assistant` header,
   * and no output at all while the step has no visible body. Used while tool
   * cards are hidden so a turn reads as one assistant message.
   * @param folded - Whether to render as a headerless continuation.
   */
  setFoldedContinuation(folded: boolean): void {
    if (this.foldedContinuation === folded) return
    this.foldedContinuation = folded
    this.rebuild()
  }

  /**
   * Whether the step currently renders visible reasoning or text.
   * @returns `true` when a header-owning render would show a body.
   */
  hasVisibleBody(): boolean {
    const content = this.presentedContent()
    return textBlocks(content, 'text').trim() !== ''
      || (this.showReasoning && textBlocks(content, 'reasoning').trim() !== '')
  }

  /** The settled content when available, otherwise the streamed blocks in model order. */
  private presentedContent(): readonly ContentBlock[] {
    return this.settledContent ?? [...this.blocks.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap<ContentBlock>(([, block]) => {
        if (block.type === 'text') return [{ type: 'text', text: block.text }]
        if (block.type === 'reasoning') return [{ type: 'reasoning', text: block.text }]
        return []
      })
  }

  private rebuild(): void {
    this.clear()
    const children = assistantMessageChildren(
      this.presentedContent(),
      this.showReasoning,
      this.foldedContinuation,
      this.palette,
      this.mdTheme,
    )
    for (const child of children) this.addChild(child)
  }
}

/**
 * A tool card's body split at the Markdown boundary. `prelude` rows are already
 * styled and render verbatim (a terminal `$` command, its cwd, a diff's hunks);
 * `lines` is the tool's own text. A generic card renders both as one Markdown
 * document under the dim body tone.
 */
interface CardBody {
  readonly prelude: readonly string[]
  readonly lines: readonly string[]
}

/**
 * Ctrl+O card-visibility cycle: `hidden` drops tool cards from the transcript,
 * `collapsed` previews the first body lines, `expanded` shows everything.
 */
export type ToolCardVisibility = 'hidden' | 'collapsed' | 'expanded'

/**
 * Transcript card with a width-keyed rendered-row cache. pi-tui re-renders
 * every component each frame and relies on per-component line caches (its own
 * `Text`/`Markdown` do this); a card that rebuilds rows inside `render(width)`
 * would re-wrap its output every frame
 * ([rationale](../../../../../.agents/notes/implemented/feature/2026-08-14-shipped-tui-cli-front-door.md)).
 * Subclasses render through {@link renderLines} and call {@link dropLines}
 * from every state mutator; with `invalidate()` (pi-tui's tree-wide cascade)
 * also dropping, a state change always re-renders.
 */
abstract class CachedCardComponent implements Component {
  private cached: { width: number; lines: string[] } | undefined

  /** Discard the cached rows so the next render recomputes them. */
  protected dropLines(): void {
    this.cached = undefined
  }

  invalidate(): void {
    this.cached = undefined
  }

  render(width: number): string[] {
    if (this.cached?.width !== width) this.cached = { width, lines: this.renderLines(width) }
    return this.cached.lines
  }

  /**
   * Render the card's rows for `width` without caching.
   * @param width - Render width the rows are wrapped to.
   * @returns The card's rows.
   */
  protected abstract renderLines(width: number): string[]
}

/** A tool call and its result, rendered as a collapsible status card. */
export class ToolCardComponent extends CachedCardComponent {
  private result: { content: ContentBlock[]; isError: boolean; meta?: JsonValue } | undefined
  private visibility: ToolCardVisibility = 'collapsed'
  private callView: ToolCallView
  private resultView: ToolResultView | undefined
  private diffBodyCache: { view: ToolCallView | ToolResultView; body: CardBody } | undefined

  constructor(
    private readonly name: string,
    private readonly parsed: ParsedArguments,
    private readonly definition: ToolDefinition | undefined,
    private readonly maxOutputLines: number,
    private readonly maxDiffEditLength: number,
    private readonly palette: Palette,
    private readonly mdTheme: MarkdownTheme,
  ) {
    super()
    this.callView = this.presentCall()
  }

  private presentCall(): ToolCallView {
    if (this.parsed.valid && this.definition?.presentCall) {
      try {
        const view = this.definition.presentCall(this.parsed.value)
        if (view !== undefined) return view
      } catch (error: unknown) {
        return { card: 'generic', title: displayText(this.name), rawInput: `Presenter failed: ${String(error)}` }
      }
    }
    return { card: 'generic', title: displayText(this.name), rawInput: this.parsed.value }
  }

  /**
   * Record the tool result and derive its result view.
   * @param event - The `tool/result` event payload.
   */
  updateResult(event: Extract<SessionEvent, { type: 'tool/result' }>['data']): void {
    this.diffBodyCache = undefined
    this.dropLines()
    const result = event.message.content[0]
    this.result = {
      content: [...result.content],
      isError: result.isError === true,
      ...event.meta !== undefined ? { meta: event.meta } : {},
    }
    if (this.parsed.valid && this.definition?.presentResult) {
      try {
        const view = this.definition.presentResult(this.parsed.value, this.result)
        if (view !== undefined) this.resultView = view
      } catch (error: unknown) {
        this.resultView = { card: 'generic', content: [{ type: 'text', text: `Presenter failed: ${String(error)}` }] }
      }
    }
  }

  /**
   * Set the card's visibility state.
   * @param visibility - Hidden, collapsed preview, or full body.
   */
  setVisibility(visibility: ToolCardVisibility): void {
    this.visibility = visibility
    this.dropLines()
  }

  protected renderLines(width: number): string[] {
    // Hidden renders nothing — not even the leading gap — so the transcript
    // keeps only the conversation, the way Codex hides tool calls.
    if (this.visibility === 'hidden') return []
    const isError = this.result?.isError ?? false
    // A ring marker: hollow while the call is pending, filled once it settles;
    // the header color (warning/success/error) tells pending from ok from error.
    const glyph = this.result === undefined ? '○' : '●'
    const rawBody = this.renderBody()
    const view = this.resultView ?? this.callView
    // A generic card's own content, a read card's `content` fallback (the
    // envelope-stripped file text — the TUI has no dedicated read rendering, so a
    // read renders exactly as before the read card existed), or a search/web
    // card's fallback to the raw result content (neither the `search` nor the
    // `web` view carries a `content` copy), all render as one dim Markdown block
    // below, so links/lists/headings keep the unified dim styling rather than
    // reading as bare text. A search card thus stays byte-identical to the
    // pre-search-card generic fallback. Terminal and diff cards own their body
    // styling, so they are excluded (mirrors renderBody's post-terminal/diff fallback).
    const markdownContent = view.card === 'generic' || view.card === 'read'
      ? view.content ?? this.result?.content
      : view.card === 'search'
        ? this.result?.content
        : view.card === 'web'
          // A web resultView is only assigned alongside this.result (the result
          // handler sets both) and the pending callView is never a web card, so
          // the optional-chain undefined side is unreachable here.
          /* v8 ignore next */
          ? this.result?.content
          : undefined
    const unknownXml = this.definition === undefined && markdownContent !== undefined
      ? renderUnknownXml(
        displayText(contentText(markdownContent)),
        this.maxOutputLines,
        this.visibility === 'expanded',
        displayText,
        text => this.palette.dim(text),
        text => this.palette.dim(text),
        /* v8 ignore next -- renderUnknownXml calls the collapsed summary only when hidden XML children exceed this card's limit. */
        count => this.palette.dim(`  … +${count} lines (Ctrl+O to expand)`),
      )
      : undefined
    // A generic card renders title and result as one Markdown document, so the
    // document's own block spacing is preserved, then dims every row — the whole
    // card body reads as one dim block under the status-colored header.
    const body = unknownXml ?? (markdownContent !== undefined && rawBody.lines.length > 0
      ? this.dimBody(rawBody, width)
      : [...rawBody.prelude, ...rawBody.lines])
    const visibleBody = unknownXml !== undefined || this.visibility === 'expanded'
      ? body
      : preview(body, this.maxOutputLines, count => this.palette.dim(`… +${count} lines (Ctrl+O to expand)`))
    // The header is a fixed `Tool / <name>` frame in the status color (warning
    // pending / success ok / error), flat — no bold or underline, so one color
    // reads consistently across the whole row. Every tool-specific detail (a
    // read's path, a diff, command output) lives in the body below; the sole
    // header extra is a bash card's model-authored description, appended as a
    // `/ <desc>` segment. The body stays unprefixed so a drag-select copies only
    // the tool text; body lines pass through Text so overlong output wraps.
    const statusColor = this.result === undefined
      ? this.palette.warning
      : isError ? this.palette.error : this.palette.success
    // The header is a single card row: collapse an embedded newline in the
    // description to an inline escape so it cannot break onto extra rows and
    // collide with the body lines that follow.
    const desc = this.headerDescription()
    const headerText = `${glyph} Tool / ${displayText(this.name)}${desc === undefined ? '' : ` / ${displayInlineText(desc)}`}`
    const header = truncateToWidth(headerText, Math.max(1, width - 2), '')
    // The blank first row is the card's own paragraph gap (no external Spacer),
    // so the hidden state removes the gap together with the card.
    const lines: string[] = ['', statusColor(header)]
    if (visibleBody.length > 0) lines.push(...new Text(visibleBody.join('\n'), 0, 0).render(width))
    return lines
  }

  /** The pending terminal call view, when this row is a terminal card. */
  private terminalPending(): TerminalCallView | undefined {
    return this.callView.card === 'terminal' ? this.callView : undefined
  }

  /**
   * The optional header `/ <desc>` segment: a bash (terminal) card's
   * model-authored description. Non-terminal tools contribute no header detail —
   * their presenter title moves into the body instead.
   */
  private headerDescription(): string | undefined {
    const description = this.terminalPending()?.description
    return description !== undefined && description !== '' ? description : undefined
  }

  /**
   * The presenter's title for a non-terminal card, shown as the first body line
   * (a read's `Read src/foo.ts`, a diff's `Edit files`) now that the header is a
   * fixed `Tool / <name>` frame. The result-state title replaces the pending one.
   */
  private bodyTitle(): string {
    return this.resultView?.title ?? this.callView.title
  }

  private renderBody(): CardBody {
    const view = this.resultView ?? this.callView
    if (view.card === 'terminal') {
      const pending = this.terminalPending()
      const prelude: string[] = []
      const lines: string[] = []
      // The command shows as a $-line here whenever it is not the header: either a
      // description headlines the row (the command still belongs somewhere) or the row
      // is a pending undescribed call (the classic running-command echo). A completed
      // undescribed row keeps the command only in the header.
      // The command and cwd are each a single card row, so escape a multi-line
      // command inline (displayInlineText) — a real newline would break onto extra
      // rows and collide with the output below.
      const headlined = pending?.description !== undefined && pending.description !== ''
      const commandInBody = pending !== undefined && (headlined || this.result === undefined)
      if (commandInBody) prelude.push(this.palette.dim(`$ ${displayInlineText(pending.title)}`))
      if (pending?.cwd) prelude.push(this.palette.dim(displayInlineText(pending.cwd)))
      if (this.resultView?.card === 'terminal') {
        if (this.resultView.output) lines.push(...this.dimOutput(this.resultView.output))
        if (this.resultView.exitCode !== undefined) lines.push(this.palette.dim(`[exit ${this.resultView.exitCode}]`))
        if (this.resultView.signal !== undefined) {
          lines.push(this.palette.error(`[signal ${displayText(this.resultView.signal)}]`))
        }
      } else if (this.result !== undefined) {
        lines.push(...this.dimOutput(contentText(this.result.content)))
      }
      return { prelude: prelude.filter(Boolean), lines: lines.filter(Boolean) }
    }
    if (view.card === 'diff') {
      if (this.diffBodyCache?.view === view) return this.diffBodyCache.body
      // The header never names a file, so each file's first hunk carries its path
      // and adjacent hunks use a gap marker. A trailing footer summarizes the
      // exact changed rows when the bounded comparison succeeds.
      const renderedDiffs = view.diffs.map((diff, index) => renderDiff(
        diff,
        this.maxDiffEditLength,
        this.palette,
        index > 0 && view.diffs[index - 1]?.path === diff.path,
      ))
      const added = renderedDiffs.reduce((total, rendered) => total + rendered.added, 0)
      const removed = renderedDiffs.reduce((total, rendered) => total + rendered.removed, 0)
      const approximate = renderedDiffs.some(rendered => rendered.approximate)
      const hunks = renderedDiffs.flatMap((rendered, index) => {
        return [...index > 0 ? [''] : [], ...rendered.lines]
      })
      const files = new Set(view.diffs.map(diff => diff.path)).size
      const footer = this.palette.dim(
        `└ +${added} -${removed} · ${files} file${files === 1 ? '' : 's'}${approximate ? ' · approximate' : ''}`,
      )
      // A diff's own `+`/`-` colors carry its meaning, so it renders verbatim
      // rather than under the dim result-output color.
      const body = { prelude: [...hunks, footer], lines: [] }
      this.diffBodyCache = { view, body }
      return body
    }
    // A generic or read card carries its own envelope-stripped `content`; a
    // search or web card carries no `content` copy and falls back to the raw
    // result content here. (Mirrors the `markdownContent` selection in render();
    // a read card has no dedicated TUI rendering, so its `content` takes the same
    // body path, keeping read output as it was before the read card existed, and
    // a search card stays byte-identical to the pre-search-card fallback.)
    const content = (view.card === 'generic' || view.card === 'read' ? view.content : undefined) ?? this.result?.content
    const prelude: string[] = []
    const lines: string[] = []
    // The presenter title headlines the body now that the header is a fixed
    // `Tool / <name>` frame (a terminal card keeps its command $-line instead).
    // Skip it when it only repeats the tool name (the fallback presenter for a
    // tool with no presentCall, or an unknown tool), which the header already shows.
    const bodyTitle = this.bodyTitle()
    if (bodyTitle !== displayText(this.name)) prelude.push(displayInlineText(bodyTitle))
    if (content !== undefined) lines.push(...displayText(contentText(content)).split('\n'))
    const rawInput = this.result === undefined && this.callView.card === 'generic'
      ? this.callView.rawInput
      : undefined
    if (rawInput !== undefined) lines.push(...pretty(rawInput).split('\n'))
    // Blank-line trimming spans the whole body, so the title counts as a row:
    // interior blanks (a result's own paragraph break) survive while the body's
    // leading and trailing ones are dropped.
    const total = prelude.length + lines.length
    return {
      prelude,
      lines: lines.filter((line, index) => {
        const row = prelude.length + index
        return line.length > 0 || (row > 0 && row < total - 1)
      }),
    }
  }

  /**
   * A tool's own output text as dim rows — the card's result-output color, which
   * separates what the tool produced from the card's own framing. A blank row
   * stays the empty string so the terminal branch's blank-row filter still reads
   * it as blank instead of as an ANSI-wrapped value.
   */
  private dimOutput(text: string): string[] {
    return displayText(text).split('\n').map(line => line === '' ? line : this.palette.dim(line))
  }

  /**
   * Render a generic card's prelude and result as one Markdown document under the
   * dim body tone. Rendering both together preserves the document's own block
   * spacing (Markdown's blank row before a heading); dimming every row keeps the
   * card body one uniform tone, so only the status-colored header carries color.
   */
  private dimBody(body: CardBody, width: number): string[] {
    const rows = new Markdown([...body.prelude, ...body.lines].join('\n'), 0, 0, this.mdTheme, {
      color: value => this.palette.text(value),
    }).render(width)
    // A whitespace-only row carries no output to dim; leaving it unwrapped keeps
    // Markdown's padding out of the styled ranges.
    return rows.map(row => row.trim() === '' ? row : this.palette.dim(row))
  }
}

/**
 * Matches a lone reminder-frame tag on its own line, capturing the element name.
 * Producers emit the frame as whole lines (`workspace-context`, `dsh-tool-skill`),
 * so anchoring the whole line keeps a tag mentioned inside prose from matching.
 */
const REMINDER_FRAME_LINE = /^<(\/?)([a-zA-Z][\w:.-]*)>$/u

/**
 * Drop a producer's outer reminder frame, keeping the instruction body verbatim.
 * The card header already names the source, so the frame lines carry nothing.
 * Only a matched open/close pair on the first and last lines is removed, so a
 * body that merely starts with a tag-like line is left intact.
 * @param text - Complete model-facing context text.
 * @returns The body without its outer frame lines, trimmed of the blank lines they leave.
 */
function stripReminderFrame(text: string): string {
  // A frame needs an open line and a distinct close line, so anything shorter than
  // two lines is already frameless.
  const [first = '', ...rest] = text.split('\n')
  const last = rest.at(-1)
  if (last === undefined) return text
  const open = REMINDER_FRAME_LINE.exec(first.trim())
  const close = REMINDER_FRAME_LINE.exec(last.trim())
  if (open?.[1] !== '' || close?.[1] !== '/' || open[2] !== close[2]) return text
  return rest.slice(0, -1).join('\n').replace(/^\n+|\n+$/gu, '')
}

/**
 * Injected context (plugin/goal source, e.g. `workspace-context`), rendered as a
 * collapsible dim card that shares the tool-card `Ctrl+O` toggle. The header is
 * `Context · <label>`; the body is the message text as dim prose, one tone with
 * the header and the fold marker, folded to `maxOutputLines`, with a surrounding
 * reminder frame stripped because the source label already names the context.
 *
 * Injected context is prose, not markup, so this card does not parse it. The
 * `<system-reminder>` frame is a prompting convention no model is trained on
 * ([envelope rationale](../../../../../.agents/notes/implemented/simplification/2026-07-20-unwrap-injected-content-envelopes.md)),
 * and instruction bodies legitimately contain a raw `&` or angle-bracket
 * placeholders (`packages/<group>/<pkg>/`, `-t <name>`) that are prose rather than
 * elements. Tree-rendering such a payload depended on whether it happened to be
 * well-formed XML, which made both the fold and the frame-line suppression
 * content-dependent.
 */
export class ContextCardComponent extends CachedCardComponent {
  private expanded = false

  constructor(
    private readonly label: string,
    private readonly text: string,
    private readonly maxOutputLines: number,
    private readonly palette: Palette,
  ) {
    super()
  }

  /**
   * Expand or collapse the card body.
   * @param expanded - Whether the full body is shown.
   */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.dropLines()
  }

  protected renderLines(width: number): string[] {
    const header = this.palette.dim(`Context · ${displayText(this.label)}`)
    // Emptiness is decided on the stripped text: styling a blank body would yield
    // one escape-only row, which reads as a stray blank line under the header.
    const stripped = stripReminderFrame(this.text)
    if (stripped === '') return [header]
    const body = stripped.split('\n')
      .map(line => line === '' ? line : this.palette.dim(displayText(line)))
    const visibleBody = this.expanded
      ? body
      : preview(body, this.maxOutputLines, count => this.palette.dim(`… +${count} lines (Ctrl+O to expand)`))
    return [header, ...new Text(visibleBody.join('\n'), 0, 0).render(width)]
  }
}

/** The plan/todo panel rendered above the prompt. */
export class TodoComponent implements Component {
  private todos: readonly TodoItem[] = []

  constructor(private readonly palette: Palette) {}

  /**
   * Replace the rendered plan items.
   * @param todos - The current todo items.
   */
  update(todos: readonly TodoItem[]): void {
    this.todos = todos
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.todos.length === 0) return []
    const lines: string[] = [this.palette.bold(this.palette.accent('Plan'))]
    for (const todo of this.todos) {
      const prefix = todo.status === 'completed'
        ? this.palette.success('✓')
        : todo.status === 'in_progress'
          ? this.palette.warning('●')
          : this.palette.dim('○')
      const content = displayText(todo.content)
      const text: string = todo.status === 'completed' ? this.palette.dim(content) : content
      lines.push(truncateToWidth(`  ${prefix} ${text}`, width, ''))
    }
    return ['', ...lines]
  }
}
