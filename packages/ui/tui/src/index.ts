/**
 * Interactive pi-tui front door for DeepSeek Harness agents. It renders the
 * durable session transcript, drives one configured agent, and provides
 * keyboard-driven user-question and approval dialogs without owning agent lifecycle.
 * @module @deepseek-ai/dsh-tui
 */

import {
  CombinedAutocompleteProvider,
  Container,
  Key,
  Spacer,
  Text,
  TUI,
  ProcessTerminal,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type SlashCommand,
  type TerminalColorScheme,
} from '@earendil-works/pi-tui'
import { Service, type Context, type Fiber, type FiberState } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type Agent,
  type ModelSelectionRef,
  type AgentStatus,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-loop'
// Optional host composition services used only for zero-state labels.
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import {
  isReplacementSurfaceEvent,
  SessionId,
  type SessionEvent,
  type UserMessage,
} from '@deepseek-ai/dsh-session'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import {
  parseSessionReferenceText,
} from '@deepseek-ai/dsh-session-reference'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
// Type import also declaration-merges the optional `sessionPersistence`
// service onto `Context` so `ctx.get('sessionPersistence')` is typed.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
// Type import declaration-merges the `userQuestions` service onto `Context`;
// the ask-user-question queue is registered by ./chat/questions.
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  TuiExtensionServiceImpl,
  TuiOverlayManager,
} from './extension/overlay-manager.ts'

import {
  parseTuiPromptTemplate,
  renderTuiPromptTemplate,
  type TuiPromptValueHandle,
} from './prompt.ts'
import type {
  TuiOverlayRequest,
  TuiOverlaySession,
  TuiTheme,
} from './extension/types.ts'
import { displayInlineText, displayText } from './components/text.ts'
import { brandText, createPalette, markdownTheme, renderPalette, selectTheme } from './components/theme.ts'
import { contentText, parseArguments } from './components/content.ts'
import {
  cacheHitRate,
  formatTokens,
  recordEventUsage,
  sessionTokens,
} from './chat/tokens.ts'
import { SessionStatsLineComponent } from './chat/stats.ts'
import {
  fadeGlyph,
  formatQueuedStatus,
  formatStatusDuration,
  openStepPhase,
  openTurn,
  pulseLevel,
  runningPhaseGlyph,
  STATUS_ANIMATION_INTERVAL_MS,
  STATUS_FADE_MS,
  StepTimingTracker,
  TIMING_BUCKET_GLYPHS,
  type StepPosition,
} from './chat/timing.ts'
import {
  resolveTuiConfig,
  type Config,
} from './config.ts'
import {
  ContextCardComponent,
  type ToolCardVisibility,
  HeaderComponent,
  StreamingAssistantComponent,
  ToolCardComponent,
  TodoComponent,
  UserMessageComponent,
  type WelcomeRecentSession,
} from './components/transcript.ts'
import {
  ActionDialog,
  compactTargetLabel,
  DetailsDialog,
  diagnosticMeter,
  formatDiagnosticCount,
  formatDiagnosticNumber,
  formatDiagnosticTime,
  initialTarget,
  PermissionDialog,
  StatusCardComponent,
  PromptContextComponent,
  targetLabel,
  type DetailsSelection,
  type ActionDialogChoice,
  type StatusCardRow,
} from './components/dialogs.ts'
import {
  parseSkillCommand,
  renderSkillInvocation,
  SKILL_COMMAND_PREFIX,
} from './chat/skill-invocation.ts'
import { ReferenceAutocompleteProvider } from './chat/autocomplete.ts'
import {
  BANNER_REVEAL_INTERVAL_MS,
  BANNER_REVEAL_STEPS,
  CURSOR_BLINK_INTERVAL_MS,
  EditorAutocompletePanel,
  formatCwd,
  gitBranch,
  HintEditor,
  isCompactCheckpoint,
  sessionReferenceCard,
  transcriptToolCallIds,
} from './chat/helpers.ts'
import {
  createModelController,
  type ModelController,
} from './chat/model-command.ts'
import { createQuestionQueue } from './chat/questions.ts'
import { createApprovalQueue } from './chat/approvals.ts'
import { createResumeController } from './chat/resume.ts'
import {
  createSettingsController,
  readTuiThemePreference,
  type SettingsController,
  type TuiThemePreference,
} from './chat/settings.ts'
import {
  createWorkspaceController,
  type WorkspaceController,
} from './chat/workspace.ts'
import { readTuiLocale, tuiCopy, type TuiLocale } from './chat/language.ts'
import { latestVisibleAssistantText, osc52ClipboardSequence } from './chat/clipboard.ts'
import type { TuiResumeHost, TuiRuntime } from './runtime.ts'
import { WorkspaceFileSearch } from './chat/file-autocomplete.ts'
import { createTuiTerminalMode, parseTuiMouseEvent } from './chat/terminal-mode.ts'
import { TranscriptViewport } from './components/transcript-viewport.ts'

export { TuiPromptService } from './prompt.ts'
export { renderSkillInvocation } from './chat/skill-invocation.ts'
export type { TuiResumeHost, TuiRuntime } from './runtime.ts'
export {
  resolveTuiConfig,
  TuiConfigSchema,
  Config,
  type ResolvedTuiConfig,
  type ResolvedTuiThemeConfig,
  type TuiConfig,
  type TuiThemeConfig,
} from './config.ts'
export {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
} from './chat/file-autocomplete.ts'

export type {
  TuiComponent,
  TuiFocusable,
  TuiOverlayAnchor,
  TuiOverlayCloseReason,
  TuiOverlayHost,
  TuiOverlayMargin,
  TuiOverlayOptions,
  TuiOverlayOutcome,
  TuiOverlayRequest,
  TuiOverlaySession,
  TuiOverlayState,
  TuiTheme,
  TuiViewport,
} from './extension/types.ts'

/** First terminal Cordis state: FAILED, DISPOSED, and UNLOADING are unusable. */
const FIBER_FAILED = 3 as FiberState.FAILED

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Terminal-only interaction service, available only while a TUI is mounted. */
    tui: TuiExtensionService
    /** Optional process host that can replace this TUI with a resumed session. */
    tuiResumeHost: TuiResumeHost | undefined
    /** Launcher-owned `main` session identity; absent lets the app mint one. */
    mainSessionId: MainSessionIdentity | undefined
    /** Line the launcher wants printed on exit; absent prints nothing. */
    tuiGoodbyeMessage: string | undefined
    /** Skill the launcher wants auto-invoked as the fresh session's first turn; absent leaves it to the user. */
    tuiInitialSkill: string | undefined
  }
}

/** Launcher-chosen identity for the app's `main` session. */
export interface MainSessionIdentity {
  /** Exact session id `main` binds to. */
  readonly id: SessionId
  /**
   * Whether that session already has persisted history to load. `true` requires
   * an existing log and fails loud when absent; `false` creates it fresh.
   */
  readonly resume: boolean
}

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(MAIN_SESSION_ID_KEY, identity)`) to fix the `main` agent's
 * session identity, so an app bundle mounted from a `cordis.yml` binds a
 * launcher-selected session without a config key. `ctx.provide` is the only
 * channel from launcher argv into a Loader-mounted plugin, because config
 * `!!js` expressions evaluate against the entry's context. Absent leaves the
 * choice to the app.
 */
export const MAIN_SESSION_ID_KEY = 'mainSessionId'

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(TUI_GOODBYE_MESSAGE_KEY, line)`) to supply the line the TUI
 * prints once the terminal is released on exit — for the shipped CLI, the
 * command that resumes this session. The launcher owns the wording because only
 * it knows how it was invoked; the TUI escapes terminal controls before
 * rendering. Absent prints nothing.
 */
export const TUI_GOODBYE_MESSAGE_KEY = 'tuiGoodbyeMessage'

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(INITIAL_SKILL_KEY, name)`) to seed a fresh session's first user
 * turn with `/skill:<name>`. The renderer cannot infer whether this is a fresh
 * launch, so a launcher that wants one-shot behavior must omit the key when
 * resuming. Absent leaves the first turn to the user.
 */
export const INITIAL_SKILL_KEY = 'tuiInitialSkill'

/**
 * Optional terminal-local interaction service provided by one mounted TUI.
 *
 * The concrete provider retains pi-tui, focus, and terminal lifecycle state.
 * Plugins receive only effect-owned overlay sessions.
 */
export abstract class TuiExtensionService extends Service {
  /** Exact agent driven by this terminal instance. */
  abstract readonly agent: Agent

  /**
   * Queue an interactive overlay owned by the calling plugin fiber.
   *
   * The TUI displays one overlay at a time in FIFO order. Disposing the caller
   * removes a queued overlay or closes an active one before plugin teardown
   * settles. This live presentation is neither logged nor replayed.
   *
   * @param request - component factory, layout constraints, and cancellation.
   * @returns the effect-owned overlay session.
   * @throws when the TUI has begun shutting down.
   */
  abstract openOverlay(request: TuiOverlayRequest): TuiOverlaySession
}

export const name = 'ui-tui'
export const inject = ['agents', 'sessions', 'approval', 'commands', 'userQuestions', 'tools', 'llm', 'systemPrompt', 'tokenMeter', 'tuiPrompt']

/** Model guidance for path-only file references selected through the TUI. */
export const FILE_REFERENCE_PROMPT = 'Paths prefixed with @ are files explicitly referenced by the user. Use the read tool when their contents are needed; do not claim to have inspected a file before reading it.'

/**
 * Transcript row standing in for one compacted range. The conversation the
 * compaction replaced stays rendered above it: the marker reports where the
 * model stopped seeing that history, not that the history is gone.
 */
const COMPACTION_MARKER = '… earlier context was compacted …'

interface RunningStatus {
  turn: number | undefined
  timer: ReturnType<typeof setInterval>
  /** Render clock when the turn began; origin of the glyph fade-in. */
  startedAt: number
  /** The most recently rendered phase glyph, handed to the fade-out. */
  lastGlyph: string
}

/** A running glyph fading out after its turn ended, before the caret returns. */
interface FadingStatus {
  glyph: string
  /** Render clock when the turn ended; origin of the glyph fade-out. */
  endedAt: number
  timer: ReturnType<typeof setInterval>
}

/** Width/height adapter for a modal component rendered inside the base TUI flow. */
class InlineModalComponent extends Container {
  constructor(
    component: Component,
    private readonly width: number,
    private readonly maxHeight: number,
  ) {
    super()
    this.addChild(component)
  }

  override render(width: number): string[] {
    const lines = super.render(Math.max(1, Math.min(width, this.width)))
    return lines.slice(0, Math.max(1, this.maxHeight))
  }
}

/** Resolve a column/row count or percentage against the current terminal edge. */
function resolveInlineModalSize(
  value: number | `${number}%` | undefined,
  total: number,
  fallback: number,
): number {
  if (typeof value === 'number') return value
  if (value === undefined) return fallback
  const percentage = Number.parseFloat(value.slice(0, -1))
  return Number.isFinite(percentage) ? Math.max(1, Math.floor(total * percentage / 100)) : fallback
}

/** Lifecycle handle for a mounted interactive terminal channel. */
export interface TuiController {
  /** Stop rendering, restore the terminal, and reject pending questions. */
  dispose(): Promise<void>
}

/**
 * Start the interactive pi-tui channel for an already-created target agent.
 * @param ctx - agent, tools, session-event, approval, and user-question context.
 * @param config - target agent, banner, and TUI presentation config.
 * @param runtime - terminal and process-exit boundary.
 * @returns lifecycle controller used by the Cordis effect disposer.
 */
export function createTuiChat(
  ctx: Context,
  config: Config,
  runtime: TuiRuntime,
): TuiController {
  const sessionId = SessionId(config.sessionId ?? 'main')
  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error(`ui-tui: session "${sessionId}" is not running`)
  const resolved = resolveTuiConfig(config)
  let themePreference = readTuiThemePreference(ctx.get('settings'))
  let locale = readTuiLocale(ctx.get('settings'))
  let terminalScheme: TerminalColorScheme = 'dark'
  const initialScheme: TerminalColorScheme = themePreference === 'light' ? 'light' : 'dark'
  const palette = createPalette(resolved.theme.color, initialScheme)
  const mdTheme = markdownTheme(palette)
  // The software caret below provides deterministic blinking even when a
  // terminal profile ignores DECSCUSR. Keep pi-tui's hardware cursor enabled
  // as the IME candidate-window anchor on terminals that support it.
  const ui = new TUI(runtime.terminal, resolved.showHardwareCursor)
  const terminalMode = createTuiTerminalMode(runtime.terminal, resolved)
  let terminalOwned = false
  const chat = new Container()
  const todoContainer = new Container()
  const questionContainer = new Container()
  const composerOverlayContainer = new Container()
  const inputTemplate = parseTuiPromptTemplate(displayInlineText(resolved.theme.inputPrompt))
  const renderInputPrompt = (): string => renderTuiPromptTemplate(inputTemplate, valueName => ctx.tuiPrompt.get(valueName))
  const initialInputPrompt = renderInputPrompt()
  const editor = new HintEditor(ui, {
    borderColor: palette.dim,
    selectList: selectTheme(palette),
  } satisfies EditorTheme, {
    paddingX: 1,
    autocompletePlacement: 'external',
    frame: 'none',
    prompt: {
      first: initialInputPrompt,
      continuation: ' '.repeat(visibleWidth(initialInputPrompt)),
    },
  })
  editor.cursorEnabled = resolved.showHardwareCursor
  editor.cursorVisible = resolved.showHardwareCursor
  editor.hintPrefix = initialInputPrompt
  const inputPlaceholder = (): string => resolved.theme.inputPlaceholder === 'Describe a task, @ a file, or / for commands'
    ? tuiCopy(locale).inputPlaceholder
    : resolved.theme.inputPlaceholder
  editor.hint = palette.dim(displayInlineText(inputPlaceholder()))
  const editorAutocomplete = new EditorAutocompletePanel(editor)
  type TuiKeymap = 'default' | 'vim'
  type VimState = 'insert' | 'normal'
  let keymap: TuiKeymap = 'default'
  let vimState: VimState = 'insert'
  let vimPending = ''
  const refreshEditorFooter = (): void => {
    if (keymap === 'vim' && vimState === 'normal') {
      editor.frameFooter = agent.status === 'running'
        ? 'VIM NORMAL · Esc cancel · i insert · h/j/k/l move'
        : 'VIM NORMAL · i insert · h/j/k/l move · x delete'
      return
    }
    const mode = keymap === 'vim' ? 'VIM INSERT · ' : ''
    editor.frameFooter = agent.status === 'running'
      ? `${mode}${tuiCopy(locale).editorRunningFooter}`
      : `${mode}${tuiCopy(locale).editorIdleFooter}`
  }
  refreshEditorFooter()
  const todo = new TodoComponent(palette)
  const compactionStatusLine = new Text('', 0, 0)
  let showReasoning = resolved.showReasoning
  // Ctrl+O cycles collapsed -> expanded -> hidden. Codex-style: hidden drops
  // tool cards entirely, collapsed previews, expanded shows full bodies.
  let toolsVisibility: ToolCardVisibility = 'collapsed'
  let streaming: StreamingAssistantComponent | undefined
  let completedStreaming: StreamingAssistantComponent | undefined
  // One shared accumulator serves every step's timing footer; per-footer
  // replay of the whole log is quadratic on a long resumed session.
  const stepTimingTracker = new StepTimingTracker()
  // Assistant step components in model order per turn, for hidden-mode folding:
  // with tool cards hidden, a turn keeps one Assistant header and later steps
  // render as headerless continuations (see applyTurnFolding).
  const assistantSteps = new Map<number, StreamingAssistantComponent[]>()
  let runningStatus: RunningStatus | undefined
  let fadingStatus: FadingStatus | undefined
  /**
   * Live standalone compaction observed by this process. Never derive this
   * state from history: a resumed log may contain a stale orphaned start.
   */
  let compacting: {
    startedAt: number
    timer: ReturnType<typeof setInterval>
  } | undefined
  // TUI steering submissions that the inbox has not yet claimed or discarded.
  // Correlation ids avoid guessing whether a running-state submission actually
  // joined steering or fell back to the queued-turn FIFO during turn close.
  const pendingSteering = new Set<MessageId>()
  let disposed = false
  let shuttingDown: Promise<void> | undefined
  // Optional: skills mount conditionally, so read the global service store
  // rather than declaring an injection that would make the TUI require them.
  const skills = ctx.get('skills')
  const cwd = agent.session.header.cwd ?? process.cwd()
  const fileSearch = new WorkspaceFileSearch(cwd, {
    maxResults: resolved.fileSearchMaxResults,
    maxEntries: resolved.fileSearchMaxEntries,
    excludedDirectories: resolved.fileSearchExcludedDirectories,
  })
  const skillAbort = new AbortController()
  const tokens = sessionTokens(agent.session)
  const sessionStatistics = (): {
    stats: SessionStatsProjection | undefined
    usage: TokenUsageProjection
  } => {
    const projections = ctx.reflect._getImpl('sessionProjections', false)
    const values = projections === undefined || projections.fiber.state >= FIBER_FAILED
      ? undefined
      : ctx.get('sessionProjections', false)?.snapshot(agent.session).values
    return {
      stats: values?.sessionStats,
      // Production TUI and Web read the same durable tokenUsage projection.
      // A custom embedding may omit token-meter; preserve its existing full-log
      // event fold as a semantically equivalent fallback.
      usage: values?.tokenUsage ?? {
        uncachedInputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheWriteTokens: tokens.cacheWrite,
      },
    }
  }
  const sessionStatsLine = new SessionStatsLineComponent(
    sessionStatistics,
    palette,
  )
  const toolCards = new Map<string, ToolCardComponent>()
  const allToolCards = new Set<ToolCardComponent>()
  const contextCards = new Set<ContextCardComponent>()
  const liveErrors = new Set<string>()
  const commandControllers = new Set<AbortController>()
  const referenceControllers = new Set<AbortController>()
  let tuiServiceFiber: Fiber | undefined
  const target: ModelSelectionRef = { current: initialTarget(agent), assembled: undefined }
  // `updatePromptValues` (defined below) closes over the model controller, but
  // the controller needs `appendNotice`/`overlayManager`, defined after that
  // closure. Declare here, assign once after those exist, and defer the first
  // `updatePromptValues()` call until after the assignment so no read precedes it.
  // oxlint-disable-next-line prefer-const -- single assignment is a forward-reference, not a const.
  let modelController!: ModelController
  // oxlint-disable-next-line prefer-const -- assigned after palette-dependent callbacks are declared.
  let settingsController!: SettingsController
  // oxlint-disable-next-line prefer-const -- assigned after shared terminal handoff callbacks are declared.
  let workspaceController!: WorkspaceController
  // oxlint-disable-next-line prefer-const -- selector callbacks run only after command dispatch is assigned.
  let runCommand!: (text: string) => void
  // oxlint-disable-next-line prefer-const -- skill-browser callbacks run only after dispatch is assigned.
  let invokeSkill!: (name: string, instructions: string) => void
  const now = (): number => runtime.now?.() ?? Date.now()
  const agentStatus = (): AgentStatus => agent.status
  const isDisposed = (): boolean => disposed
  const sessionQuery = (): SessionQueryEngine | undefined => {
    const implementation = ctx.reflect._getImpl('sessionQuery', false)
    if (implementation === undefined || implementation.fiber.state >= FIBER_FAILED) return undefined
    return ctx.get('sessionQuery', false)
  }
  const isZeroState = (): boolean => !agent.session.events.some(event =>
    event.type === 'turn/start'
    || event.type === 'user/message'
    || event.type === 'assistant/message'
    || event.type === 'tool/call'
    || event.type === 'tool/result')
  const currentPreset = (): string =>
    ctx.get('agentPresets')?.composedPreset(agent.ctx)
    ?? agent.session.header.agentPreset
    ?? 'not composed'
  const currentPermission = (): string => {
    const approval = ctx.get('approval')
    const permissionPresets = ctx.get('permissionPresets')
    const preset = permissionPresets?.current(agent.session.events)
    if (permissionPresets !== undefined && preset !== undefined) return permissionPresets.optionOf(preset).name
    const approvalPolicy = approval?.overrideOf(agent.session) ?? approval?.config.policy ?? 'ask'
    return `approval ${approvalPolicy}`
  }
  let recentSessions: readonly WelcomeRecentSession[] | null | undefined
  const welcomeAbort = new AbortController()

  // A configured subtitle renders as a banner line; when absent, the banner has
  // no subtitle. The banner itself sweeps in on start (see startBannerReveal).
  let sessionTitle = foldSessionTitle(agent.session.events)?.title
  const header = new HeaderComponent(
    agent,
    () => sessionTitle ?? config.welcome,
    palette,
    resolved.theme.color && resolved.theme.truecolor,
    () => ({
      expanded: isZeroState(),
      preset: currentPreset(),
      model: target.current === undefined ? 'model unset' : compactTargetLabel(target.current),
      permission: currentPermission(),
      recentSessions,
    }),
    () => runtime.terminal.rows,
    () => locale,
  )
  const formattedCwd = displayText(runtime.formatCwd?.(agent.session.header.cwd) ?? formatCwd(agent.session.header.cwd))
  const branch = runtime.gitBranch?.(cwd) ?? gitBranch(cwd)
  const promptValues: TuiPromptValueHandle[] = [
    ctx.tuiPrompt.register('cwd', palette.bold(palette.accent(formattedCwd))),
    ctx.tuiPrompt.register('git/worktree', branch === undefined ? undefined : palette.dim(` (${displayText(branch)})`)),
    ctx.tuiPrompt.register('token_meter/cache_hit_rate'),
    ctx.tuiPrompt.register('status'),
    ctx.tuiPrompt.register('preset'),
    ctx.tuiPrompt.register('model'),
    ctx.tuiPrompt.register('permission'),
    ctx.tuiPrompt.register('details'),
    ctx.tuiPrompt.register('context'),
    ctx.tuiPrompt.register('queued'),
    ctx.tuiPrompt.register('symbol', palette.bold(palette.accent('dsh'))),
    ctx.tuiPrompt.register('indicator', palette.dim('> ')),
  ]
  const [
    cwdValue, gitValue, tokenValue, statusValue, presetValue, modelValue,
    permissionValue, detailsValue, contextValue, queuedValue, symbolValue, indicatorValue,
  ] = promptValues
  /* v8 ignore next -- the fixed built-in registration list always supplies each handle. */
  if (cwdValue === undefined || gitValue === undefined || tokenValue === undefined || statusValue === undefined
    || presetValue === undefined || modelValue === undefined || permissionValue === undefined || detailsValue === undefined
    || contextValue === undefined || queuedValue === undefined || symbolValue === undefined || indicatorValue === undefined) {
    throw new Error('TUI prompt built-ins failed to initialize')
  }
  const updatePromptValues = (): void => {
    const renderTime = now()
    cwdValue.set(palette.bold(palette.accent(formattedCwd)))
    gitValue.set(branch === undefined ? undefined : palette.dim(` (${displayText(branch)})`))
    const rate = cacheHitRate(tokens)
    const usage = `↑${formatTokens(tokens.input)} ↓${formatTokens(tokens.output)}`
    const modelLabel = displayText(target.current === undefined ? 'model unset' : compactTargetLabel(target.current))
    statusValue.set(palette.dim(agent.status))
    presetValue.set(`  ${palette.dim(displayInlineText(currentPreset()))}`)
    modelValue.set(`  ${palette.dim(`${modelLabel} [alt+m]`)}`)
    permissionValue.set(`  ${palette.dim(displayInlineText(currentPermission()))}`)
    const detailsExpanded = toolsVisibility === 'expanded' && showReasoning
    detailsValue.set(palette.dim(`${detailsExpanded ? '▾' : '▸'} `))
    tokenValue.set(`  ${palette.dim(rate === undefined ? usage : `${usage} cache ${rate}%`)}`)
    const contextWindow = modelController.contextWindow()
    contextValue.set(contextWindow === undefined ? undefined : `  ${palette.dim(
      `${Math.min(100, Math.round(ctx.tokenMeter.measure(agent.session).totalTokens / contextWindow * 100))}% context`,
    )}`)
    const queued = runningStatus === undefined ? undefined : formatQueuedStatus(pendingSteering.size)
    queuedValue.set(queued === undefined ? undefined : palette.dim(queued))
    symbolValue.set(palette.bold(palette.accent('dsh')))
    compactionStatusLine.setText(compacting === undefined
      ? ''
      : palette.dim(`Context being compacted ${formatStatusDuration(renderTime - compacting.startedAt)}`))
    // `${indicator}` owns the caret column and its trailing gap before the
    // cursor. The active status glyph replaces the `>` caret in place — same
    // width every frame — fading in when work starts, throbbing while it runs,
    // and fading out after it ends before the plain `>` returns. Only the gray
    // brightness changes, so the cursor never shifts.
    const statusGlyph = runningPhaseGlyph(
      agent.session.events,
      runningStatus !== undefined,
      compacting !== undefined,
    )
    // Remember the live phase glyph so the fade-out shows it, not the ttft
    // fallback the derivation returns once the closing turn's step has ended.
    if (runningStatus !== undefined && statusGlyph !== undefined) runningStatus.lastGlyph = statusGlyph
    // The fade envelope gates appear/disappear; the active throb breathes the
    // glyph throughout the operation. Truecolor opacity is envelope × throb; the
    // non-truecolor fallback keys visibility off the envelope alone, so the
    // throb never blinks it. `envelope` clamps to [0, 1].
    const activeSince = runningStatus?.startedAt ?? compacting?.startedAt
    const envelope = activeSince !== undefined && statusGlyph !== undefined
      ? { glyph: statusGlyph, level: Math.min(1, (renderTime - activeSince) / STATUS_FADE_MS) }
      : fadingStatus !== undefined
        ? { glyph: fadingStatus.glyph, level: Math.max(0, 1 - (renderTime - fadingStatus.endedAt) / STATUS_FADE_MS) }
        : undefined
    const caret = envelope === undefined
      ? palette.dim('>')
      : fadeGlyph(
        envelope.glyph,
        palette,
        resolved.theme.color,
        resolved.theme.color && resolved.theme.truecolor,
        envelope.level * pulseLevel(renderTime),
        envelope.level >= 0.5,
      )
    indicatorValue.set(`${caret}${palette.dim(' ')}`)
  }
  const promptContext = new PromptContextComponent(
    parseTuiPromptTemplate(displayInlineText(resolved.theme.leftPrompt)),
    parseTuiPromptTemplate(displayInlineText(resolved.theme.rightPrompt)),
    valueName => ctx.tuiPrompt.get(valueName),
  )
  const transcriptViewport = new TranscriptViewport(chat, (width) => {
    if (!resolved.fullscreen) return undefined
    const reservedRows = header.render(width).length
      + 2
      + todoContainer.render(width).length
      + compactionStatusLine.render(width).length
      + promptContext.render(width).length
      + sessionStatsLine.render(width).length
      + questionContainer.render(width).length
      + composerOverlayContainer.render(width).length
      + editorAutocomplete.render(width).length
      + editor.render(width).length
    const available = Math.max(0, runtime.terminal.rows - reservedRows)
    // A pristine welcome dashboard is already the complete zero-state body.
    // The fixed two-row gap below is the complete pristine transcript area;
    // do not stretch it to the screen bottom before the first conversation.
    if (isZeroState() && chat.children.length === 0) return 0
    return available
  })
  ui.addChild(header)
  ui.addChild(transcriptViewport)
  ui.addChild(new Spacer(2))
  todoContainer.addChild(todo)
  ui.addChild(todoContainer)
  ui.addChild(compactionStatusLine)
  ui.addChild(questionContainer)
  ui.addChild(editor)
  ui.addChild(editorAutocomplete)
  ui.addChild(composerOverlayContainer)
  ui.addChild(promptContext)
  ui.addChild(sessionStatsLine)
  ui.setFocus(editor)
  const updateTerminalTitle = (): void => {
    runtime.terminal.setTitle(displayText(
      sessionTitle === undefined ? resolved.title : `${sessionTitle} — ${resolved.title}`,
    ))
  }
  updateTerminalTitle()

  const requestRender = (): void => {
    if (disposed) return
    // State changes and user input begin a fresh visible phase. The blink timer
    // bypasses this wrapper when it intentionally renders the hidden phase.
    editor.cursorVisible = editor.cursorEnabled
    updatePromptValues()
    const inputPrompt = renderInputPrompt()
    editor.setPrompt({ first: inputPrompt, continuation: ' '.repeat(visibleWidth(inputPrompt)) })
    editor.hintPrefix = inputPrompt
    promptContext.invalidate()
    ui.requestRender()
  }
  let cursorBlinkTimer: ReturnType<typeof setInterval> | undefined
  const stopCursorBlink = (): void => {
    if (cursorBlinkTimer !== undefined) {
      clearInterval(cursorBlinkTimer)
      cursorBlinkTimer = undefined
    }
    editor.cursorVisible = editor.cursorEnabled
  }
  const startCursorBlink = (): void => {
    if (!resolved.showHardwareCursor || cursorBlinkTimer !== undefined) return
    editor.cursorVisible = editor.cursorEnabled
    cursorBlinkTimer = setInterval(() => {
      if (!terminalOwned || !editor.focused) {
        editor.cursorVisible = false
        return
      }
      editor.cursorVisible = !editor.cursorVisible
      editor.invalidate()
      ui.requestRender()
    }, CURSOR_BLINK_INTERVAL_MS)
  }
  // A prompt value that changes on its own schedule (e.g. a plugin-owned
  // `${custom}` fragment) redraws through the registry's coalesced notification;
  // built-ins are already covered by the state-change callers of requestRender.
  const disposePromptChanges = ctx.tuiPrompt.subscribe(requestRender)

  const loadWelcomeSessions = async (): Promise<void> => {
    const query = sessionQuery()
    if (query === undefined) {
      recentSessions = null
      requestRender()
      return
    }
    try {
      const records = (await query.listSessions(welcomeAbort.signal))
        .filter(record => record.header.id !== agent.session.id)
        .slice(0, 3)
      const titles = await query.readTitleSnapshots(
        records.map(record => record.header.id),
        welcomeAbort.signal,
      )
      if (welcomeAbort.signal.aborted || disposed) return
      recentSessions = records.map((record, index): WelcomeRecentSession => {
        const result = titles[index]
        const title = result?.status === 'fulfilled'
          ? result.value.title?.title ?? record.header.id
          : record.header.id
        return {
          title,
          workspace: runtime.formatCwd?.(record.header.cwd) ?? formatCwd(record.header.cwd),
          date: new Date(record.header.createdAt).toISOString().slice(0, 10),
        }
      })
      requestRender()
    } catch (error: unknown) {
      if (welcomeAbort.signal.aborted || disposed) return
      recentSessions = null
      ctx.logger.warn(`ui-tui: could not load welcome session history: ${errorChain(error)}`)
      requestRender()
    }
  }
  const appendNotice = (message: string, kind: 'info' | 'warning' | 'error' = 'info'): void => {
    const color = kind === 'error' ? palette.error : kind === 'warning' ? palette.warning : palette.dim
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(color(displayText(message)), 0, 0))
    requestRender()
  }

  const extensionTheme: TuiTheme = Object.freeze({
    text: (value: string) => palette.text(value),
    brand: (value: string) => resolved.theme.color
      ? resolved.theme.truecolor ? brandText(value) : palette.brand(value)
      : value,
    dim: (value: string) => palette.dim(value),
    accent: (value: string) => palette.accent(value),
    success: (value: string) => palette.success(value),
    warning: (value: string) => palette.warning(value),
    error: (value: string) => palette.error(value),
    bold: (value: string) => palette.bold(value),
  })
  const overlayManager = new TuiOverlayManager({
    viewport: () => Object.freeze({
      columns: runtime.terminal.columns,
      rows: runtime.terminal.rows,
    }),
    theme: () => extensionTheme,
    display: displayText,
    show: (component, options, placement) => {
      if (placement === 'overlay') {
        return ui.showOverlay(component, options === undefined
          ? undefined
          : {
            ...options,
            ...typeof options.margin === 'object'
              ? { margin: { ...options.margin } }
              : {},
          })
      }
      const isQuestion = placement === 'inline'
      const modal = new InlineModalComponent(
        component,
        isQuestion
          ? resolved.questionDialogWidth
          : resolveInlineModalSize(options?.width, runtime.terminal.columns, runtime.terminal.columns),
        isQuestion
          ? resolved.questionDialogMaxHeight
          : resolveInlineModalSize(options?.maxHeight, runtime.terminal.rows, resolved.modelDialogMaxHeight),
      )
      const container = isQuestion ? questionContainer : composerOverlayContainer
      if (isQuestion) editor.frameVisible = false
      container.clear()
      container.addChild(modal)
      ui.setFocus(component)
      return {
        hide(): void {
          container.clear()
          if (isQuestion) editor.frameVisible = true
          ui.setFocus(editor)
        },
      }
    },
    invalidate: requestRender,
    reportError: (error) => {
      const message = errorChain(error)
      ctx.logger.warn(`ui-tui: overlay failed: ${message}`)
      /* v8 ignore next -- shutdown removes overlays before the terminal stops */
      if (disposed) return
      appendNotice(`TUI overlay failed: ${message}`, 'error')
    },
  })

  const disposeTargetListeners = installModelSelection(agent.ctx, target)

  modelController = createModelController({
    ctx,
    resolved,
    palette,
    overlayManager,
    target,
    appendNotice,
    requestRender,
    isDisposed,
  })
  updatePromptValues()
  if (isZeroState()) void loadWelcomeSessions()

  const renderStatus = (): void => {
    streaming?.invalidate()
    requestRender()
  }

  /** Stop the turn-phase running and fade-out timers and drop both states. */
  const clearTurnStatus = (): void => {
    if (runningStatus !== undefined) {
      clearInterval(runningStatus.timer)
      runningStatus = undefined
    }
    if (fadingStatus !== undefined) {
      clearInterval(fadingStatus.timer)
      fadingStatus = undefined
    }
    runtime.terminal.setProgress(compacting !== undefined)
  }

  /** Hard clear: drop every indicator, including a live compaction bracket. */
  const clearStatus = (): void => {
    if (compacting !== undefined) {
      clearInterval(compacting.timer)
      compacting = undefined
    }
    clearTurnStatus()
  }

  /**
   * Hand the last active glyph to a fade-out that re-renders until it settles
   * on the `>` caret, then stops its own timer. A hard clear (teardown) skips
   * this via {@link clearStatus}.
   */
  const beginFadeOut = (glyph: string): void => {
    clearTurnStatus()
    const fading: FadingStatus = {
      glyph,
      endedAt: now(),
      timer: setInterval(() => {
        if (now() - fading.endedAt >= STATUS_FADE_MS) clearTurnStatus()
        renderStatus()
      }, STATUS_ANIMATION_INTERVAL_MS),
    }
    fadingStatus = fading
  }

  const setStatus = (status: AgentStatus): void => {
    const priorTurn = runningStatus?.turn
    const fadeOutGlyph = status !== 'running' ? runningStatus?.lastGlyph : undefined
    if (status === 'running') clearTurnStatus()
    else if (fadeOutGlyph !== undefined) beginFadeOut(fadeOutGlyph)
    else clearTurnStatus()
    editor.borderColor = status === 'running' ? text => palette.accent(text) : text => palette.dim(text)
    editor.hint = palette.dim(displayInlineText(inputPlaceholder()))
    refreshEditorFooter()
    if (status === 'running') {
      const turn = priorTurn ?? openTurn(agent.session.events)
      const running: RunningStatus = {
        turn,
        startedAt: now(),
        // Seed with the current phase (ttft before the first step opens) so the
        // fade-out always has a glyph, even for a turn that ends before a render.
        lastGlyph: TIMING_BUCKET_GLYPHS[openStepPhase(agent.session.events) ?? 'ttft'],
        // Refresh every tick so the fading prompt phase glyph animates even
        // before the first token, when no streaming component exists yet.
        timer: setInterval(renderStatus, STATUS_ANIMATION_INTERVAL_MS),
      }
      runningStatus = running
      runtime.terminal.setProgress(true)
      // Initial replay suppresses an orphaned idle `step/start`. If that same
      // Agent becomes live, restore the pre-token Assistant/timing row now.
      attachStreaming()
    }
    requestRender()
  }

  const refreshStatus = (): void => {
    renderStatus()
  }

  const parsedTool = (event: Extract<SessionEvent, { type: 'tool/call' }>): ToolCardComponent => {
    const parsed = parseArguments(event.data.arguments)
    const card = new ToolCardComponent(
      event.data.name,
      parsed,
      ctx.tools.get(event.data.name, agent),
      resolved.maxToolOutputLines,
      resolved.maxDiffEditLength,
      palette,
      mdTheme,
    )
    card.setVisibility(toolsVisibility)
    toolCards.set(event.data.callId, card)
    allToolCards.add(card)
    return card
  }

  /**
   * Re-derive hidden-mode folding for one turn: the first step with a visible
   * body owns the turn's single Assistant header, every other step renders as a
   * headerless continuation (empty ones render nothing). Any other visibility
   * restores the per-step headers.
   */
  const applyTurnFolding = (turn: number): void => {
    const steps = assistantSteps.get(turn)
    if (steps === undefined) return
    let headerSeen = false
    for (const step of steps) {
      if (toolsVisibility !== 'hidden') {
        step.setFoldedContinuation(false)
      } else if (!headerSeen && step.hasVisibleBody()) {
        headerSeen = true
        step.setFoldedContinuation(false)
      } else {
        step.setFoldedContinuation(true)
      }
    }
  }

  const registerAssistantStep = (component: StreamingAssistantComponent): void => {
    const steps = assistantSteps.get(component.position.turn) ?? []
    steps.push(component)
    assistantSteps.set(component.position.turn, steps)
    applyTurnFolding(component.position.turn)
  }

  const removeStreaming = (current: StreamingAssistantComponent | undefined): void => {
    if (current === undefined) return
    for (const child of [current, current.timing]) {
      const index = chat.children.indexOf(child)
      /* v8 ignore next -- streaming components and their timing footers are retained only while attached to the chat. */
      if (index >= 0) chat.children.splice(index, 1)
    }
    const steps = assistantSteps.get(current.position.turn)
    /* v8 ignore next -- every attached streaming component is registered in the fold map. */
    if (steps === undefined) return
    const index = steps.indexOf(current)
    /* v8 ignore next -- registration precedes attachment, so the component is present until this removal. */
    if (index < 0) return
    steps.splice(index, 1)
    // A retracted step may have owned the turn's hidden-mode header.
    applyTurnFolding(current.position.turn)
  }

  /**
   * Move the running step's timing footer to the tail of the chat so it trails
   * the tool cards the step just appended. A completed footer (its step ended,
   * so `streaming` is cleared) stays pinned where it is.
   */
  const trailStreamingTiming = (): void => {
    /* v8 ignore next -- every replayed tool event follows its step/start, so an open step always owns an attached footer here. */
    if (streaming === undefined) return
    const footer = streaming.timing
    const index = chat.children.indexOf(footer)
    /* v8 ignore next -- the open step's footer is attached to the chat whenever a tool event of that step renders. */
    if (index < 0) return
    chat.children.splice(index, 1)
    chat.addChild(footer)
  }

  const clearStreaming = (): void => {
    removeStreaming(streaming)
    streaming = undefined
  }

  const retractFailedStreaming = (): void => {
    removeStreaming(streaming ?? completedStreaming)
    streaming = undefined
    completedStreaming = undefined
  }

  const startAssistantStep = (position: StepPosition): void => {
    streaming = new StreamingAssistantComponent(
      position,
      () => agent.session.events,
      stepTimingTracker,
      now,
      showReasoning,
      palette,
      mdTheme,
    )
    registerAssistantStep(streaming)
    // Keep the historical wait/timing row visible before the first token. A
    // claimed user/context message can arrive after durable `step/start`; the
    // helper below moves this still-empty row behind that input so transcript
    // reading order remains input -> response without dropping live timing.
    // An idle imported log may end with an orphaned open step; do not present
    // that stale boundary as active work until the Agent is actually running.
    if (agent.status === 'running') {
      chat.addChild(streaming)
      chat.addChild(streaming.timing)
    }
  }

  /** Attach an imported/truncated live component that was not in the log. */
  const attachStreaming = (): void => {
    if (streaming === undefined || chat.children.includes(streaming)) return
    chat.addChild(streaming)
    chat.addChild(streaming.timing)
  }

  /**
   * `step/start` is durable before that step's claimed user messages. While the
   * step has no visible body, keep its wait row at the transcript tail so every
   * subsequently claimed input still reads before the Assistant response.
   */
  const trailPendingStreaming = (): void => {
    if (streaming === undefined || streaming.isSettled() || streaming.hasVisibleBody()) return
    for (const child of [streaming, streaming.timing]) {
      const index = chat.children.indexOf(child)
      if (index >= 0) chat.children.splice(index, 1)
      chat.addChild(child)
    }
  }

  const renderEvent = (
    event: SessionEvent,
    options: {
      addHistory: boolean
      renderChunks: boolean
    },
  ): void => {
    switch (event.type) {
      case 'user/message': {
        // Injected context (plugin/goal source) renders as a dim context card,
        // not a human bubble; only a direct human prompt is a user message. The
        // boolean avoids narrowing `source`, so the label keeps its full union.
        const source = event.data.source
        if (source.kind !== 'user') {
          const references = sessionReferenceCard(event.data.source)
          if (references !== undefined) {
            chat.addChild(new Spacer(1))
            chat.addChild(new Text(palette.dim(`Referenced sessions · ${references.map(displayText).join(', ')}`), 0, 0))
            trailPendingStreaming()
            break
          }
          const text = contentText(event.data.content).trim()
          /* v8 ignore next -- context events with empty content are rejected by their owning producers. */
          if (text) {
            // The tui type view lacks plugin-augmented source kinds (e.g. goal),
            // so read the display label without narrowing on `kind`. The session
            // log is a durable/replay boundary: a corrupt or foreign injected
            // source may not match the typed shape, so fall back to `context`.
            const labelled = source as { kind?: unknown; plugin?: unknown }
            const label = typeof labelled.plugin === 'string' ? labelled.plugin
              : typeof labelled.kind === 'string' ? labelled.kind
                : 'context'
            const card = new ContextCardComponent(label, text, palette)
            card.setExpanded(toolsVisibility === 'expanded')
            contextCards.add(card)
            chat.addChild(new Spacer(1))
            chat.addChild(card)
          }
          trailPendingStreaming()
          break
        }
        const text = displayText(contentText(event.data.content).trim())
        if (text) {
          chat.addChild(new Spacer(1))
          chat.addChild(new UserMessageComponent(text, palette, mdTheme))
          if (options.addHistory) editor.addToHistory(text)
        }
        trailPendingStreaming()
        break
      }
      case 'step/start':
        startAssistantStep(event.data)
        break
      case 'assistant/chunk':
        if (options.renderChunks && streaming !== undefined) {
          attachStreaming()
          streaming.update(event.data.chunk)
          // The first streamed text/reasoning may make this step the turn's
          // hidden-mode header owner (or a continuation with a visible body).
          applyTurnFolding(streaming.position.turn)
        }
        break
      case 'assistant/message':
        completedStreaming = undefined
        // A settled component stays attached but never absorbs a later message
        // of the same step; both the live and replay paths start a new one.
        if (streaming === undefined || streaming.isSettled() || !chat.children.includes(streaming)) startAssistantStep(event.data)
        if (streaming !== undefined) {
          attachStreaming()
          streaming.settle(event.data.message.content)
          applyTurnFolding(streaming.position.turn)
        }
        break
      case 'llm/retry': {
        retractFailedStreaming()
        const retryLimit = event.data.mode === 'always' ? '∞' : String(event.data.maxRetries)
        appendNotice(
          `Retrying model request (${event.data.retry}/${retryLimit}) in ${event.data.delayMs}ms: ${event.data.failure.message}`,
          'warning',
        )
        break
      }
      // No external Spacer for tool cards: the card renders its own leading
      // gap, so the hidden state removes the row and the gap together.
      case 'tool/call':
        chat.addChild(parsedTool(event))
        trailStreamingTiming()
        break
      case 'tool/result': {
        const callId = event.data.message.source.callId
        let card = toolCards.get(callId)
        if (card === undefined) {
          card = new ToolCardComponent(
            'tool',
            { value: {}, valid: true },
            undefined,
            resolved.maxToolOutputLines,
            resolved.maxDiffEditLength,
            palette,
            mdTheme,
          )
          card.setVisibility(toolsVisibility)
          chat.addChild(card)
          allToolCards.add(card)
        }
        card.updateResult(event.data)
        toolCards.delete(callId)
        trailStreamingTiming()
        break
      }
      case 'todo/write':
        todo.update(event.data.todos)
        break
      case 'turn/start':
        // Plan strip is turn-scoped: keep it after turn/end for reading, clear on the next turn.
        todo.update([])
        break
      case 'session/title':
        sessionTitle = event.data.title
        header.invalidate()
        updateTerminalTitle()
        break
      case 'step/end':
        if (streaming === undefined) startAssistantStep(event.data)
        // A truncated/imported log can contain a closing boundary without a
        // visible chunk or opening boundary. Preserve the established terminal
        // contract by still rendering its completion timestamp.
        attachStreaming()
        streaming?.complete(event.time)
        completedStreaming = streaming
        streaming = undefined
        break
      // Every turn/end kind presents why the agent stopped: `completed` is
      // presented by the settled assistant message and its Completed timing
      // header; every other kind appends an explicit notice.
      case 'turn/end': {
        clearStreaming()
        const reason = event.data.reason
        switch (reason.kind) {
          case 'completed':
            break
          case 'error': {
            const prefix = `${event.data.turn}:`
            const reported = [...liveErrors].filter(key => key.startsWith(prefix))
            for (const key of reported) liveErrors.delete(key)
            if (reported.length === 0) appendNotice(reason.error.message, 'error')
            break
          }
          case 'aborted':
            appendNotice(
              reason.reason.kind === 'disposed'
                ? 'Turn stopped: the agent was disposed.'
                : 'Turn cancelled.',
              'warning',
            )
            break
          case 'max-tokens':
            appendNotice('The model reached its output-token limit.', 'warning')
            break
          case 'interrupted':
            appendNotice('The previous process ended during this turn.', 'warning')
            break
          default:
            // TurnEndReasonMap is merge-extensible: a plugin-added outcome
            // still names why the agent stopped rather than ending silently.
            appendNotice(`Turn ended: ${(reason as { kind: string }).kind}.`, 'warning')
            break
        }
        break
      }
      default:
        break
    }
  }

  const renderCompactionMarker = (): void => {
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(palette.dim(COMPACTION_MARKER), 0, 0))
  }

  /**
   * Replay the human transcript from the append-only log. The model-visible
   * surface shadows compacted ranges, so it is not the source here: every
   * append-origin message stays rendered, and a replacement contributes at most
   * the compaction marker at its own log position.
   *
   * The `tool/call` pairing check has no live counterpart, because only replay
   * can meet an orphan: `tool/call` carries no `surfaceOp` of its own, so it
   * inherits transcript membership from the `assistant/message` that advertised
   * it, which the live listener has necessarily just rendered. A loaded log is a
   * replay boundary, so the pairing is re-derived here instead of assumed.
   */
  const rebuildTranscript = (
    populateHistory: boolean,
    preserved?: { component: StreamingAssistantComponent; attached: boolean },
  ): void => {
    chat.clear()
    toolCards.clear()
    allToolCards.clear()
    contextCards.clear()
    assistantSteps.clear()
    streaming = undefined
    todo.update([])
    const transcriptCalls = transcriptToolCallIds(agent.session)
    let restored = false
    for (const event of agent.session.events) {
      if (isReplacementSurfaceEvent(event)) {
        if (isCompactCheckpoint(event)) renderCompactionMarker()
        continue
      }
      if (event.type === 'tool/call' && !transcriptCalls.has(event.data.callId)) continue
      if (preserved !== undefined && event.type === 'step/start'
        && event.data.turn === preserved.component.position.turn
        && event.data.step === preserved.component.position.step) {
        streaming = preserved.component
        streaming.setShowReasoning(showReasoning)
        registerAssistantStep(streaming)
        if (preserved.attached) attachStreaming()
        restored = true
        continue
      }
      renderEvent(event, { addHistory: populateHistory, renderChunks: false })
      // The live component first became visible at its first durable chunk.
      // Reattach at the same log position so claimed user messages stay before
      // it and later tool cards stay after it.
      if (preserved?.attached === true && streaming === preserved.component
        && event.type === 'assistant/chunk'
        && event.data.turn === preserved.component.position.turn
        && event.data.step === preserved.component.position.step) {
        attachStreaming()
      }
    }
    // Defensive support for imported/truncated logs with no matching
    // step/start: preserve the live view instead of dropping the response.
    if (preserved !== undefined && !restored) {
      streaming = preserved.component
      streaming.setShowReasoning(showReasoning)
      registerAssistantStep(streaming)
      if (preserved.attached) attachStreaming()
    }
    // Recompute the live timing footer at the current render clock. Reusing the
    // component deliberately preserves streamed blocks, but its cached timing
    // otherwise reflects the instant of the last chunk before this rebuild.
    preserved?.component.invalidate()
    requestRender()
  }

  /** Rebuild settled history while retaining the current, not-yet-settled response. */
  const rebuildPreservingStreaming = (): void => {
    const component = streaming
    rebuildTranscript(false, component === undefined ? undefined : {
      component,
      attached: chat.children.includes(component),
    })
  }

  const questions = createQuestionQueue({
    ctx,
    resolved,
    palette,
    overlayManager,
    requestRender,
    isDisposed,
    questionMaxHeight: () => {
      const width = runtime.terminal.columns
      const editorRows = editor.render(width).length
      return Math.max(1, Math.min(
        resolved.questionDialogMaxHeight,
        runtime.terminal.rows - editorRows,
      ))
    },
  })

  const approvals = createApprovalQueue({
    ctx,
    agent,
    resolved,
    palette,
    overlayManager,
    requestRender,
    isDisposed,
    approvalMaxHeight: () => {
      const width = runtime.terminal.columns
      const editorRows = editor.render(width).length
      return Math.max(1, Math.min(
        resolved.questionDialogMaxHeight,
        runtime.terminal.rows - editorRows,
      ))
    },
  })

  /** Acquire every process-owned terminal mode exactly once. */
  const acquireTerminal = (): void => {
    if (terminalOwned) return
    try {
      terminalMode.enter()
      try {
        ui.start()
      } catch (error: unknown) {
        // TUI.start() may have already entered raw mode before rendering
        // throws, so one balancing stop remains required on this path.
        ui.stop()
        throw error
      }
      terminalOwned = true
      startCursorBlink()
    } catch (error: unknown) {
      terminalMode.leave()
      throw error
    }
  }

  /** Release every process-owned terminal mode exactly once. */
  const releaseTerminal = (): void => {
    if (!terminalOwned) return
    // Clear ownership before invoking external terminal code so a disposal
    // re-entering this boundary cannot write a second stop into the primary
    // screen after the alternate buffer has already been left.
    stopCursorBlink()
    terminalOwned = false
    try {
      ui.stop()
    } finally {
      terminalMode.leave()
    }
  }
  const restoreTerminal = (): void => {
    acquireTerminal()
    ui.setFocus(editor)
    // The replacement alternate-screen buffer starts blank while pi-tui still
    // remembers the previous buffer's rows. Force a complete first frame so a
    // rejected/returning handoff cannot strand the user on an empty screen.
    ui.invalidate()
    ui.requestRender(true)
  }

  const resume = createResumeController({
    ctx,
    agent,
    runtime,
    resolved,
    palette,
    overlayManager,
    // Optional and independently mounted. The shared non-strict resolver also
    // feeds the welcome dashboard without capturing a transient sibling state.
    sessionQuery,
    appendNotice,
    requestRender,
    isDisposed,
    agentStatus,
    releaseTerminal,
    restoreTerminal,
  })

  const shutdown = (exitProcess: boolean): Promise<void> => {
    shuttingDown ??= (async () => {
      disposed = true
      welcomeAbort.abort(new Error('TUI disposed'))
      overlayManager.beginShutdown()
      modelController.resetContextResolution()
      settingsController.clearOverlays()
      workspaceController.clearOverlay()
      clearStatus()
      for (const controller of commandControllers) controller.abort(new Error('TUI disposed'))
      commandControllers.clear()
      for (const controller of referenceControllers) controller.abort(new Error('TUI disposed'))
      referenceControllers.clear()
      await tuiServiceFiber?.dispose()
      tuiServiceFiber = undefined
      questions.rejectAll()
      approvals.cancelAll()
      await overlayManager.dispose()
      modelController.clearOverlay()
      questions.unregister()
      approvals.unregister()
      await runtime.terminal.drainInput(100, 20)
      releaseTerminal()
      if (exitProcess) {
        if (runtime.goodbyeMessage !== undefined) {
          runtime.terminal.write(`${palette.dim(displayText(runtime.goodbyeMessage))}\n`)
        }
        runtime.exit(0)
      }
    })()
    return shuttingDown
  }

  const requestExit = (): void => {
    if (agent.status === 'running') {
      agent.cancel({ kind: 'user' })
      appendNotice('Cancelling the active turn before exit…', 'warning')
      void agent.whenIdle().then(() => shutdown(true))
      return
    }
    void shutdown(true)
  }

  /** Swap the palette and all derived themes for the resolved terminal color scheme. */
  const applyColorScheme = (scheme: TerminalColorScheme): void => {
    if (scheme === currentScheme) return
    currentScheme = scheme
    Object.assign(palette, createPalette(resolved.theme.color, scheme))
    Object.assign(mdTheme, markdownTheme(palette))
    // `setStatus` below re-derives `editor.borderColor` from the new palette.
    rebuildPreservingStreaming()
    setStatus(agent.status)
    requestRender()
  }
  let currentScheme: TerminalColorScheme = initialScheme

  /** Apply a persistent preference, resolving `system` through the latest terminal report. */
  const applyThemePreference = (preference: TuiThemePreference): void => {
    themePreference = preference
    applyColorScheme(preference === 'system' ? terminalScheme : preference)
  }

  /** Refresh copy-only terminal chrome without rewriting transcript content. */
  const applyLocale = (nextLocale: TuiLocale): void => {
    locale = nextLocale
    editor.hint = palette.dim(displayInlineText(inputPlaceholder()))
    refreshEditorFooter()
    header.invalidate()
    requestRender()
  }

  settingsController = createSettingsController({
    ctx,
    resolved,
    palette,
    overlayManager,
    appendNotice,
    requestRender,
    isDisposed,
    applyTheme: applyThemePreference,
    applyLocale,
  })
  workspaceController = createWorkspaceController({
    ctx,
    agent,
    runtime,
    resolved,
    palette,
    overlayManager,
    appendNotice,
    requestRender,
    isDisposed,
    agentStatus,
    releaseTerminal,
    restoreTerminal,
  })

  // Apply any color scheme the terminal reports. Registering before the query
  // below means even a synchronous reply reaches `applyColorScheme`; in practice
  // the startup query's reply is the only report, since dsh-tui leaves
  // unsolicited color-scheme notifications disabled.
  const disposeSchemeListener = ui.onTerminalColorSchemeChange((scheme) => {
    terminalScheme = scheme
    if (themePreference === 'system') applyColorScheme(scheme)
  })

  // Ask the terminal for its color scheme via device-status report; the reply,
  // if any, arrives through the listener above. Most terminals do not respond,
  // so we keep the dark-optimised palette. Swallow a query-write failure for the
  // same reason.
  ui.queryTerminalColorScheme({ timeoutMs: 2000 }).catch(() => {})

  const setToolsVisibility = (next: ToolCardVisibility, announce = true): void => {
    toolsVisibility = next
    for (const card of allToolCards) card.setVisibility(toolsVisibility)
    // Context cards carry injected instructions rather than tool traffic, so
    // they never hide: the hidden phase reads as their collapsed preview.
    for (const card of contextCards) card.setExpanded(toolsVisibility === 'expanded')
    // Hidden mode folds each turn's steps into one assistant message; other
    // modes restore the per-step Assistant headers.
    for (const turn of assistantSteps.keys()) applyTurnFolding(turn)
    if (announce) {
      appendNotice(toolsVisibility === 'hidden' ? 'Tool cards hidden.' : `Tool and context cards ${toolsVisibility}.`)
    }
  }

  const toggleTools = (): void => {
    // The cycle order puts the two common reading modes adjacent: preview ->
    // full detail -> conversation-only, then back to the preview default.
    setToolsVisibility(toolsVisibility === 'collapsed' ? 'expanded'
      : toolsVisibility === 'expanded' ? 'hidden' : 'collapsed')
  }

  const setReasoning = (show: boolean, announce = true): void => {
    showReasoning = show
    rebuildPreservingStreaming()
    if (announce) appendNotice(`Reasoning blocks ${showReasoning ? 'shown' : 'hidden'}.`)
  }

  const toggleReasoning = (): void => { setReasoning(!showReasoning) }

  /** Disclosure action shared by the prompt's mouse target and its glyph. */
  const toggleAllDetails = (): void => {
    const expand = toolsVisibility !== 'expanded' || !showReasoning
    setReasoning(expand, false)
    setToolsVisibility(expand ? 'expanded' : 'collapsed', false)
    appendNotice(expand
      ? 'Context, tool, and reasoning details expanded.'
      : 'Context and tool details collapsed; reasoning hidden.')
  }

  // The selector and the argument grammar mutate the same closure state the
  // Ctrl+O cycle and Ctrl+R toggle drive, so every entry converges.
  let detailsOverlay: TuiOverlaySession | undefined
  const showDetailsSelector = (): void => {
    void detailsOverlay?.close()
    const session = overlayManager.open({
      create: () => new DetailsDialog(
        toolsVisibility,
        showReasoning,
        palette,
        // Each Tab applies immediately; one dimension changes per call.
        (selection: DetailsSelection) => {
          if (selection.showReasoning !== showReasoning) setReasoning(selection.showReasoning)
          if (selection.visibility !== toolsVisibility) setToolsVisibility(selection.visibility)
        },
        () => { void session.close() },
      ),
      options: { width: resolved.detailsDialogWidth, anchor: 'center', margin: 1 },
    }, 'composer')
    detailsOverlay = session
    void session.closed.then(() => {
      if (detailsOverlay === session) detailsOverlay = undefined
    })
    requestRender()
  }

  let permissionsOverlay: TuiOverlaySession | undefined
  const showPermissionsSelector = (): void => {
    const permissionPresets = ctx.get('permissionPresets')
    if (permissionPresets === undefined) {
      appendNotice('Permission presets are not available in this composition.', 'warning')
      return
    }
    const choices = permissionPresets.names.map((name) => {
      const option = permissionPresets.optionOf(name)
      return {
        value: option.value,
        label: option.name,
        ...option.description === undefined ? {} : { description: option.description },
      }
    })
    if (choices.length === 0) {
      appendNotice('No permission presets are configured.', 'warning')
      return
    }
    void permissionsOverlay?.close()
    const session = overlayManager.open({
      create: () => new PermissionDialog(
        choices,
        permissionPresets.current(agent.session.events),
        palette,
        (value) => {
          void session.close()
          runCommand(`/permissions ${value}`)
        },
        () => { void session.close() },
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    permissionsOverlay = session
    void session.closed.then(() => {
      if (permissionsOverlay === session) permissionsOverlay = undefined
    })
    requestRender()
  }

  // `/details` names the same transcript-detail state the Ctrl+O cycle and
  // Ctrl+R toggle mutate, so a user can jump to a mode without cycling.
  const runDetails = (rawInput: string): CommandResult => {
    const tokens = rawInput.split(/\s+/u).filter(token => token !== '')
    if (tokens.length === 0) {
      showDetailsSelector()
      return { kind: 'success' }
    }
    let visibility: ToolCardVisibility | undefined
    let reasoning: boolean | undefined
    for (let token = tokens.shift(); token !== undefined; token = tokens.shift()) {
      if (token === 'collapsed' || token === 'expanded' || token === 'hidden') {
        visibility = token
      } else if (token === 'reasoning') {
        const value = tokens[0]
        if (value === 'on' || value === 'off') {
          tokens.shift()
          reasoning = value === 'on'
        } else {
          reasoning = !showReasoning
        }
      } else {
        return { kind: 'error', text: `Unknown /details argument "${token}". Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]` }
      }
    }
    // Reasoning first: its transcript rebuild would drop the visibility notice.
    if (reasoning !== undefined) setReasoning(reasoning)
    if (visibility !== undefined) setToolsVisibility(visibility)
    return { kind: 'success' }
  }

  const showHelp = (): void => {
    const commandLines = ctx.commands.list(agent).map((command) => {
      const input = command.input === undefined ? '' : ` ${command.input.hint}`
      return `/${command.name}${input} — ${command.description}`
    })
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(palette.bold(palette.accent('Keyboard shortcuts')), 0, 0))
    chat.addChild(new Text([
      'Enter send • Shift/Alt+Enter newline • Up/Down prompt history • Alt+M choose model',
      'Page Up/Down scroll transcript • Ctrl+End follow latest • mouse wheel scrolls transcript or selectors',
      'Esc cancel turn • Ctrl+O cycle cards (collapse/expand/hide) • Ctrl+R toggle reasoning • Ctrl+L redraw',
      'Ctrl+C cancel while running; clear input or exit while idle • Ctrl+D exit',
      '',
      ...commandLines,
      '/skill:<name> [instructions] — load a skill into the conversation',
    ].map(line => palette.dim(line)).join('\n'), 0, 0))
    requestRender()
  }

  let commandHubOverlay: TuiOverlaySession | undefined
  let commandHubOperations = Promise.resolve()
  const openActionDialog = (
    title: string,
    choices: readonly ActionDialogChoice[],
    done: (value: string) => void,
    initialValue?: string,
  ): void => {
    void commandHubOverlay?.close()
    const session = overlayManager.open({
      create: () => new ActionDialog(
        title,
        choices,
        resolved.maxModelOptions,
        palette,
        (value) => {
          void session.close()
          done(value)
        },
        () => { void session.close() },
        initialValue,
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    commandHubOverlay = session
    void session.closed.then(() => {
      if (commandHubOverlay === session) commandHubOverlay = undefined
    })
    requestRender()
  }

  const setKeymap = (next: TuiKeymap): void => {
    keymap = next
    vimState = 'insert'
    vimPending = ''
    refreshEditorFooter()
    appendNotice(next === 'vim'
      ? 'Vim keymap enabled in Insert mode. Press Esc for Normal mode; i returns to Insert mode.'
      : 'Default terminal keymap enabled.')
    requestRender()
  }

  const runKeymapCommand = (raw: string): CommandResult => {
    const argument = raw.trim().toLowerCase()
    if (argument === '') {
      openActionDialog('Keymap', [
        { value: 'default', label: 'Default', description: keymap === 'default' ? 'current · terminal editing shortcuts' : 'terminal editing shortcuts' },
        { value: 'vim', label: 'Vim', description: keymap === 'vim' ? 'current · Normal and Insert modes' : 'Normal and Insert modes' },
      ], (value) => { if (value === 'default' || value === 'vim') setKeymap(value) }, keymap)
      return { kind: 'success' }
    }
    if (argument !== 'default' && argument !== 'vim') {
      return { kind: 'error', text: 'Usage: /keymap [default|vim]' }
    }
    setKeymap(argument)
    return { kind: 'success' }
  }

  const runVimCommand = (raw: string): CommandResult => {
    const argument = raw.trim().toLowerCase()
    if (argument === 'status') {
      return { kind: 'success', text: `Vim mode is ${keymap === 'vim' ? `on (${vimState})` : 'off'}.` }
    }
    if (argument !== '' && argument !== 'on' && argument !== 'off') {
      return { kind: 'error', text: 'Usage: /vim [on|off|status]' }
    }
    const enable = argument === 'on' || (argument === '' && keymap !== 'vim')
    setKeymap(enable ? 'vim' : 'default')
    return { kind: 'success' }
  }

  const showSkills = async (): Promise<void> => {
    if (skills === undefined) {
      appendNotice('Skills are not available in this agent preset.', 'warning')
      return
    }
    const snapshot = await skills.snapshot({ cwd, scope: agent, signal: skillAbort.signal })
    if (disposed) return
    const invocable = snapshot.skills.filter(skill => skill.invocation.userInvocable)
    if (invocable.length === 0) {
      appendNotice(snapshot.complete
        ? 'No user-invocable skills are installed for this agent.'
        : 'Skill discovery is incomplete and returned no user-invocable skills.', 'warning')
      return
    }
    openActionDialog('Skills', invocable.map(skill => ({
      value: skill.name,
      label: skill.name,
      description: `${skill.source.startsWith('project-') ? 'project' : 'user'} · ${skill.description}`,
    })), (value) => { invokeSkill(value, '') })
  }

  const runSkillsCommand = (raw: string): CommandResult => {
    const argument = raw.trim()
    if (argument !== '') {
      invokeSkill(argument, '')
      return { kind: 'success' }
    }
    commandHubOperations = commandHubOperations.then(showSkills).catch((error: unknown) => {
      if (!disposed) appendNotice(`Could not read skills: ${errorChain(error)}`, 'error')
    })
    return { kind: 'success' }
  }

  const runIdeCommand = (raw: string): CommandResult => {
    const argument = raw.trim()
    if (argument !== '') {
      const reference = /\s/u.test(argument) ? `@${JSON.stringify(argument)} ` : `@${argument} `
      editor.insertTextAtCursor(reference)
      appendNotice(`Inserted workspace reference ${displayText(reference.trim())}.`)
      requestRender()
      return { kind: 'success' }
    }
    const terminalHost = process.env.TERM_PROGRAM?.trim() || 'standalone terminal (no IDE bridge)'
    openActionDialog('IDE Context', [
      { value: 'reference', label: 'Reference a workspace file', description: 'insert @ and open file completion' },
      { value: 'workspace', label: 'Choose workspace', description: displayText(cwd) },
      { value: 'status', label: 'Inspect current context', description: displayText(terminalHost) },
    ], (value) => {
      if (value === 'reference') {
        editor.insertTextAtCursor('@')
        editor.handleInput('\t')
        requestRender()
      } else if (value === 'workspace') runCommand('/workspace')
      else if (value === 'status') appendNotice(`Terminal host: ${displayText(terminalHost)}\nWorkspace: ${displayText(cwd)}\nGit branch: ${displayText(gitBranch(cwd) ?? 'not detected')}\nOpen files and editor selections require an IDE bridge; use @ references in this terminal.`)
    })
    return { kind: 'success' }
  }

  const runMentionCommand = (raw: string): CommandResult => {
    const argument = raw.trim()
    if (argument !== '') return runIdeCommand(raw)
    editor.insertTextAtCursor('@')
    editor.handleInput('\t')
    requestRender()
    return { kind: 'success' }
  }

  const runRenameCommand = (raw: string): CommandResult => {
    const title = raw.trim()
    if (title === '') {
      editor.insertTextAtCursor('/rename ')
      requestRender()
      return { kind: 'success' }
    }
    const service = ctx.get('sessionTitle')
    if (service === undefined) {
      return { kind: 'error', text: 'Rename is unavailable: session titles are not mounted.' }
    }
    try {
      const renamed = service.rename(agent.session, title)
      return { kind: 'success', text: `Session renamed to "${displayText(renamed.title)}".` }
    } catch (error: unknown) {
      return { kind: 'error', text: `Rename failed: ${errorChain(error)}` }
    }
  }

  const runCopyCommand = (): CommandResult => {
    const text = latestVisibleAssistantText(agent.session.events)
    if (text === undefined) return { kind: 'error', text: 'No assistant response is available to copy.' }
    try {
      runtime.terminal.write(osc52ClipboardSequence(text, process.env.TMUX !== undefined))
      return { kind: 'success', text: 'Copied the latest assistant response to the clipboard.' }
    } catch (error: unknown) {
      return { kind: 'error', text: `Copy failed: ${errorChain(error)}` }
    }
  }

  const runExperimentalCommand = (raw: string): CommandResult => {
    const argument = raw.trim().toLowerCase()
    const actions: Record<string, string> = {
      fast: '/fast',
      vim: '/vim',
      reload: '/reload',
      reasoning: '/details reasoning',
    }
    if (argument !== '') {
      const command = actions[argument]
      if (command === undefined) return { kind: 'error', text: 'Usage: /experimental [fast|vim|reload|reasoning]' }
      runCommand(command)
      return { kind: 'success' }
    }
    openActionDialog('Experimental Features', [
      { value: 'fast', label: 'Fast model route', description: 'switch to an advertised flash/fast/turbo/lite model' },
      { value: 'vim', label: 'Vim editor mode', description: keymap === 'vim' ? `active · ${vimState}` : 'inactive' },
      { value: 'reasoning', label: 'Reasoning visibility', description: showReasoning ? 'shown' : 'hidden' },
      { value: 'reload', label: 'Reload composition', description: 'development only · idle agents' },
    ], (value) => { const command = actions[value]; if (command !== undefined) runCommand(command) })
    return { kind: 'success' }
  }

  const showPalette = (): void => {
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(
      renderPalette(palette, currentScheme, resolved.theme.color).join('\n'), 0, 0,
    ))
    requestRender()
  }

  const showStatus = (): void => {
    const events = agent.session.events
    // A persistence end-seed is a loading boundary, not user activity. Preserve
    // the historical status-card semantics even though the core helper was
    // intentionally retired with the old TUI package.
    const latestActivity = events.findLast(event => event.type !== 'session/end-seed')?.time
      ?? agent.session.header.createdAt
    const usedContext = Math.max(0, Math.round(ctx.tokenMeter.measure(agent.session).totalTokens))
    let context = `${formatDiagnosticNumber(usedContext)} used · capacity unknown`
    const contextWindow = modelController.contextWindow()
    if (contextWindow !== undefined) {
      const contextPercent = Math.round(usedContext / contextWindow * 100)
      context = `${diagnosticMeter(contextPercent, palette)} ${String(contextPercent)}% used (${formatDiagnosticNumber(usedContext)} / ${formatDiagnosticNumber(contextWindow)})`
    }
    const rate = cacheHitRate(tokens)
    const turns = events.filter(event => event.type === 'turn/start').length
    const steps = events.filter(event => event.type === 'step/start').length
    const toolCalls = events.filter(event => event.type === 'tool/call').length
    const model = target.current === undefined ? 'unset' : displayText(targetLabel(target.current))
    const effort = target.current === undefined
      ? 'unset'
      : target.current.reasoningEffort === undefined
        ? 'default'
        : displayText(target.current.reasoningEffort)
    const groups: readonly (readonly StatusCardRow[])[] = [
      [
        ['Session', displayText(agent.session.id)],
        ['Title', displayText(sessionTitle ?? 'untitled')],
        ['Directory', displayText(cwd)],
        ['Model', `${model} ${palette.dim(`(effort ${effort}; reasoning blocks ${showReasoning ? 'shown' : 'hidden'})`)}`],
      ],
      [
        ['Agent', [
          agent.status,
          formatDiagnosticCount(events.length, 'event'),
          formatDiagnosticCount(turns, 'turn'),
          formatDiagnosticCount(steps, 'step'),
          formatDiagnosticCount(toolCalls, 'tool call'),
        ].join(' · ')],
      ],
      [
        ['Tokens', `${formatDiagnosticNumber(tokens.input)} input + ${formatDiagnosticNumber(tokens.output)} output`],
        ['KV cache', rate === undefined
          ? `n/a (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`
          : `${diagnosticMeter(rate, palette)} ${String(rate)}% hit (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`],
        ['Context', context],
      ],
      [
        ['Created', formatDiagnosticTime(agent.session.header.createdAt)],
        ['Active', formatDiagnosticTime(latestActivity)],
      ],
    ]
    const card = new StatusCardComponent(groups, palette)
    chat.addChild(new Spacer(1))
    chat.addChild(card)
    requestRender()
  }

  // Skill listing is async while `createTuiChat` is synchronous, so the TUI
  // retains the last complete invocation-neutral catalog for synchronous
  // editor completion, filters it for user invocation, and refreshes it after
  // registry invalidation.
  let skillCommands: SlashCommand[] = []
  let skillCommandScan = 0
  const refreshCommandAutocomplete = (): void => {
    const base = new CombinedAutocompleteProvider(
      [
        ...ctx.commands.list(agent).map(command => ({
          name: command.name,
          description: command.description,
          ...(command.input === undefined ? {} : { argumentHint: command.input.hint }),
        })),
        ...skillCommands,
      ],
      agent.session.header.cwd ?? process.cwd(),
    )
    const sessionReferences = ctx.get('sessionReferenceResolver')
    editor.setAutocompleteProvider(new ReferenceAutocompleteProvider(
      base,
      fileSearch,
      sessionReferences,
      agent,
    ))
  }
  const refreshVisibleSlashAutocomplete = (): void => {
    const cursor = editor.getCursor()
    const textBeforeCursor = editor.getLines().slice(cursor.line, cursor.line + 1).join('').slice(0, cursor.col)
    if (cursor.line === 0 && textBeforeCursor.startsWith('/') && !textBeforeCursor.includes(' ')) {
      // pi-tui's provider setter closes an existing menu but does not query
      // the replacement for the current draft. Tab in a slash-name context
      // only requests suggestions, so it refreshes without editing the text.
      editor.handleInput('\t')
    }
  }
  const disposeCommandChanges = ctx.on('commands/change', refreshCommandAutocomplete)
  refreshCommandAutocomplete()

  const refreshSkillCommands = (service: SkillRegistry): void => {
    const scan = ++skillCommandScan
    service.snapshot({ cwd, scope: agent, signal: skillAbort.signal }).then(
      (snapshot) => {
        if (disposed || scan !== skillCommandScan || !snapshot.complete) return
        const invocable = snapshot.skills.filter(skill => skill.invocation.userInvocable)
        // The argument-hint slot shows in the menu but is never inserted on
        // selection, so it carries the skill's scope instead of an
        // instructions placeholder. `SkillSource` is open-ended; every
        // non-project source (user, custom, bundled, runtime, …) collapses
        // to `(user)`.
        skillCommands = invocable.map(skill => ({
          name: `skill:${skill.name}`,
          description: skill.description,
          argumentHint: skill.source.startsWith('project-') ? '(project)' : '(user)',
        }))
        refreshCommandAutocomplete()
        refreshVisibleSlashAutocomplete()
        requestRender()
      },
      () => {
        // Discovery failed or was aborted on dispose; keep the base slash
        // commands so autocomplete still works without skill entries.
      },
    )
  }
  const disposeSkillChanges = skills === undefined
    ? () => {}
    : ctx.on('skills/change', () => { refreshSkillCommands(skills) })
  if (skills !== undefined) refreshSkillCommands(skills)

  // The agent scope is minted by agent-loop and intentionally inherits only
  // that core plugin's dependencies. A child command producer declares its own
  // UI-service dependency while retaining the parent agent scope and lifetime.
  const commandFiber = agent.ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'help',
      description: 'Show keyboard shortcuts and commands',
      handler: () => { showHelp(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'model',
      description: 'Show or switch this session\'s model',
      input: { hint: '[[provider/]model]' },
      handler: ({ rawInput }) => {
        modelController.queueModelCommand(rawInput)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'fast',
      description: 'Toggle a real advertised low-latency model route',
      input: { hint: '[on|off|status]' },
      handler: ({ rawInput }) => {
        modelController.queueFastCommand(rawInput)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'skills',
      description: 'Browse and invoke user-invocable skills for this agent',
      input: { hint: '[name]' },
      handler: ({ rawInput }) => runSkillsCommand(rawInput),
    })
    commandCtx.commands.register({
      name: 'keymap',
      description: 'Choose the default or Vim terminal editing keymap',
      input: { hint: '[default|vim]' },
      handler: ({ rawInput }) => runKeymapCommand(rawInput),
    })
    commandCtx.commands.register({
      name: 'vim',
      description: 'Toggle Vim Normal and Insert modes for the composer',
      input: { hint: '[on|off|status]' },
      handler: ({ rawInput }) => runVimCommand(rawInput),
    })
    commandCtx.commands.register({
      name: 'experimental',
      description: 'Open the terminal experimental-feature launcher',
      input: { hint: '[fast|vim|reload|reasoning]' },
      handler: ({ rawInput }) => runExperimentalCommand(rawInput),
    })
    commandCtx.commands.register({
      name: 'ide',
      description: 'Inspect terminal IDE context or insert a workspace file reference',
      input: { hint: '[path]' },
      handler: ({ rawInput }) => runIdeCommand(rawInput),
    })
    commandCtx.commands.register({
      name: 'mention',
      description: 'Insert a workspace file reference into the composer',
      input: { hint: '[path]' },
      handler: ({ rawInput }) => runMentionCommand(rawInput),
    })
    commandCtx.commands.register({
      name: 'approve',
      description: 'Allow an active request or one retry of the latest rejected request',
      handler: () => {
        if (approvals.approveActive()) return { kind: 'success', text: 'Pending tool request allowed once.' }
        if (approvals.approveRecentRejection()) {
          return { kind: 'success', text: 'One matching retry of the latest rejected tool request is approved.' }
        }
        return { kind: 'error', text: 'No active or recently rejected tool approval is available.' }
      },
    })
    commandCtx.commands.register({
      name: 'new',
      description: 'Start a new chat in the current workspace',
      handler: ({ rawInput }) => {
        if (rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /new (no arguments)' }
        workspaceController.queueFreshSession()
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'clear',
      description: 'Clear the terminal and start a new chat',
      handler: ({ rawInput }) => {
        if (rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /clear (no arguments)' }
        workspaceController.queueFreshSession()
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'copy',
      description: 'Copy the latest assistant response to the terminal clipboard',
      handler: runCopyCommand,
    })
    commandCtx.commands.register({
      name: 'details',
      description: 'Select tool-card visibility and reasoning display',
      input: { hint: '[collapsed|expanded|hidden] [reasoning [on|off]]' },
      handler: ({ rawInput }) => runDetails(rawInput),
    })
    commandCtx.commands.register({
      name: 'palette',
      description: 'Show every color and attribute role this terminal renders',
      handler: () => { showPalette(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'reload',
      description: 'EXPERIMENTAL (dev): re-read loader config files and apply the diff (idle only)',
      handler: () => { runReload(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'resume',
      description: 'List this workspace\'s resumable sessions',
      handler: () => { resume.showResume(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'rename',
      description: 'Rename this session and pin its title',
      input: { hint: '<title>' },
      handler: ({ rawInput }) => runRenameCommand(rawInput),
    })
    commandCtx.commands.register({
      name: 'language',
      description: 'Choose and persist the CLI/Web interface language',
      input: { hint: '[zh|en]' },
      handler: ({ rawInput }) => {
        settingsController.queueLanguageCommand(rawInput)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'settings',
      description: 'Show shared settings namespaces and the settings document',
      input: { hint: '[list|document]' },
      handler: ({ rawInput }) => {
        settingsController.queueSettingsCommand(rawInput)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'theme',
      description: 'Choose and persist the light, dark, or system appearance',
      input: { hint: '[light|dark|system]' },
      handler: ({ rawInput }) => {
        settingsController.queueThemeCommand(rawInput)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'workspace',
      description: 'Choose or add a workspace and start a fresh session there',
      input: { hint: '[directory]' },
      handler: ({ rawInput }) => {
        workspaceController.queueWorkspaceCommand(rawInput)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'status',
      description: 'Show session status and token usage',
      handler: () => { showStatus(); return { kind: 'success' } },
    })
    const exitHandler = (): CommandResult => {
      requestExit()
      return { kind: 'success' }
    }
    commandCtx.commands.register({
      name: 'exit',
      description: 'Exit after the active turn reaches idle',
      handler: exitHandler,
    })
    commandCtx.commands.register({
      name: 'quit',
      description: 'Exit after the active turn reaches idle',
      handler: exitHandler,
    })
  })
  const fileReferencePromptFiber = agent.ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'ui:tui-file-reference',
      order: 99,
      // Tool visibility can change dynamically or by agent scope. Empty
      // sections are omitted by renderPrompt, so guidance never names a tool
      // that this agent cannot call.
      text: () => agent.ctx.tools.get('read', agent) === undefined ? '' : FILE_REFERENCE_PROMPT,
    })
  })

  runCommand = (text: string): void => {
    if (text.trim() === '/permissions' && ctx.get('permissionPresets') !== undefined) {
      showPermissionsSelector()
      return
    }
    const controller = new AbortController()
    commandControllers.add(controller)
    void ctx.commands.execute(agent, text, controller.signal).then(
      (execution) => {
        if (disposed) return
        if (execution === undefined) {
          appendNotice(`Unknown command: ${text}`, 'warning')
        } else if (execution.result.text !== undefined && execution.result.text !== '') {
          appendNotice(execution.result.text, execution.result.kind === 'error' ? 'error' : 'info')
        }
      },
      (error: unknown) => {
        if (!disposed) {
          appendNotice(`Command failed: ${errorChain(error)}`, 'error')
        }
      },
    ).finally(() => { commandControllers.delete(controller) })
  }

  const dispatchMessage = (content: ContentBlock[], attachedContext?: UserMessage): void => {
    if (disposed) {
      appendNotice(`Agent "${agent.id}" is disposed.`, 'error')
      return
    }
    if (agent.status === 'running') {
      // Steering is never subject to prompt admission; an attached snapshot
      // drains beside it at the same step boundary through the outbox.
      if (attachedContext !== undefined) {
        agent.inject(attachedContext)
      }
      const message = createUserMessage({ content, source: { kind: 'user' } })
      agent.steer(message)
      pendingSteering.add(message.id)
      refreshStatus()
      return
    }
    if (attachedContext === undefined) {
      agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
      return
    }
    // The current runtime has no pre-admission waterfall: both messages enter
    // the canonical agent inbox synchronously, and the injected snapshot is
    // claimed beside the next user turn.
    agent.inject(attachedContext)
    agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
  }

  /** Deliver a user turn to the agent: steer while running, send while idle, or report a disposed agent. */
  const deliver = (payload: string): void => {
    dispatchMessage([{ type: 'text', text: payload }])
  }

  /** Load a manually invoked skill and deliver its rendered body as a user turn, reporting lookup outcomes as notices. */
  invokeSkill = (name: string, instructions: string): void => {
    if (skills === undefined) {
      appendNotice('Skills are not available in this session.', 'warning')
      return
    }
    const lookup = { cwd, scope: agent, signal: skillAbort.signal }
    const reportFailure = (error: unknown): void => {
      if (disposed) return
      appendNotice(`Skill "${name}" failed to load: ${errorChain(error)}`, 'error')
    }
    skills.list(lookup).then(
      (summaries) => {
        if (disposed) return
        const summary = summaries.find(skill => skill.name === name)
        if (summary === undefined) {
          appendNotice(`Unknown skill: ${name}`, 'warning')
          return
        }
        if (!summary.invocation.userInvocable) {
          appendNotice(`Skill "${name}" is not available for user invocation.`, 'warning')
          return
        }
        skills.get(name, lookup).then(
          (skill) => {
            if (disposed) return
            if (skill === undefined) {
              appendNotice(`Unknown skill: ${name}`, 'warning')
              return
            }
            if (!skill.invocation.userInvocable) {
              appendNotice(`Skill "${name}" is not available for user invocation.`, 'warning')
              return
            }
            deliver(renderSkillInvocation(skill, instructions))
          },
          reportFailure,
        )
      },
      reportFailure,
    )
  }

  // EXPERIMENTAL, dev-only: manually re-read every file-backed loader config
  // tree and apply the diff to the running app — the same path the HMR
  // watcher's config-change branch drives, minus the watcher. Useful when the
  // watcher misses an edit (replace-by-rename saves) or HMR is not mounted.
  // Module-source hot reload stays watcher-owned; this refreshes configs only.
  let reloadInFlight = false
  const runReload = (): void => {
    // Idle-only: a reload can dispose and re-mount entries mid-flight; doing
    // that under an active turn could tear tools or the adapter out from
    // under in-flight calls. Idleness is advisory (a send can race in after
    // the check), but it removes the common footgun.
    if (agent.status !== 'idle') {
      appendNotice(`/reload requires an idle agent (status: ${agent.status}).`, 'warning')
      return
    }
    // Re-entrancy guard: concurrent refreshes over a genuinely changed file
    // would race unmutexed tree updates (create/remove interleaving); one
    // reload at a time keeps the update pass single-writer.
    if (reloadInFlight) {
      appendNotice('A config reload is already running.', 'warning')
      return
    }

    // Optional-service lookup: the TUI must not depend on the Loader (tests
    // and embedders run without one), so `loader` stays out of `inject` and
    // is read through the non-throwing `ctx.get` accessor — a bare `ctx.loader`
    // proxy read would throw `cannot get property without inject` in a fiber.
    const loader = ctx.get('loader') as { entries(): Iterable<{ subtree?: { refresh?(): Promise<void> } }> } | undefined
    if (loader === undefined) {
      appendNotice('/reload needs the cordis Loader; this runtime has none.', 'warning')
      return
    }
    const refreshes: Promise<void>[] = []
    for (const entry of loader.entries()) {
      if (entry.subtree?.refresh !== undefined) refreshes.push(entry.subtree.refresh())
    }
    reloadInFlight = true
    appendNotice(`Reloading ${refreshes.length} config tree(s)… (experimental)`)
    // refresh() never rejects (it warns and keeps the running tree), so the
    // join can only fulfill; the catch arm guards a future contract change.
    void Promise.all(refreshes).then(() => {
      appendNotice('Config reload complete. Unchanged files were skipped; invalid files keep the running tree (see logs).')
    }).catch((error: unknown) => {
      appendNotice(`Config reload failed: ${errorChain(error)}`, 'error')
    }).finally(() => {
      reloadInFlight = false
    })
  }

  editor.onSubmit = (value: string) => {
    const text = value.trim()
    if (text === '') return
    transcriptViewport.followTail()
    const restoreSubmittedInput = (): void => {
      if (editor.getText() === '') editor.setText(value)
    }
    // `/skill:<name>` carries a colon, which the command registry's name
    // grammar rejects, so it is intercepted before generic command routing.
    if (text.startsWith(SKILL_COMMAND_PREFIX)) {
      editor.addToHistory(text)
      editor.setText('')
      const { name: skillName, instructions } = parseSkillCommand(text)
      if (skillName === '') appendNotice('Usage: /skill:<name> [instructions]', 'warning')
      else invokeSkill(skillName, instructions)
      return
    }
    if (value.startsWith('/')) {
      editor.addToHistory(text)
      editor.setText('')
      runCommand(value)
      return
    }
    let parsed: ReturnType<typeof parseSessionReferenceText>
    try {
      parsed = parseSessionReferenceText(text)
    } catch (error: unknown) {
      restoreSubmittedInput()
      appendNotice(`Invalid session reference: ${errorChain(error)}`, 'error')
      return
    }
    if (parsed.references.length === 0) {
      editor.addToHistory(text)
      editor.setText('')
      dispatchMessage([{ type: 'text', text: parsed.text }])
      return
    }
    const sessionReferences = ctx.get('sessionReferenceResolver')
    if (sessionReferences === undefined) {
      restoreSubmittedInput()
      appendNotice('Session reference capability unavailable.', 'error')
      return
    }
    const controller = new AbortController()
    referenceControllers.add(controller)
    editor.disableSubmit = true
    void sessionReferences.prepare(
      agent,
      [{ type: 'text', text: parsed.text }],
      parsed.references,
      controller.signal,
    ).then((prepared) => {
      if (disposed) return
      editor.addToHistory(text)
      if (editor.getText() === value) editor.setText('')
      // Keep the prepared snapshot and readable prompt on the same synchronous
      // dispatch path; the current runtime has no separate admission waterfall.
      dispatchMessage(prepared.content, prepared.additionalContext)
    }, (error: unknown) => {
      if (!disposed && !controller.signal.aborted) {
        restoreSubmittedInput()
        appendNotice(`Session reference failed: ${errorChain(error)}`, 'error')
      }
    }).finally(() => {
      referenceControllers.delete(controller)
      editor.disableSubmit = false
      requestRender()
    })
  }

  const promptMouseTarget = (valueName: string): { row: number; firstColumn: number; lastColumn: number } | undefined => {
    if (!resolved.fullscreen || !resolved.mouse) return undefined
    const width = runtime.terminal.columns
    const value = ctx.tuiPrompt.get(valueName)
    if (value === undefined) return undefined
    const marker = '\ue000'.repeat(Math.max(1, visibleWidth(value)))
    const markerValue = (name: string): string | undefined =>
      name === valueName ? marker : ctx.tuiPrompt.get(name)
    const right = truncateToWidth(renderTuiPromptTemplate(
      parseTuiPromptTemplate(displayInlineText(resolved.theme.rightPrompt)),
      markerValue,
    ), width, '')
    const rightWidth = visibleWidth(right)
    const leftCapacity = Math.max(0, width - rightWidth - (rightWidth === 0 ? 0 : 2))
    const left = truncateToWidth(renderTuiPromptTemplate(
      parseTuiPromptTemplate(displayInlineText(resolved.theme.leftPrompt)),
      markerValue,
    ), leftCapacity, '')
    const targetLine = rightWidth === 0
      ? left
      : `${left}${' '.repeat(Math.max(0, width - visibleWidth(left) - rightWidth))}${right}`
    const markerIndex = targetLine.indexOf(marker)
    if (markerIndex < 0) return undefined
    const firstColumn = visibleWidth(targetLine.slice(0, markerIndex)) + 1
    const allRows = ui.render(width)
    const statusRows = promptContext.render(width).length
    const statsRows = sessionStatsLine.render(width).length
    const absoluteRow = allRows.length - statsRows - statusRows
    const viewportTop = Math.max(0, allRows.length - runtime.terminal.rows)
    const row = absoluteRow - viewportTop + 1
    if (row < 1 || row > runtime.terminal.rows) return undefined
    return { row, firstColumn, lastColumn: firstColumn + visibleWidth(value) - 1 }
  }

  const removeInputListener = ui.addInputListener((data) => {
    // A click or keystroke starts a fresh visible phase immediately; the
    // periodic timer will hide it again after one complete blink interval.
    if (editor.focused && resolved.showHardwareCursor) {
      editor.cursorVisible = true
      editor.invalidate()
      ui.requestRender()
    }
    const mouseEvent = parseTuiMouseEvent(data)
    if (mouseEvent !== undefined && resolved.fullscreen && resolved.mouse) {
      if (overlayManager.hasActiveOverlay() && mouseEvent.action === 'wheel') {
        return { data: mouseEvent.button === 'wheel-up' ? '\x1b[A' : '\x1b[B' }
      }
      if (!overlayManager.hasActiveOverlay() && editor.isShowingAutocomplete() && mouseEvent.action === 'wheel') {
        return { data: mouseEvent.button === 'wheel-up' ? '\x1b[A' : '\x1b[B' }
      }
      if (!overlayManager.hasActiveOverlay() && mouseEvent.action === 'wheel') {
        transcriptViewport.scrollRows(mouseEvent.button === 'wheel-up' ? -3 : 3)
        requestRender()
        return { consume: true }
      }
      const detailsTarget = promptMouseTarget('details')
      const modelTarget = promptMouseTarget('model')
      if (!overlayManager.hasActiveOverlay() && mouseEvent.action === 'press' && mouseEvent.button === 'left'
        && detailsTarget !== undefined && mouseEvent.row === detailsTarget.row
        && mouseEvent.column >= detailsTarget.firstColumn && mouseEvent.column <= detailsTarget.lastColumn) {
        toggleAllDetails()
      } else if (!overlayManager.hasActiveOverlay() && mouseEvent.action === 'press' && mouseEvent.button === 'left'
        && modelTarget !== undefined && mouseEvent.row === modelTarget.row
        && mouseEvent.column >= modelTarget.firstColumn && mouseEvent.column <= modelTarget.lastColumn) {
        modelController.queueModelCommand('')
      }
      return { consume: true }
    }
    if (overlayManager.hasActiveOverlay()) return undefined
    if (resolved.fullscreen && matchesKey(data, Key.pageUp)) {
      transcriptViewport.page(-1)
      requestRender()
      return { consume: true }
    }
    if (resolved.fullscreen && matchesKey(data, Key.pageDown)) {
      transcriptViewport.page(1)
      requestRender()
      return { consume: true }
    }
    if (resolved.fullscreen && matchesKey(data, Key.ctrl(Key.end))) {
      transcriptViewport.followTail()
      requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.alt('m'))) {
      modelController.queueModelCommand('')
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      toggleTools()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('r'))) {
      toggleReasoning()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('l'))) {
      ui.invalidate()
      ui.requestRender(true)
      return { consume: true }
    }
    if (matchesKey(data, Key.escape) && agent.status === 'running') {
      agent.cancel({ kind: 'user' })
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('c'))) {
      if (agent.status === 'running') {
        agent.cancel({ kind: 'user' })
      } else if (editor.getText() !== '') {
        editor.setText('')
      } else {
        requestExit()
      }
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      if (agent.status === 'running') appendNotice('Cancel the active turn before exiting.', 'warning')
      else requestExit()
      return { consume: true }
    }
    if (keymap === 'vim') {
      if (vimState === 'insert') {
        if (matchesKey(data, Key.escape)) {
          vimState = 'normal'
          vimPending = ''
          refreshEditorFooter()
          requestRender()
          return { consume: true }
        }
        return undefined
      }
      if (data === 'i') {
        vimState = 'insert'
      } else if (data === 'a') {
        editor.handleInput('\x1b[C')
        vimState = 'insert'
      } else if (data === 'h') editor.handleInput('\x1b[D')
      else if (data === 'j') editor.handleInput('\x1b[B')
      else if (data === 'k') editor.handleInput('\x1b[A')
      else if (data === 'l') editor.handleInput('\x1b[C')
      else if (data === 'w') editor.handleInput('\x1bf')
      else if (data === 'b') editor.handleInput('\x1bb')
      else if (data === '0') editor.handleInput('\x01')
      else if (data === '$') editor.handleInput('\x05')
      else if (data === 'x') editor.handleInput('\x1b[3~')
      else if (data === 'o') {
        editor.handleInput('\x05')
        editor.handleInput('\x1b[13;2~')
        vimState = 'insert'
      } else if (data === '/') {
        vimState = 'insert'
        editor.handleInput('/')
      } else if (data === 'd') {
        if (vimPending === 'd') {
          editor.handleInput('\x01')
          editor.handleInput('\x0b')
          vimPending = ''
        } else vimPending = 'd'
        refreshEditorFooter()
        requestRender()
        return { consume: true }
      }
      vimPending = ''
      refreshEditorFooter()
      requestRender()
      return { consume: true }
    }
    return undefined
  })

  const disposeSessionEvents = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'tool/result') fileSearch.invalidate()
    recordEventUsage(tokens, event)
    if (event.type === 'turn/start' && runningStatus !== undefined) runningStatus.turn = event.data.turn
    // Track live standalone compaction state.
    if (event.type === 'compaction/start' && event.data.turn === null) {
      if (compacting === undefined) {
        const startedAt = now()
        compacting = {
          startedAt,
          timer: setInterval(renderStatus, STATUS_ANIMATION_INTERVAL_MS),
        }
        runtime.terminal.setProgress(true)
      }
      requestRender()
      return
    }
    if (event.type === 'compaction/end' && event.data.turn === null && compacting !== undefined) {
      const fadeOutGlyph = runningPhaseGlyph(agent.session.events, false, true)
      clearInterval(compacting.timer)
      compacting = undefined
      if (event.data.error !== undefined) {
        appendNotice(`Compaction failed: ${event.data.error}`, 'warning')
      }
      // A concurrently running turn owns the indicator. Keep its timer and
      // progress bit instead of letting the compaction fade clear that state.
      if (runningStatus === undefined && fadeOutGlyph !== undefined) beginFadeOut(fadeOutGlyph)
      requestRender()
      return
    }
    // A replacement mutates only the model surface, so the rendered transcript
    // keeps what it already showed; a landed summary checkpoint adds its marker.
    if (isReplacementSurfaceEvent(event)) {
      if (isCompactCheckpoint(event)) renderCompactionMarker()
      requestRender()
      return
    }
    renderEvent(event, { addHistory: false, renderChunks: true })
    requestRender()
  })
  const settlePendingSteering = (id: MessageId): void => {
    if (pendingSteering.delete(id)) refreshStatus()
  }
  const disposeDequeued = ctx.on('agent/inbox/claimed', ({ agent: subject, message }) => {
    if (subject === agent) settlePendingSteering(message.id)
  })
  const disposeDiscarded = ctx.on('agent/inbox/discarded', ({ agent: subject, message }) => {
    if (subject !== agent) return
    if (pendingSteering.delete(message.id)) refreshStatus()
  })
  const disposeStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject !== agent) return
    // Leaving 'running' ends the turn's status line; clear any badge so the
    // next running turn starts from zero (and a cancellation, which discards
    // the queue without logging drains, cannot strand a stale count).
    if (status !== 'running') pendingSteering.clear()
    setStatus(status)
  })
  const disposeError = ctx.on('agent/error', ({ agent: subject, turn, step, error }) => {
    if (subject !== agent) return
    liveErrors.add(`${turn}:${step}`)
    // Full cause chain: wrapper messages like `fetch failed` carry the
    // actionable transport detail on `cause`.
    appendNotice(errorChain(error), 'error')
  })
  const disposeAgent = ctx.on('agent/disposed', ({ agent: subject }) => {
    if (subject !== agent) return
    // The agent left the registry (e.g. an agent-loop-only reload) while the
    // TUI stays mounted. Retained agents accept deliveries after detachment, so
    // without this a later send would drive a zombie agent/session; mark
    // disposed so dispatchMessage reports it instead.
    // The hard clear also retires live compaction. A later compact/end is
    // intentionally presentation-silent: this disposal notice owns the
    // terminal outcome, and no animation may survive agent detachment.
    clearStatus()
    appendNotice(`Agent "${agent.id}" was disposed.`, 'warning')
    disposed = true
  })

  const detachListeners = (): void => {
    skillAbort.abort()
    fileSearch.dispose()
    removeInputListener()
    disposeCommandChanges()
    disposeSkillChanges()
    disposePromptChanges()
    for (const value of promptValues) value.dispose()
    stopBannerReveal()
    disposeSessionEvents()
    disposeDequeued()
    disposeDiscarded()
    disposeStatus()
    disposeError()
    disposeAgent()
    disposeSchemeListener()
    settingsController.detach()
    disposeTargetListeners()
    modelController.detach()
  }

  // Sweep reveal of the whole banner: the header wipes in left-to-right over
  // ~BANNER_REVEAL_STEPS frames (started after `ui.start()` succeeds).
  // Configured subtitles skip it so deployments (and snapshot fixtures) stay
  // frame-deterministic.
  let revealTimer: ReturnType<typeof setInterval> | undefined
  const stopBannerReveal = (): void => {
    if (revealTimer === undefined) return
    clearInterval(revealTimer)
    revealTimer = undefined
    header.setRevealWidth(undefined)
  }
  const startBannerReveal = (): void => {
    if (config.welcome !== undefined) return
    const total = Math.max(1, runtime.terminal.columns)
    const step = Math.max(1, Math.ceil(total / BANNER_REVEAL_STEPS))
    let shown = 0
    header.setRevealWidth(0)
    revealTimer = setInterval(() => {
      shown += step
      if (shown >= total) {
        stopBannerReveal()
      } else {
        header.setRevealWidth(shown)
      }
      requestRender()
    }, BANNER_REVEAL_INTERVAL_MS)
  }

  rebuildTranscript(true)
  const restoredGoal = foldGoal(agent.session.events).goal
  /* v8 ignore next -- goal replay coverage lives with the goal seam; the TUI only formats its startup notice. */
  if (restoredGoal !== undefined && restoredGoal.phase !== 'complete') {
    appendNotice(
      `Goal restored (${restoredGoal.phase}) with automatic continuation disarmed. `
      + 'Human confirmation is required; send “继续” or run /goal resume.',
      'warning',
    )
  }
  setStatus(agent.status)
  try {
    acquireTerminal()
  } catch (error: unknown) {
    disposed = true
    detachListeners()
    void Promise.all([
      commandFiber.dispose(),
      fileReferencePromptFiber.dispose(),
    ]).catch(
      /* v8 ignore next 2 -- command registration cleanup is non-throwing; this guards a future disposer regression */
      (cleanupError: unknown) => {
        ctx.logger.warn(`ui-tui: scoped cleanup after startup failure failed: ${errorChain(cleanupError)}`)
      },
    )
    clearStatus()
    questions.unregister()
    approvals.cancelAll()
    approvals.unregister()
    releaseTerminal()
    throw error
  }
  tuiServiceFiber = ctx.inject([], (serviceCtx) => {
    new TuiExtensionServiceImpl(serviceCtx, agent, overlayManager)
  })
  startBannerReveal()

  // Invoke an embedding-selected skill exactly as a typed `/skill:<name>` once
  // the chat is live and the agent is idle. The embedding owns fresh/resume
  // selection; invokeSkill reports an unknown skill as a notice.
  if (config.initialSkill !== undefined) invokeSkill(config.initialSkill, '')

  return {
    async dispose(): Promise<void> {
      detachListeners()
      await shutdown(false)
      await Promise.all([
        commandFiber.dispose(),
        fileReferencePromptFiber.dispose(),
      ])
    },
  }
}

/**
 * Open the pi-tui channel once its configured agent exists.
 *
 * @param ctx - Context supplying the agent registry, tools, and event stream.
 * @param config - Target agent and presentation configuration.
 * @param runtime - Terminal and process-exit boundary.
 */
export function mountTui(ctx: Context, config: Config, runtime: TuiRuntime): void {
  const sessionId = SessionId(config.sessionId ?? 'main')
  const matchesConfiguredIdentity = (agent: Agent): boolean =>
    agent.id === sessionId && ctx.agents.roots().includes(agent)
  let settled = false

  const stopWaiting = (): void => {
    disposeCreated()
    disposeFailure()
  }
  const start = (agent: Agent): void => {
    if (settled || !matchesConfiguredIdentity(agent)) return
    settled = true
    stopWaiting()
    ctx.effect(() => {
      const controller = createTuiChat(ctx, config, runtime)
      return () => controller.dispose()
    }, 'ui-tui')
  }
  const fail = (failedSessionId: SessionId, error: unknown): void => {
    if (settled || failedSessionId !== sessionId) return
    settled = true
    stopWaiting()
    runtime.terminal.write(displayText(`ui-tui: session "${sessionId}" failed to start: ${errorChain(error)}\n`))
    runtime.exit(1)
  }

  const disposeCreated = ctx.on('agent/created', ({ agent }) => { start(agent) })
  const disposeFailure = ctx.on('agent-loop/config-start-failed', ({ sessionId: failedSessionId, error }) => {
    fail(failedSessionId, error)
  })
  const existing = ctx.agents.roots().find(agent => agent.id === sessionId)
  if (existing !== undefined) start(existing)
}

const ROOT_DISPOSE_TIMEOUT_MS = 5_000

/**
 * Dispose the whole application before process exit, with a bounded fallback.
 * @param ctx - The TUI plugin context whose root owns sibling resources.
 * @param code - Process status to report.
 * @param exit - Exit boundary, replaceable by tests.
 */
export function disposeRootAndExit(
  ctx: Context,
  code: number,
  exit: (status: number) => void = (status) => { process.exit(status) },
): void {
  let exited = false
  const exitOnce = (): void => {
    if (exited) return
    exited = true
    exit(code)
  }
  const timeout = setTimeout(exitOnce, ROOT_DISPOSE_TIMEOUT_MS)
  void ctx.root.fiber.dispose().then(
    () => { clearTimeout(timeout); exitOnce() },
    () => { clearTimeout(timeout); exitOnce() },
  )
}

/** Cordis entry point using the process terminal; explicit TUI composition requires a TTY pair. */
/* v8 ignore start -- production process wiring; fake-terminal tests cover mountTui/createTuiChat,
   and apps/cli PTY smokes cover the real entry */
export function apply(ctx: Context, config: Config): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('ui-tui: both stdin and stdout must be TTYs; use the one-shot @deepseek-ai/dsh-cli-demo app for pipes')
  }
  // Truecolor is a terminal capability, so detect it here at the process
  // boundary from COLORTERM; an explicit theme value still wins.
  const truecolor = config.theme?.truecolor ?? ['truecolor', '24bit'].includes(process.env.COLORTERM ?? '')
  const resumeHost = ctx.get('tuiResumeHost')
  const startWorkspace = resumeHost?.start?.bind(resumeHost)
  const goodbyeMessage = ctx.get('tuiGoodbyeMessage')
  // The launcher seeds a guided fresh session's first turn through this key; a
  // config value still wins. Consumed in createTuiChat via config.initialSkill.
  const initialSkill = config.initialSkill ?? ctx.get('tuiInitialSkill')
  mountTui(ctx, Object.assign(
    {},
    config,
    { theme: Object.assign({}, config.theme, { truecolor }) },
    initialSkill === undefined ? {} : { initialSkill },
  ), {
    terminal: new ProcessTerminal(),
    exit: (code) => { disposeRootAndExit(ctx, code) },
    ...resumeHost === undefined ? {} : { handoffResume: (sessionId, cwd) => resumeHost.handoff(sessionId, cwd) },
    ...startWorkspace === undefined ? {} : { handoffWorkspace: cwd => startWorkspace(cwd) },
    ...goodbyeMessage === undefined ? {} : { goodbyeMessage },
  })
}
/* v8 ignore stop */
