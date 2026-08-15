/**
 * pi-tui dialog and selector components for the terminal front door: the status
 * card, prompt-context line, model selector, resume picker, and user-question
 * dialog, plus the model-choice and resume-candidate data they present.
 * @module @deepseek-ai/dsh-tui/components/dialogs
 */

import {
  Input,
  Key,
  SelectList,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type SelectItem,
} from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import {
  type Agent,
  type ModelSelection,
} from '@deepseek-ai/dsh-agent'
import type { LlmModelInfo, LlmModelReasoningInfo, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { BRACKETED_PASTE_END, BRACKETED_PASTE_START, displayText, sanitizePastedText } from './text.ts'
import { dialogSelectTheme, type Palette } from './theme.ts'
import type { ToolCardVisibility } from './transcript.ts'
import {
  renderTuiPromptTemplate,
  type TuiPromptTemplateToken,
} from '../prompt.ts'

/** A selectable model advertised by a provider, with its display name, description, and reasoning metadata. */
export interface ModelChoice extends ModelSelection {
  modelName: string
  description?: string
  reasoning?: LlmModelReasoningInfo
}

/**
 * The provider/model route and selected reasoning effort resolved from a model dialog.
 */
export interface ModelDialogSelection {
  choice: ModelChoice
  reasoningEffort: ReasoningEffortId | undefined
}

/**
 * Format a provider/model target as its `provider/model` label.
 * @param target - The LLM target.
 * @returns The `provider/model` label.
 */
export function targetLabel(target: ModelSelection): string {
  return `${target.provider}/${target.model}`
}

/**
 * Format a target compactly as its model name with any selected reasoning effort appended.
 * @param target - The LLM target.
 * @returns The compact `model [effort]` label.
 */
export function compactTargetLabel(target: ModelSelection): string {
  return `${target.model}${target.reasoningEffort === undefined ? '' : ` ${target.reasoningEffort}`}`
}

/**
 * Resolve the display label for a choice's reasoning effort.
 * @param choice - The model choice carrying advertised reasoning metadata.
 * @param effort - The selected effort, or `undefined` for provider default.
 * @returns The effort's display name, `Default`, or `undefined` when the model has no reasoning metadata.
 */
export function targetReasoningLabel(choice: ModelChoice, effort: ReasoningEffortId | undefined): string | undefined {
  if (effort === undefined) return choice.reasoning === undefined ? undefined : 'Default'
  return choice.reasoning?.efforts.find(candidate => candidate.id === effort)?.name ?? effort
}

/**
 * Derive the agent's initial LLM target from its logged request header or options.
 * @param agent - The driven agent.
 * @returns The initial target, or `undefined` when unset.
 */
export function initialTarget(agent: Agent): ModelSelection | undefined {
  const logged = agent.session.requestHeader()?.config
  if (logged !== undefined) {
    if (logged.reasoningEffort === undefined) {
      return { provider: logged.provider, model: logged.model }
    }
    return { provider: logged.provider, model: logged.model, reasoningEffort: logged.reasoningEffort }
  }
  if (agent.options.provider === undefined || agent.options.model === undefined) return undefined
  return { provider: agent.options.provider, model: agent.options.model }
}

/**
 * List every advertised model across registered providers, appending the current
 * target when a provider does not advertise it.
 * @param ctx - Context supplying the LLM service.
 * @param current - The current target, appended when unadvertised.
 * @returns The model choices, flattened across providers.
 */
export async function readModelChoices(
  ctx: Context,
  current: ModelSelection | undefined,
): Promise<ModelChoice[]> {
  const providers = ctx.llm.listProviders()
  const groups = await Promise.all(providers.map(async (provider) => {
    const advertised = await ctx.llm.listModels(provider.id)
    const models: LlmModelInfo[] = [...advertised]
    if (
      current?.provider === provider.id
      && !models.some(model => model.id === current.model)
    ) {
      models.push({ provider: provider.id, id: current.model, name: current.model })
    }
    return Promise.all(models.map(async (model): Promise<ModelChoice> => {
      const reasoning = (await ctx.llm.resolveModelInfo(provider.id, model.id)).reasoning
      return {
        provider: provider.id,
        model: model.id,
        modelName: model.name,
        ...model.description === undefined ? {} : { description: model.description },
        ...reasoning === undefined ? {} : { reasoning },
      }
    }))
  }))
  return groups.flat()
}

/**
 * Format a diagnostic integer with grouping separators.
 * @param value - Integer to format.
 * @returns The grouped decimal string.
 */
export function formatDiagnosticNumber(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * Format a diagnostic timestamp as an ISO date-time in UTC.
 * @param value - Epoch milliseconds.
 * @returns The formatted UTC timestamp.
 */
export function formatDiagnosticTime(value: number): string {
  return new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/u, ' UTC')
}

/**
 * Format a pluralized count for a diagnostic row.
 * @param value - Count.
 * @param singular - Singular noun; an `s` is appended for other counts.
 * @returns The formatted count.
 */
export function formatDiagnosticCount(value: number, singular: string): string {
  return `${String(value)} ${singular}${value === 1 ? '' : 's'}`
}

/**
 * Render a fixed-width filled meter bar for a percentage.
 * @param percent - Percentage in [0, 100].
 * @param palette - Active role palette.
 * @returns The rendered meter.
 */
export function diagnosticMeter(percent: number, palette: Palette): string {
  const width = 16
  const filled = Math.round(Math.min(100, Math.max(0, percent)) / 100 * width)
  return `${palette.dim('[')}${palette.accent('█'.repeat(filled))}${palette.dim(`${'░'.repeat(width - filled)}]`)}`
}

/** One `label: value` row of a status card group. */
export type StatusCardRow = readonly [label: string, value: string]

/** Bordered, grouped field card for one point-in-time status snapshot. */
export class StatusCardComponent implements Component {
  constructor(
    private readonly groups: readonly (readonly StatusCardRow[])[],
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const labels = this.groups.flatMap(group => group.map(([label]) => `${label}:`))
    const naturalLabelWidth = Math.max(...labels.map(label => label.length))
    const naturalBodyWidth = Math.max(...this.groups.flatMap(group => group.map(([, value]) =>
      1 + naturalLabelWidth + 2 + visibleWidth(value))))
    const cardWidth = Math.min(
      Math.max(8, width),
      Math.max('Session status'.length + 5, naturalBodyWidth + 4),
    )
    const innerWidth = Math.max(1, cardWidth - 4)
    const labelWidth = Math.min(
      naturalLabelWidth,
      Math.max(1, Math.floor(innerWidth / 3)),
    )
    const body: string[] = []
    for (const [groupIndex, group] of this.groups.entries()) {
      if (groupIndex > 0) body.push('')
      for (const [label, value] of group) {
        const plainLabel = truncateToWidth(`${label}:`, labelWidth, '')
        const prefix = ` ${this.palette.dim(plainLabel.padEnd(labelWidth))}  `
        const continuation = ' '.repeat(1 + labelWidth + 2)
        const valueWidth = Math.max(1, innerWidth - visibleWidth(prefix))
        const wrapped = wrapTextWithAnsi(value, valueWidth)
        for (const [lineIndex, line] of wrapped.entries()) {
          body.push(`${lineIndex === 0 ? prefix : continuation}${line}`)
        }
      }
    }

    const title = truncateToWidth('Session status', Math.max(1, cardWidth - 5), '')
    const topTail = '─'.repeat(Math.max(0, cardWidth - visibleWidth(title) - 5))
    const top = `${this.palette.dim('╭─ ')}${this.palette.bold(this.palette.accent(title))}${this.palette.dim(` ${topTail}╮`)}`
    const lines = [top]
    for (const line of body) {
      const clipped = truncateToWidth(line, innerWidth, '')
      lines.push(`${this.palette.dim('│')} ${clipped}${' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${this.palette.dim('│')}`)
    }
    lines.push(this.palette.dim(`╰${'─'.repeat(Math.max(0, cardWidth - 2))}╯`))
    return lines
  }
}

/** The left/right template line rendered above the editor. */
export class PromptContextComponent implements Component {
  constructor(
    private readonly leftTemplate: readonly TuiPromptTemplateToken[],
    private readonly rightTemplate: readonly TuiPromptTemplateToken[],
    private readonly resolve: (name: string) => string | undefined,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const right = truncateToWidth(renderTuiPromptTemplate(this.rightTemplate, this.resolve), width, '')
    const rightWidth = visibleWidth(right)
    const leftCapacity = Math.max(0, width - rightWidth - (rightWidth === 0 ? 0 : 2))
    const left = truncateToWidth(renderTuiPromptTemplate(this.leftTemplate, this.resolve), leftCapacity, '')
    if (rightWidth === 0) return [left]
    const gap = ' '.repeat(Math.max(0, width - visibleWidth(left) - rightWidth))
    return [`${left}${gap}${right}`]
  }
}

/** A user's answer to one question: chosen option labels and an optional custom answer. */
export interface QuestionSelection {
  selected: string[]
  custom?: string
}

/**
 * Render a bordered dialog frame around body lines with a titled top edge.
 * @param title - Dialog title shown in the top border.
 * @param body - Body lines.
 * @param width - Dialog width in columns.
 * @param palette - Active role palette.
 * @returns The framed dialog lines.
 */
function renderDialog(
  title: string,
  body: readonly string[],
  width: number,
  palette: Palette,
): string[] {
  const innerWidth = Math.max(1, width - 4)
  const topLabel = ` ${displayText(title)} `
  const top = `╭${topLabel}${'─'.repeat(Math.max(0, width - visibleWidth(topLabel) - 2))}╮`
  const lines: string[] = [palette.accent(top)]
  for (const line of body) {
    const clipped = truncateToWidth(line, innerWidth, '')
    lines.push(`${palette.accent('│')} ${clipped}${' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${palette.accent('│')}`)
  }
  lines.push(palette.accent(`╰${'─'.repeat(Math.max(0, width - 2))}╯`))
  return lines
}

/** Keyboard model selector rendered as a bordered overlay, with a filter box and per-model reasoning-effort cycling. */
export class ModelDialog implements Component {
  private list: SelectList
  private readonly filter = new Input()
  private readonly items: Map<string, SelectItem>
  private readonly choices: Map<string, ModelChoice>
  private readonly efforts: Map<string, ReasoningEffortId | undefined>
  private readonly currentValue: string | undefined

  constructor(
    choices: readonly ModelChoice[],
    current: ModelSelection | undefined,
    private readonly maxVisible: number,
    private readonly palette: Palette,
    private readonly done: (selection: ModelDialogSelection) => void,
    private readonly cancel: () => void,
  ) {
    this.items = new Map()
    this.choices = new Map()
    this.efforts = new Map()
    this.currentValue = current === undefined ? undefined : targetLabel(current)
    for (const choice of choices) {
      const value = targetLabel(choice)
      const isCurrent = current?.provider === choice.provider && current.model === choice.model
      this.choices.set(value, choice)
      this.efforts.set(
        value,
        isCurrent
          ? current.reasoningEffort ?? choice.reasoning?.defaultEffort
          : choice.reasoning?.defaultEffort,
      )
      this.items.set(value, {
        value,
        label: displayText(value),
        description: this.describeChoice(choice, isCurrent),
      })
    }
    this.list = this.buildList(this.currentValue)
  }

  /** Build a SelectList over the currently filtered items, selecting `selectValue` when present. */
  private buildList(selectValue: string | undefined): SelectList {
    const items = this.filteredItems()
    const list = new SelectList(items, this.maxVisible, dialogSelectTheme(this.palette))
    const index = selectValue === undefined ? 0 : items.findIndex(item => item.value === selectValue)
    list.setSelectedIndex(Math.max(0, index))
    list.onSelect = (item) => { this.confirm(item) }
    list.onCancel = this.cancel
    return list
  }

  /** Items matching the filter box, as a case-insensitive substring over the label, model name, and description. */
  private filteredItems(): SelectItem[] {
    const query = this.filter.getValue().trim().toLocaleLowerCase()
    if (query === '') return [...this.items.values()]
    return [...this.items.values()].filter((item) => {
      const choice = this.choices.get(item.value)
      /* v8 ignore next -- items and choices share the same keys. */
      if (choice === undefined) return false
      return [item.value, choice.modelName, choice.description ?? '']
        .some(field => field.toLocaleLowerCase().includes(query))
    })
  }

  private confirm(item: SelectItem): void {
    const selected = this.choices.get(item.value)
    /* v8 ignore next -- SelectList only returns values built from `choices`. */
    if (selected === undefined) return
    this.done({ choice: selected, reasoningEffort: this.efforts.get(item.value) })
  }

  private describeChoice(choice: ModelChoice, isCurrent: boolean): string {
    const effortLabel = targetReasoningLabel(choice, this.efforts.get(targetLabel(choice)))
    return [
      displayText(choice.modelName),
      ...choice.description === undefined ? [] : [displayText(choice.description)],
      ...effortLabel === undefined ? [] : [displayText(effortLabel)],
      ...isCurrent ? ['current'] : [],
    ].join(' — ')
  }

  /** Ordered selectable efforts for one model, including provider default when it is a real choice. */
  private reasoningEfforts(choice: ModelChoice): Array<ReasoningEffortId | undefined> {
    if (choice.reasoning === undefined) return []
    return [
      ...choice.reasoning.defaultEffort === undefined ? [undefined] : [],
      ...choice.reasoning.efforts.map(effort => effort.id),
    ]
  }

  /** Cycle the selected model's effort in either direction. */
  private cycleReasoningEffort(direction = 1): void {
    const selectedItem = this.list.getSelectedItem()
    /* v8 ignore next -- the dialog is opened only for a non-empty catalog. */
    if (selectedItem === null) return
    const choice = this.choices.get(selectedItem.value)
    if (choice?.reasoning === undefined) return
    const current = this.efforts.get(selectedItem.value)
    const efforts = this.reasoningEfforts(choice)
    if (efforts.length === 0) return
    const currentIndex = efforts.indexOf(current)
    const baseIndex = currentIndex < 0 ? 0 : currentIndex
    const next = efforts[(baseIndex + direction + efforts.length) % efforts.length]
    this.efforts.set(selectedItem.value, next)
    const item = this.items.get(selectedItem.value)
    /* v8 ignore next -- items and choices are constructed from the same values. */
    if (item === undefined) return
    item.description = this.describeChoice(choice, selectedItem.value === this.currentValue)
  }

  /** Render every selectable effort for the highlighted model instead of hiding it behind a shortcut. */
  private renderReasoningEfforts(width: number): string {
    const selectedItem = this.list.getSelectedItem()
    if (selectedItem === null) {
      return this.palette.dim(truncateToWidth('Reasoning effort  Not available', width, ''))
    }
    const choice = this.choices.get(selectedItem.value)
    if (choice?.reasoning === undefined) {
      return this.palette.dim(truncateToWidth('Reasoning effort  Not available', width, ''))
    }
    const current = this.efforts.get(selectedItem.value)
    const choices = this.reasoningEfforts(choice).map((effort) => {
      const label = targetReasoningLabel(choice, effort) ?? 'Default'
      return effort === current
        ? this.palette.bold(this.palette.accent(`[${displayText(label)}]`))
        : this.palette.dim(displayText(label))
    })
    return truncateToWidth(`Reasoning effort  ${choices.join('  ')}`, width, '')
  }

  invalidate(): void {
    this.filter.invalidate()
    this.list.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.shift(Key.tab))) {
      this.cycleReasoningEffort(-1)
    } else if (matchesKey(data, Key.tab)) {
      this.cycleReasoningEffort()
    } else if (this.filter.getValue() === '' && matchesKey(data, Key.left)) {
      this.cycleReasoningEffort(-1)
    } else if (this.filter.getValue() === '' && matchesKey(data, Key.right)) {
      this.cycleReasoningEffort()
    } else if (matchesKey(data, Key.escape)) {
      if (this.filter.getValue() === '') this.cancel()
      else {
        this.filter.setValue('')
        this.list = this.buildList(undefined)
      }
    } else if (
      matchesKey(data, Key.up)
      || matchesKey(data, Key.down)
      || matchesKey(data, Key.enter)
    ) {
      this.list.handleInput(data)
    } else {
      const previous = this.filter.getValue()
      this.filter.focused = true
      this.filter.handleInput(data)
      if (this.filter.getValue() !== previous) {
        const selected = this.list.getSelectedItem()
        this.list = this.buildList(selected?.value)
      }
    }
    this.invalidate()
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 4)
    this.filter.focused = true
    const results = this.filteredItems()
    const filterContent = truncateToWidth(this.filter.render(innerWidth).join(''), innerWidth, '')
    return renderDialog('Select model', [
      filterContent,
      '',
      ...results.length === 0
        ? [this.palette.dim('  No models match the filter')]
        : this.list.render(innerWidth),
      '',
      this.renderReasoningEfforts(innerWidth),
      this.palette.dim('type to filter • ↑/↓ model • Tab/←/→ effort • Enter select • Esc'),
    ], width, this.palette)
  }
}

/** Both transcript-detail dimensions, applied immediately on each Tab. */
export interface DetailsSelection {
  readonly visibility: ToolCardVisibility
  readonly showReasoning: boolean
}

const TOOL_CARD_PHASES: readonly ToolCardVisibility[] = ['collapsed', 'expanded', 'hidden']

/**
 * Keyboard toggle over the two transcript-detail entries — tool-card
 * visibility and reasoning display. Tab cycles the highlighted entry's value
 * and applies it immediately, so the transcript behind the dialog is the live
 * preview; Enter, Esc, or Ctrl+C closes.
 */
export class DetailsDialog implements Component {
  private readonly list: SelectList
  private readonly toolsItem: SelectItem
  private readonly reasoningItem: SelectItem

  constructor(
    private visibility: ToolCardVisibility,
    private showReasoning: boolean,
    private readonly palette: Palette,
    private readonly apply: (selection: DetailsSelection) => void,
    private readonly close: () => void,
  ) {
    this.toolsItem = { value: 'tools', label: 'Tool cards', description: visibility }
    this.reasoningItem = { value: 'reasoning', label: 'Reasoning', description: this.reasoningLabel() }
    this.list = new SelectList([this.toolsItem, this.reasoningItem], 2, dialogSelectTheme(palette))
    this.list.onSelect = close
  }

  private reasoningLabel(): string {
    return this.showReasoning ? 'shown' : 'hidden'
  }

  /** Cycle the highlighted entry one step and apply the new state. */
  private cycle(): void {
    const selected = this.list.getSelectedItem()
    /* v8 ignore next -- the two-entry list always has a selection. */
    if (selected === null) return
    if (selected.value === 'tools') {
      const index = TOOL_CARD_PHASES.indexOf(this.visibility)
      this.visibility = TOOL_CARD_PHASES[(index + 1) % TOOL_CARD_PHASES.length] as ToolCardVisibility
      this.toolsItem.description = this.visibility
    } else {
      this.showReasoning = !this.showReasoning
      this.reasoningItem.description = this.reasoningLabel()
    }
    this.apply({ visibility: this.visibility, showReasoning: this.showReasoning })
  }

  invalidate(): void {
    this.list.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) this.close()
    else if (matchesKey(data, Key.tab)) this.cycle()
    else this.list.handleInput(data)
    this.invalidate()
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 4)
    return renderDialog('Transcript details', [
      ...this.list.render(innerWidth),
      '',
      this.palette.dim('↑/↓ move • Tab toggle • Enter/Esc close'),
    ], width, this.palette)
  }
}

/** One permission preset rendered by {@link PermissionDialog}. */
export interface PermissionDialogChoice {
  /** Stable preset key submitted to the command service. */
  readonly value: string
  /** User-facing preset name. */
  readonly label: string
  /** Concise capability summary. */
  readonly description?: string
}

/** One row rendered by the reusable command action selector. */
export interface ActionDialogChoice {
  /** Stable value returned on selection. */
  readonly value: string
  /** User-facing action label. */
  readonly label: string
  /** Optional concise status or explanation. */
  readonly description?: string
}

/** Copy and callbacks for a masked API-key entry dialog. */
export interface CredentialDialogOptions {
  /** Dialog title. */
  readonly title: string
  /** Short explanation shown above the input. */
  readonly detail: string
  /** Hint shown while the dialog is accepting input. */
  readonly inputHint: string
  /** Hint shown while the credential provider commits the value. */
  readonly savingHint: string
  /** Validate and persist the raw value; an error string keeps the dialog open. */
  readonly submit: (value: string) => Promise<string | undefined>
  /** Close without storing a value. */
  readonly cancel: () => void
  /** Request a frame after asynchronous state changes. */
  readonly requestRender: () => void
}

/**
 * Masked single-line credential editor. The raw value stays inside pi-tui's
 * input buffer and is never returned by {@link render}.
 */
export class CredentialDialog implements Component, Focusable {
  private readonly input = new Input()
  private error = ''
  private saving = false
  focused = false

  constructor(
    private readonly options: CredentialDialogOptions,
    private readonly palette: Palette,
  ) {
    this.input.onSubmit = (value) => { void this.submit(value) }
    this.input.onEscape = () => {
      if (!this.saving) this.options.cancel()
    }
  }

  invalidate(): void {
    this.input.invalidate()
  }

  handleInput(data: string): void {
    if (this.saving) return
    this.input.focused = this.focused
    this.input.handleInput(data)
    this.invalidate()
  }

  private async submit(value: string): Promise<void> {
    if (this.saving) return
    this.saving = true
    this.error = ''
    this.options.requestRender()
    const error = await this.options.submit(value)
    if (error === undefined) {
      this.input.setValue('')
      return
    }
    this.saving = false
    this.error = error
    this.options.requestRender()
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 4)
    const valueLength = this.input.getValue().length
    const available = Math.max(1, innerWidth - 3)
    const hidden = valueLength > available
      ? `…${'•'.repeat(Math.max(0, available - 1))}`
      : '•'.repeat(valueLength)
    const cursor = this.focused && !this.saving ? '\x1b[7m \x1b[27m' : ' '
    const maskedInput = truncateToWidth(`› ${hidden}${cursor}`, innerWidth, '')
    const body = [
      ...wrapTextWithAnsi(this.palette.text(displayText(this.options.detail)), innerWidth),
      '',
      maskedInput,
      this.palette.dim(this.saving ? this.options.savingHint : this.options.inputHint),
      ...this.error === '' ? [] : [this.palette.error(displayText(this.error))],
    ]
    return renderDialog(this.options.title, body, width, this.palette)
  }
}

/** Small searchable-free action selector shared by slash-command hubs. */
export class ActionDialog implements Component {
  private readonly list: SelectList

  constructor(
    private readonly title: string,
    choices: readonly ActionDialogChoice[],
    maxVisible: number,
    private readonly palette: Palette,
    done: (value: string) => void,
    private readonly cancel: () => void,
    initialValue?: string,
    private readonly instructions = '↑/↓ move • Enter select • Esc close',
    private readonly separateInstructions = true,
  ) {
    const items: SelectItem[] = choices.map(choice => ({
      value: choice.value,
      label: displayText(choice.label),
      ...choice.description === undefined ? {} : { description: displayText(choice.description) },
    }))
    this.list = new SelectList(items, Math.max(1, Math.min(maxVisible, items.length)), dialogSelectTheme(palette))
    const selected = initialValue === undefined ? -1 : items.findIndex(item => item.value === initialValue)
    if (selected >= 0) this.list.setSelectedIndex(selected)
    this.list.onSelect = (item) => { done(item.value) }
    this.list.onCancel = cancel
  }

  invalidate(): void {
    this.list.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.cancel()
      this.invalidate()
      return
    }
    this.list.handleInput(data)
    this.invalidate()
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 4)
    return renderDialog(this.title, [
      ...this.list.render(innerWidth),
      ...this.separateInstructions ? [''] : [],
      this.palette.dim(this.instructions),
    ], width, this.palette)
  }
}

/** Keyboard permission-preset selector rendered as a bordered overlay. */
export class PermissionDialog extends ActionDialog {
  constructor(
    choices: readonly PermissionDialogChoice[],
    currentValue: string,
    palette: Palette,
    done: (value: string) => void,
    cancel: () => void,
  ) {
    super(
      'Update Permissions',
      choices.map(choice => ({
        value: choice.value,
        label: choice.label,
        description: [
          ...choice.value === currentValue ? ['current'] : [],
          ...choice.description === undefined ? [] : [choice.description],
        ].join(' · '),
      })),
      choices.length,
      palette,
      done,
      cancel,
      currentValue,
      '↑/↓ move • Enter confirm • Esc close',
    )
  }
}

/** A resume selector row summarizing one session from metadata and its folded title. */
export interface ResumeCandidate {
  record: SessionRecord
  title: string
  /** Last observed change: live last-event time or artifact mtime, falling back to creation. */
  lastActivityAt: number
  /** Whether the session's workspace is the one the current session runs in, which selects the picker scope that lists it. */
  currentWorkspace: boolean
  /** The session's own workspace as a prompt-style label; the all-workspaces scope shows it per row. */
  workspaceLabel: string
  disabledReason?: string
}

/**
 * Build one resume selector row from a record, its batch-folded title, and a
 * metadata-derived activity time, deriving the workspace scope and any reason
 * the session cannot be resumed here. A workspace other than the current one
 * is a scope, not a disabled reason: resuming it hands the process off into
 * that directory. Rows carry no per-log detail beyond the title — route and
 * replay validity are checked by the Enter-time preflight against the one
 * chosen log.
 * @param record - The session record.
 * @param title - The session's batch-folded title, absent for an untitled log.
 * @param lastActivityAt - Metadata activity time; absent falls back to the header's creation time.
 * @param currentId - The current session id.
 * @param cwd - The CURRENT session's workspace, which decides the picker scope this row falls in.
 * @param formatWorkspace - Renders THIS record's own cwd as its prompt-style label.
 * @returns The summarized resume candidate.
 */
export function summarizeResumeCandidate(
  record: SessionRecord,
  title: string | undefined,
  lastActivityAt: number | undefined,
  currentId: SessionId,
  cwd: string | undefined,
  formatWorkspace: (cwd: string | undefined) => string,
): ResumeCandidate {
  let disabledReason: string | undefined
  if (record.header.id === currentId) disabledReason = 'current session'
  else if (record.live) disabledReason = 'session is already live in this runtime'
  else if (record.header.cwd === undefined) disabledReason = 'session has no recorded workspace'
  return {
    record,
    title: title ?? 'Untitled session',
    lastActivityAt: lastActivityAt ?? record.header.createdAt,
    currentWorkspace: record.header.cwd === cwd,
    workspaceLabel: formatWorkspace(record.header.cwd),
    ...disabledReason === undefined ? {} : { disabledReason },
  }
}

/** Which workspaces the resume picker currently lists. */
export type ResumeScope = 'workspace' | 'all'

/**
 * Full-viewport keyboard selector over detached, preflighted resume summaries.
 *
 * Two scopes over one candidate set: `workspace` (the default) lists only the
 * current session's workspace, `all` lists every workspace and labels each row
 * with its own. Tab toggles between them; the search query and selection reset
 * on a scope change so the highlighted row always belongs to the visible list.
 *
 * The picker opens before the session scan settles: an `undefined` candidate
 * set renders a loading placeholder that keeps input away from the editor,
 * and `setCandidates` swaps the scanned rows in without replacing the overlay.
 */
export class ResumePicker implements Component, Focusable {
  private readonly search = new Input()
  private pasteBuffer: string | undefined
  private selectedIndex = 0
  private error = ''
  private scope: ResumeScope = 'workspace'
  private candidates: readonly ResumeCandidate[] | undefined
  focused = false

  constructor(
    candidates: readonly ResumeCandidate[] | undefined,
    private readonly maxVisible: number,
    private readonly workspaceLabel: string,
    private readonly viewportRows: () => number,
    private readonly palette: Palette,
    private readonly done: (candidate: ResumeCandidate) => void,
    private readonly cancel: () => void,
  ) {
    this.candidates = candidates
  }

  invalidate(): void {
    this.search.invalidate()
  }

  /**
   * Replace the loading placeholder with the scanned candidate set.
   * @param candidates - the summarized rows the finished scan produced.
   */
  setCandidates(candidates: readonly ResumeCandidate[]): void {
    this.candidates = candidates
    this.selectedIndex = 0
    // A still-loading error is false the moment rows exist.
    this.error = ''
    this.invalidate()
  }

  /** Candidates in the active scope, before the search query narrows them. */
  private scoped(): ResumeCandidate[] {
    const candidates = this.candidates ?? []
    return this.scope === 'all'
      ? [...candidates]
      : candidates.filter(candidate => candidate.currentWorkspace)
  }

  private filtered(): ResumeCandidate[] {
    const query = this.search.getValue().trim().toLocaleLowerCase()
    const scoped = this.scoped()
    if (query === '') return scoped
    // The workspace label only distinguishes rows once it is on screen, so it
    // joins the searchable text exactly in the scope that shows it.
    return scoped.filter(candidate => candidate.title.toLocaleLowerCase().includes(query)
      || candidate.record.header.id.toLocaleLowerCase().includes(query)
      || (this.scope === 'all' && candidate.workspaceLabel.toLocaleLowerCase().includes(query)))
  }

  private visibleCandidateCount(): number {
    // The all-workspaces scope adds a per-row workspace line, so a row costs
    // one more terminal row there than in the single-workspace scope.
    const rowHeight = this.scope === 'all' ? 4 : 3
    const candidateBudget = Math.max(1, Math.floor((Math.max(1, this.viewportRows()) - 13) / rowHeight))
    return Math.min(this.maxVisible, candidateBudget)
  }

  private handleBracketedPaste(data: string): boolean {
    const start = data.indexOf(BRACKETED_PASTE_START)
    if (this.pasteBuffer === undefined && start < 0) return false
    if (this.pasteBuffer === undefined) {
      const prefix = data.slice(0, start)
      if (prefix !== '') this.handleInput(prefix)
      this.pasteBuffer = data.slice(start + BRACKETED_PASTE_START.length)
    } else {
      this.pasteBuffer += data
    }
    const end = this.pasteBuffer.indexOf(BRACKETED_PASTE_END)
    if (end < 0) return true
    const pasted = sanitizePastedText(this.pasteBuffer.slice(0, end))
    const remaining = this.pasteBuffer.slice(end + BRACKETED_PASTE_END.length)
    this.pasteBuffer = undefined
    const previous = this.search.getValue()
    this.search.handleInput(`${BRACKETED_PASTE_START}${pasted}${BRACKETED_PASTE_END}`)
    if (this.search.getValue() !== previous) {
      this.selectedIndex = 0
      this.error = ''
    }
    if (remaining !== '') this.handleInput(remaining)
    this.invalidate()
    return true
  }

  handleInput(data: string): void {
    if (this.handleBracketedPaste(data)) return
    const filtered = this.filtered()
    if (matchesKey(data, Key.ctrl('c'))) {
      this.cancel()
      return
    }
    if (matchesKey(data, Key.escape)) {
      if (this.search.getValue() === '') this.cancel()
      else {
        this.search.setValue('')
        this.selectedIndex = 0
        this.error = ''
      }
    } else if (matchesKey(data, Key.up)) {
      this.selectedIndex = filtered.length === 0
        ? 0
        : (this.selectedIndex + filtered.length - 1) % filtered.length
    } else if (matchesKey(data, Key.down)) {
      this.selectedIndex = filtered.length === 0 ? 0 : (this.selectedIndex + 1) % filtered.length
    } else if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.visibleCandidateCount())
    } else if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(
        Math.max(0, filtered.length - 1),
        this.selectedIndex + this.visibleCandidateCount(),
      )
    } else if (matchesKey(data, Key.tab)) {
      this.scope = this.scope === 'workspace' ? 'all' : 'workspace'
      this.search.setValue('')
      this.selectedIndex = 0
      this.error = ''
    } else if (matchesKey(data, Key.enter)) {
      const selected = filtered[this.selectedIndex]
      if (this.candidates === undefined) this.error = 'Sessions are still loading.'
      else if (selected === undefined) this.error = 'No session matches this search.'
      else if (selected.disabledReason !== undefined) this.error = selected.disabledReason
      else this.done(selected)
    } else {
      const previous = this.search.getValue()
      this.search.focused = this.focused
      this.search.handleInput(data)
      if (this.search.getValue() !== previous) {
        this.selectedIndex = 0
        this.error = ''
      }
    }
    this.invalidate()
  }

  /**
   * The scope line under the search box: the active scope with the current
   * workspace it means, and the inactive scope with the count Tab would reveal.
   */
  private renderScopeLine(): string {
    const candidates = this.candidates ?? []
    const inWorkspace = candidates.filter(candidate => candidate.currentWorkspace).length
    const active = this.scope === 'workspace'
      ? `this workspace ${displayText(this.workspaceLabel)}`
      : `all workspaces (${candidates.length})`
    const other = this.scope === 'workspace'
      ? `all workspaces (${candidates.length})`
      : `this workspace (${inWorkspace})`
    return `${this.palette.accent(active)}${this.palette.dim(`  ⇥ ${other}`)}`
  }

  render(width: number): string[] {
    this.search.focused = this.focused
    const height = Math.max(1, this.viewportRows())
    const horizontalPadding = width >= 12 ? 2 : 0
    const contentWidth = Math.max(1, width - horizontalPadding * 2)
    const indent = ' '.repeat(horizontalPadding)
    const filtered = this.filtered()
    if (this.selectedIndex >= filtered.length) this.selectedIndex = Math.max(0, filtered.length - 1)
    const selected = filtered[this.selectedIndex]
    const position = selected === undefined ? 0 : this.selectedIndex + 1
    const title = this.candidates === undefined
      ? 'Resume session'
      : `Resume session (${position} of ${filtered.length})`
    const lines: string[] = [
      '',
      `${indent}${this.palette.bold(this.palette.accent(title))}`,
      '',
    ]

    const searchInnerWidth = Math.max(1, contentWidth - 4)
    lines.push(`${indent}${this.palette.dim(`╭${'─'.repeat(Math.max(0, contentWidth - 2))}╮`)}`)
    const searchContent = this.search.render(searchInnerWidth).join('').replace(/^> /u, '⌕ ')
    const clippedSearch = truncateToWidth(searchContent, searchInnerWidth, '')
    lines.push(
      `${indent}${this.palette.dim('│')} ${clippedSearch}${' '.repeat(Math.max(0, searchInnerWidth - visibleWidth(clippedSearch)))} ${this.palette.dim('│')}`,
      `${indent}${this.palette.dim(`╰${'─'.repeat(Math.max(0, contentWidth - 2))}╯`)}`,
      '',
      `${indent}${this.renderScopeLine()}`,
      '',
    )

    const visibleCount = this.visibleCandidateCount()
    const start = Math.max(0, Math.min(
      this.selectedIndex - Math.floor(visibleCount / 2),
      filtered.length - visibleCount,
    ))
    const end = Math.min(filtered.length, start + visibleCount)
    const push = (line: string): void => {
      lines.push(`${indent}${truncateToWidth(line, contentWidth, '…')}`)
    }
    for (let index = start; index < end; index += 1) {
      const candidate = filtered[index] as ResumeCandidate
      const active = index === this.selectedIndex
      const status = [
        candidate.disabledReason === 'current session' ? 'current' : undefined,
        candidate.record.live ? 'live' : undefined,
        candidate.record.persisted ? 'persisted' : undefined,
      ].filter((value): value is string => value !== undefined).join(' · ')
      const lead = `${active ? '❯' : ' '} ${displayText(candidate.title)}`
      push(active ? this.palette.bold(this.palette.accent(lead)) : lead)
      push(this.palette.dim(`  ${new Date(candidate.lastActivityAt).toISOString()} · ${status} · ${displayText(candidate.record.header.id)}`))
      // Only the all-workspaces scope mixes directories, so the per-row
      // workspace is redundant in the scope that already names one.
      if (this.scope === 'all') {
        push(this.palette.dim(`  workspace ${displayText(candidate.workspaceLabel)}`))
      }
      if (candidate.disabledReason !== undefined) {
        push(this.palette.warning(`  unavailable: ${displayText(candidate.disabledReason)}`))
      }
    }
    if (this.candidates === undefined) push(this.palette.dim('Loading sessions…'))
    else if (filtered.length === 0) push(this.palette.warning('No matching sessions.'))
    if (this.error !== '') {
      lines.push('')
      push(this.palette.error(displayText(this.error)))
    }

    const footer = `${indent}${this.palette.dim('Type to search  •  ↑/↓ navigate  •  Tab scope  •  Enter resume  •  Esc clear/cancel')}`
    while (lines.length < height - 2) lines.push('')
    lines.push(footer, '')
    return lines.slice(0, height)
  }
}

interface SelectedBlockPage {
  offset: number
  size: number
  maxOffset: number
}

/** Inline dialog for one user question with option or custom-answer modes. */
export class QuestionDialog implements Component, Focusable {
  private selectedIndex = 0
  private selected = new Set<number>()
  private headerPage: SelectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
  private selectedBlockPage: SelectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
  private mode: 'options' | 'custom'
  private error = ''
  private readonly input = new Input()
  private readonly options: NonNullable<AskUserQuestionItem['options']>
  focused = false

  constructor(
    private readonly question: AskUserQuestionItem,
    private readonly position: number,
    private readonly total: number,
    private readonly unanswered: number,
    private readonly maxVisible: number,
    private readonly maxHeight: () => number,
    private readonly palette: Palette,
    private readonly done: (selection: QuestionSelection) => void,
    private readonly cancel: () => void,
  ) {
    this.options = question.options ?? []
    this.mode = this.options.length > 0 ? 'options' : 'custom'
    this.input.onSubmit = (value) => { this.submitCustom(value) }
    this.input.onEscape = () => {
      if (this.options.length > 0) {
        this.mode = 'options'
        this.error = ''
      } else {
        this.cancel()
      }
    }
  }

  invalidate(): void {
    this.input.invalidate()
  }

  handleInput(data: string): void {
    this.invalidate()
    if (matchesKey(data, Key.pageUp)) {
      this.pageBackward()
      return
    }
    if (matchesKey(data, Key.pageDown)) {
      this.pageForward()
      return
    }
    if (this.mode === 'custom') {
      this.input.focused = this.focused
      this.input.handleInput(data)
      return
    }
    const options = this.options
    if (matchesKey(data, Key.up)) {
      this.selectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
      this.selectedIndex = this.selectedIndex === 0 ? options.length - 1 : this.selectedIndex - 1
    } else if (matchesKey(data, Key.down)) {
      this.selectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
      this.selectedIndex = this.selectedIndex === options.length - 1 ? 0 : this.selectedIndex + 1
    } else if (matchesKey(data, Key.space) && this.question.multiSelect) {
      if (this.selected.has(this.selectedIndex)) this.selected.delete(this.selectedIndex)
      else this.selected.add(this.selectedIndex)
    } else if (matchesKey(data, Key.enter)) {
      const selected = this.question.multiSelect
        ? this.selectedOptionLabels()
        : [options[this.selectedIndex]?.label].filter((label): label is string => label !== undefined)
      const custom = this.question.multiSelect ? this.input.getValue().trim() : ''
      if (selected.length === 0 && custom === '') {
        this.error = 'Select at least one option, or press Tab for a custom answer.'
        return
      }
      this.done({ selected, ...(custom === '' ? {} : { custom }) })
    } else if (matchesKey(data, Key.tab) || data.toLowerCase() === 'c') {
      this.mode = 'custom'
      this.selectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
      this.error = ''
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.cancel()
    }
  }

  private submitCustom(value: string): void {
    const custom = value.trim()
    if (custom === '') {
      this.error = 'Enter an answer before submitting.'
      return
    }
    this.done({
      selected: this.question.multiSelect ? this.selectedOptionLabels() : [],
      custom,
    })
  }

  private selectedOptionLabels(): string[] {
    return [...this.selected]
      .sort((a, b) => a - b)
      .map(index => this.options[index]?.label)
      .filter((label): label is string => label !== undefined)
  }

  /** Page backward through an oversized option, then through question detail. */
  private pageBackward(): void {
    if (this.mode === 'options' && this.selectedBlockPage.offset > 0) {
      this.selectedBlockPage = {
        ...this.selectedBlockPage,
        offset: Math.max(0, this.selectedBlockPage.offset - this.selectedBlockPage.size),
      }
      return
    }
    this.headerPage = {
      ...this.headerPage,
      offset: Math.max(0, this.headerPage.offset - this.headerPage.size),
    }
  }

  /** Page forward through question detail, then through an oversized option. */
  private pageForward(): void {
    if (this.headerPage.offset < this.headerPage.maxOffset) {
      this.headerPage = {
        ...this.headerPage,
        offset: Math.min(
          this.headerPage.maxOffset,
          this.headerPage.offset + this.headerPage.size,
        ),
      }
      return
    }
    if (this.mode === 'custom') return
    this.selectedBlockPage = {
      ...this.selectedBlockPage,
      offset: Math.min(
        this.selectedBlockPage.maxOffset,
        this.selectedBlockPage.offset + this.selectedBlockPage.size,
      ),
    }
  }

  render(width: number): string[] {
    this.input.focused = this.focused
    const horizontalPadding = Math.min(2, Math.max(0, Math.floor((width - 1) / 2)))
    const innerWidth = Math.max(1, width - horizontalPadding * 2)
    const header = `Question ${this.position}/${this.total} (${this.unanswered} unanswered)${this.question.header === undefined ? '' : ` · ${displayText(this.question.header)}`}`
    const questionLines = wrapTextWithAnsi(
      this.palette.text(displayText(this.question.question)),
      innerWidth,
    )
    const contentLines = [...questionLines]
    const headerLines: string[] = [
      ...wrapTextWithAnsi(this.palette.dim(header), innerWidth),
      ...questionLines,
    ]
    // Supporting detail (e.g. the full plan under review) renders between the
    // question and the answer surface, kept out of option labels.
    if (this.question.detail !== undefined) {
      headerLines.push('')
      contentLines.push('')
      for (const line of wrapTextWithAnsi(displayText(this.question.detail), innerWidth)) {
        headerLines.push(line)
        contentLines.push(line)
      }
    }
    headerLines.push('')

    const customControls = [
      ...(this.options.length > 0 && this.question.multiSelect ? [`${this.selected.size} selected`] : []),
      'Enter submit',
      this.options.length > 0 ? 'Esc options' : 'Esc cancel',
    ]
    const customHint = this.palette.dim(customControls.join(' • '))
    const footerLines: string[] = []
    if (this.mode === 'custom') {
      for (const line of this.input.render(innerWidth)) footerLines.push(line)
      for (const line of wrapTextWithAnsi(customHint, innerWidth)) footerLines.push(line)
    } else {
      const controls = [
        'Tab custom answer',
        ...(this.options.length > 1 ? ['↑/↓ navigate'] : []),
        ...(this.question.multiSelect ? ['Space toggle'] : []),
        'Enter submit',
        'Esc interrupt',
      ]
      const hint = this.palette.dim(controls.join(' • '))
      for (const line of wrapTextWithAnsi(hint, innerWidth)) footerLines.push(line)
    }
    if (this.error) {
      for (const line of wrapTextWithAnsi(this.palette.error(this.error), innerWidth)) footerLines.push(line)
    }
    const positionLines = this.mode === 'options' && this.options.length > this.maxVisible
      ? [this.palette.dim(`${this.selectedIndex + 1}/${this.options.length}`)]
      : []

    // Options receive only the rows left after fixed chrome and outer padding.
    // The final height window handles fixed chrome that cannot fit even alone.
    const paddingRows = 2
    const maxHeight = this.maxHeight()
    const availableForOptions = Math.max(
      this.mode === 'options' ? 4 : 1,
      maxHeight - paddingRows - headerLines.length - positionLines.length - footerLines.length,
    )

    const body: string[] = [...headerLines]
    const optionLines: string[] = []
    if (this.mode === 'custom') {
      for (const line of footerLines) body.push(line)
    } else {
      const optionBlocks = this.options.map((option, index) => this.renderOptionBlock(option, index, innerWidth))
      const { visibleBlocks, hiddenBefore, hiddenAfter } = this.windowBlocks(optionBlocks, availableForOptions, innerWidth)
      if (hiddenBefore > 0) optionLines.push(this.palette.dim(`↑ ${hiddenBefore} more`))
      for (const block of visibleBlocks) {
        for (const line of block) optionLines.push(line)
      }
      if (hiddenAfter > 0) optionLines.push(this.palette.dim(`↓ ${hiddenAfter} more`))
      for (const line of optionLines) body.push(line)
      for (const line of positionLines) body.push(line)
      for (const line of footerLines) body.push(line)
    }

    const rows = ['', ...body, '']
    let visibleRows = rows
    if (rows.length <= maxHeight) this.headerPage = { offset: 0, size: 1, maxOffset: 0 }
    if (rows.length > maxHeight && this.mode === 'options' && maxHeight >= 6) {
      const headerBudget = Math.max(
        0,
        maxHeight - optionLines.length - (this.error === '' ? 1 : 2),
      )
      const compactFooter = [
        ...this.error === ''
          ? []
          : [truncateToWidth(this.palette.error(`Error: ${this.error}`), innerWidth, '…')],
        this.compactOptionControls(
          innerWidth,
          headerBudget === 1 && contentLines.length > headerBudget,
        ),
      ]
      const compactHeader = this.compactQuestionHeader(contentLines, headerBudget, innerWidth)
      visibleRows = [...compactHeader, ...optionLines, ...compactFooter]
    } else if (rows.length > maxHeight && this.mode === 'custom' && maxHeight >= 2) {
      const compactFooterSource = [
        ...this.input.render(innerWidth),
        this.compactCustomControls(innerWidth),
        ...this.error === ''
          ? []
          : [truncateToWidth(this.palette.error(this.error), innerWidth, '…')],
      ]
      const footerBudget = Math.max(1, maxHeight - 1)
      const compactFooter = compactFooterSource.length <= footerBudget
        ? compactFooterSource
        : footerBudget === 1
          ? compactFooterSource.slice(0, 1)
          : [
            ...compactFooterSource.slice(0, 1),
            ...compactFooterSource.slice(-(footerBudget - 1)),
          ]
      const compactHeader = this.compactQuestionHeader(
        contentLines,
        Math.max(0, maxHeight - compactFooter.length),
        innerWidth,
      )
      visibleRows = [...compactHeader, ...compactFooter]
    }
    if (visibleRows.length > maxHeight) {
      visibleRows = maxHeight === 1
        ? [this.palette.dim(`↑ ${visibleRows.length} lines hidden`)]
        : [
          this.palette.dim(`↑ ${visibleRows.length - maxHeight + 1} lines hidden`),
          ...visibleRows.slice(-(maxHeight - 1)),
        ]
    }
    return visibleRows.map((line) => {
      const bounded = truncateToWidth(line, innerWidth, '…')
      const pad = ' '.repeat(Math.max(0, innerWidth - visibleWidth(bounded)))
      const outerPad = ' '.repeat(horizontalPadding)
      return `${outerPad}${bounded}${pad}${outerPad}`
    })
  }

  /** Render one option as wrapped label and indented description lines. */
  private renderOptionBlock(
    option: NonNullable<AskUserQuestionItem['options']>[number],
    index: number,
    innerWidth: number,
  ): string[] {
    const cursor = index === this.selectedIndex ? '›' : ' '
    const number = `${index + 1}. `
    const mark = this.question.multiSelect
      ? this.selected.has(index) ? '[x] ' : '[ ] '
      : ''
    const labelPrefixPlain = ` ${cursor} ${number}${mark}`
    const labelPrefixWidth = visibleWidth(labelPrefixPlain)
    const labelBodyWidth = Math.max(1, innerWidth - labelPrefixWidth)
    const labelLines = wrapTextWithAnsi(displayText(option.label), labelBodyWidth)
    const continuation = ' '.repeat(labelPrefixWidth)
    const lines: string[] = []
    for (const [lineIndex, labelLine] of labelLines.entries()) {
      const prefix = lineIndex === 0 ? labelPrefixPlain : continuation
      const composed = `${prefix}${labelLine}`
      lines.push(index === this.selectedIndex ? this.palette.bold(this.palette.accent(composed)) : composed)
    }
    if (option.description !== undefined) {
      const descIndent = ' '.repeat(labelPrefixWidth)
      const descBodyWidth = Math.max(1, innerWidth - labelPrefixWidth)
      const descLines = wrapTextWithAnsi(displayText(option.description), descBodyWidth)
      for (const descLine of descLines) lines.push(`${descIndent}${this.palette.dim(descLine)}`)
    }
    return lines
  }

  /** Keep the question visible when fixed chrome must be compacted. */
  private compactQuestionHeader(
    contentLines: readonly string[],
    budget: number,
    innerWidth: number,
  ): string[] {
    if (budget <= 0) return []
    if (contentLines.length <= budget) {
      this.headerPage = { offset: 0, size: 1, maxOffset: 0 }
      return [...contentLines]
    }
    const pageSize = Math.max(1, budget - 1)
    const maxOffset = Math.max(0, contentLines.length - pageSize)
    const offset = Math.min(this.headerPage.offset, maxOffset)
    this.headerPage = { offset, size: pageSize, maxOffset }
    const keptLines = contentLines.slice(offset, offset + pageSize)
    if (budget === 1) {
      // A page is non-empty because pageSize is one and offset is clamped inside contentLines.
      return [keptLines[0] as string]
    }
    return [
      ...keptLines,
      this.pagerStatus(offset + 1, offset + keptLines.length, contentLines.length, innerWidth),
    ]
  }

  /** Keep Page Up / Page Down discoverable when a full pager status cannot fit. */
  private pagerStatus(first: number, last: number, total: number, innerWidth: number): string {
    const full = `… lines ${first}-${last}/${total} • PgUp/PgDn`
    const compact = `PgUp/PgDn ${first}/${total}`
    return this.palette.dim(truncateToWidth(
      visibleWidth(full) <= innerWidth ? full : compact,
      innerWidth,
      '…',
    ))
  }

  /** Render custom-mode controls on one row when the header must compact. */
  private compactCustomControls(innerWidth: number): string {
    const controls = this.options.length > 0
      ? 'Enter submit • Esc options'
      : 'Enter submit • Esc cancel'
    const fallback = this.options.length > 0 ? '↵ Esc options' : 'Enter Esc cancel'
    const line = visibleWidth(controls) <= innerWidth ? controls : fallback
    return this.palette.dim(truncateToWidth(line, innerWidth, '…'))
  }

  /** Render a one-row option footer that retains every mode-specific control. */
  private compactOptionControls(innerWidth: number, showPager = false): string {
    const controls = [
      ...(this.options.length > 1 ? ['↑/↓'] : []),
      'Tab custom',
      ...(this.question.multiSelect ? ['Space toggle'] : []),
      'Enter',
      'Esc interrupt',
      ...(showPager ? ['PgUp/PgDn'] : []),
    ].join(' • ')
    const optionNavigation = this.options.length > 1 ? '↑↓ ' : ''
    const fallback = showPager
      ? `P↑↓ ${optionNavigation}Tab${this.question.multiSelect ? ' S' : ''}↵Esc`
      : this.question.multiSelect ? `${optionNavigation}Tab Sp ↵Esc` : `${optionNavigation}Tab ↵ Esc`
    const line = visibleWidth(controls) <= innerWidth ? controls : fallback
    return this.palette.dim(truncateToWidth(line, innerWidth, '…'))
  }

  /**
   * Choose option blocks that fit while keeping the selected option visible.
   * Omitted blocks are counted at each end for explicit overflow markers.
   */
  private windowBlocks(
    blocks: readonly string[][],
    budget: number,
    innerWidth: number,
  ): { visibleBlocks: string[][]; hiddenBefore: number; hiddenAfter: number } {
    const totalLines = blocks.reduce((sum, block) => sum + block.length, 0)
    if (totalLines <= budget && blocks.length <= this.maxVisible) {
      return { visibleBlocks: [...blocks], hiddenBefore: 0, hiddenAfter: 0 }
    }
    // `blocks` is dense and selectedIndex is derived from the same options.
    let start = this.selectedIndex
    let end = this.selectedIndex + 1
    /* v8 ignore next -- selectedIndex stays inside [0, options.length). */
    let used = blocks[this.selectedIndex]?.length ?? 0
    const markerLines = (before: number, after: number): number =>
      (before > 0 ? 1 : 0) + (after > 0 ? 1 : 0)
    const fits = (nextStart: number, nextEnd: number, nextUsed: number): boolean =>
      nextEnd - nextStart <= this.maxVisible
      && nextUsed + markerLines(nextStart, blocks.length - nextEnd) <= budget
    const selectedMarkers = markerLines(start, blocks.length - end)
    if (used + selectedMarkers > budget) {
      /* v8 ignore next -- selectedIndex stays inside [0, options.length). */
      const selectedBlock = blocks[this.selectedIndex] ?? []
      const hiddenBefore = start
      const hiddenAfter = blocks.length - end
      const pageSize = budget - selectedMarkers - 1
      const maxOffset = Math.max(0, selectedBlock.length - pageSize)
      const offset = Math.min(this.selectedBlockPage.offset, maxOffset)
      this.selectedBlockPage = { offset, size: pageSize, maxOffset }
      const keptLines = selectedBlock.slice(offset, offset + pageSize)
      const first = offset + 1
      const last = offset + keptLines.length
      const overflow = this.pagerStatus(first, last, selectedBlock.length, innerWidth)
      return {
        visibleBlocks: [[...keptLines, overflow]],
        hiddenBefore,
        hiddenAfter,
      }
    }
    this.selectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
    let expanded = true
    while (expanded && (start > 0 || end < blocks.length)) {
      expanded = false
      if (end < blocks.length) {
        /* v8 ignore next -- guarded by `end < blocks.length` above. */
        const next = blocks[end]?.length ?? 0
        if (fits(start, end + 1, used + next)) {
          used += next
          end += 1
          expanded = true
          continue
        }
      }
      if (start > 0) {
        /* v8 ignore next -- guarded by `start > 0` above. */
        const previous = blocks[start - 1]?.length ?? 0
        if (fits(start - 1, end, used + previous)) {
          used += previous
          start -= 1
          expanded = true
        }
      }
    }
    return {
      visibleBlocks: blocks.slice(start, end),
      hiddenBefore: start,
      hiddenAfter: blocks.length - end,
    }
  }
}
