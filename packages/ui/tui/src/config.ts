/**
 * Serializable configuration and defaults for the pi-tui terminal mode. Loader
 * schema validation normally fills defaults; {@link resolveTuiConfig} applies
 * the same defaults for direct callers that bypass the Loader.
 * @module @deepseek-ai/dsh-tui/config
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
} from './chat/file-autocomplete.ts'

/** Theme and prompt-template settings for the pi-tui terminal mode. */
export interface TuiThemeConfig {
  /** Apply the built-in ANSI color palette. */
  color?: boolean
  /** Paint the startup banner with the 24-bit DeepSeek brand gradient. */
  truecolor?: boolean
  /** Left-aligned template on the row above the editor. */
  leftPrompt?: string
  /** Right-aligned template on the row above the editor. */
  rightPrompt?: string
  /** Template used as the editor's first-line prefix. */
  inputPrompt?: string
  /** Static placeholder shown in an empty editor. */
  inputPlaceholder?: string
}

/** Interaction and presentation settings for the pi-tui terminal mode. */
export interface TuiConfig {
  /** Render in the terminal's alternate screen and restore the prior screen on exit. */
  fullscreen?: boolean
  /** Capture wheel and click input; disabled by default so the terminal owns text selection. */
  mouse?: boolean
  /** Render model reasoning blocks. */
  showReasoning?: boolean
  /** Maximum tool-card body lines retained in its collapsed head/tail preview. */
  maxToolOutputLines?: number
  /** Maximum added and removed lines explored while deriving an exact line diff. */
  maxDiffEditLength?: number
  /** Maximum options visible at once in a user-question panel. */
  maxQuestionOptions?: number
  /** Maximum models visible at once in the model selector. */
  maxModelOptions?: number
  /** Maximum sessions visible at once in the resume selector. */
  maxResumeOptions?: number
  /** Maximum concurrent cold projection reads in one resume scan. */
  resumeScanConcurrency?: number
  /** User-question panel width in terminal columns, clamped to the terminal. */
  questionDialogWidth?: number
  /** User-question panel maximum height in terminal rows. */
  questionDialogMaxHeight?: number
  /** Model-selector width in terminal columns. */
  modelDialogWidth?: number
  /** Model-selector maximum height in terminal rows. */
  modelDialogMaxHeight?: number
  /** Transcript-details selector width in terminal columns. */
  detailsDialogWidth?: number
  /** Maximum fuzzy file candidates displayed for one `@` query. */
  fileSearchMaxResults?: number
  /** Maximum paths retained in one `@` workspace index. */
  fileSearchMaxEntries?: number
  /** Directory basenames excluded from `@` traversal and completion. */
  fileSearchExcludedDirectories?: string[]
  /** Show a software-blinking caret while retaining pi-tui's IME cursor marker. */
  showHardwareCursor?: boolean
  /** Color and prompt-template settings. */
  theme?: TuiThemeConfig
  /** Terminal window title while the UI is mounted; a logged session title prefixes it. */
  title?: string
}

const showReasoningSchema = z.boolean().default(true)
const fullscreenSchema = z.boolean().default(false)
const mouseSchema = z.boolean().default(false)
const maxToolOutputLinesSchema = z.number().step(1).min(1).default(6)
const maxDiffEditLengthSchema = z.number().step(1).min(1).default(1000)
const maxQuestionOptionsSchema = z.number().step(1).min(1).default(8)
const maxModelOptionsSchema = z.number().step(1).min(1).default(8)
const maxResumeOptionsSchema = z.number().step(1).min(1).default(8)
const resumeScanConcurrencySchema = z.number().step(1).min(1).default(4)
const questionDialogWidthSchema = z.number().step(1).min(20).default(200)
const questionDialogMaxHeightSchema = z.number().step(1).min(6).default(20)
const modelDialogWidthSchema = z.number().step(1).min(20).default(76)
const modelDialogMaxHeightSchema = z.number().step(1).min(6).default(20)
const detailsDialogWidthSchema = z.number().step(1).min(20).default(72)
const fileSearchMaxResultsSchema = z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_RESULTS)
const fileSearchMaxEntriesSchema = z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_ENTRIES)
const fileSearchExcludedDirectoriesSchema = z.array(z.string()).default([...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES])
const showHardwareCursorSchema = z.boolean().default(true)
const colorSchema = z.boolean().default(true)
// No default: an unset value auto-detects truecolor from COLORTERM in `apply`.
const truecolorSchema = z.boolean()
const DEFAULT_LEFT_PROMPT = '${cwd}${git/worktree}'
const DEFAULT_RIGHT_PROMPT = '${goal}${details}${status}${model}${token_meter/cache_hit_rate}${context}${queued}'
const DEFAULT_INPUT_PROMPT = '${indicator}'
const DEFAULT_INPUT_PLACEHOLDER = 'Describe a task, @ a file, or / for commands'
const TuiThemeConfigSchema: z<TuiThemeConfig> = z.object({
  color: colorSchema,
  truecolor: truecolorSchema,
  leftPrompt: z.string().default(DEFAULT_LEFT_PROMPT),
  rightPrompt: z.string().default(DEFAULT_RIGHT_PROMPT),
  inputPrompt: z.string().default(DEFAULT_INPUT_PROMPT),
  inputPlaceholder: z.string().default(DEFAULT_INPUT_PLACEHOLDER),
})
const titleSchema = z.string().default('DeepSeek Harness')

const tuiConfigSchemaFields = {
  fullscreen: fullscreenSchema,
  mouse: mouseSchema,
  showReasoning: showReasoningSchema,
  maxToolOutputLines: maxToolOutputLinesSchema,
  maxDiffEditLength: maxDiffEditLengthSchema,
  maxQuestionOptions: maxQuestionOptionsSchema,
  maxModelOptions: maxModelOptionsSchema,
  maxResumeOptions: maxResumeOptionsSchema,
  resumeScanConcurrency: resumeScanConcurrencySchema,
  questionDialogWidth: questionDialogWidthSchema,
  questionDialogMaxHeight: questionDialogMaxHeightSchema,
  modelDialogWidth: modelDialogWidthSchema,
  modelDialogMaxHeight: modelDialogMaxHeightSchema,
  detailsDialogWidth: detailsDialogWidthSchema,
  fileSearchMaxResults: fileSearchMaxResultsSchema,
  fileSearchMaxEntries: fileSearchMaxEntriesSchema,
  fileSearchExcludedDirectories: fileSearchExcludedDirectoriesSchema,
  showHardwareCursor: showHardwareCursorSchema,
  theme: TuiThemeConfigSchema,
  title: titleSchema,
}

/** Schemastery schema for presentation settings embedded by app bundles. */
export const TuiConfigSchema: z<TuiConfig> = z.object(tuiConfigSchemaFields)

/** Serializable plugin configuration. */
export interface Config extends TuiConfig {
  /** Exact shared agent/session identity driven by this terminal. Defaults to `main`. */
  sessionId?: string
  /**
   * Skill name auto-invoked as this session's first user turn, exactly as if
   * the user typed `/skill:<name>`. Embeddings that want fresh-session-only
   * behavior must omit it when resuming; absent leaves the first turn to the user.
   */
  initialSkill?: string
}

/** Schemastery schema for the full plugin configuration. */
export const Config: z<Config> = z.object({
  sessionId: z.string().default('main'),
  initialSkill: z.string(),
  fullscreen: tuiConfigSchemaFields.fullscreen,
  mouse: tuiConfigSchemaFields.mouse,
  showReasoning: tuiConfigSchemaFields.showReasoning,
  maxToolOutputLines: tuiConfigSchemaFields.maxToolOutputLines,
  maxDiffEditLength: tuiConfigSchemaFields.maxDiffEditLength,
  maxQuestionOptions: tuiConfigSchemaFields.maxQuestionOptions,
  maxModelOptions: tuiConfigSchemaFields.maxModelOptions,
  maxResumeOptions: tuiConfigSchemaFields.maxResumeOptions,
  resumeScanConcurrency: tuiConfigSchemaFields.resumeScanConcurrency,
  questionDialogWidth: tuiConfigSchemaFields.questionDialogWidth,
  questionDialogMaxHeight: tuiConfigSchemaFields.questionDialogMaxHeight,
  modelDialogWidth: tuiConfigSchemaFields.modelDialogWidth,
  modelDialogMaxHeight: tuiConfigSchemaFields.modelDialogMaxHeight,
  detailsDialogWidth: tuiConfigSchemaFields.detailsDialogWidth,
  fileSearchMaxResults: tuiConfigSchemaFields.fileSearchMaxResults,
  fileSearchMaxEntries: tuiConfigSchemaFields.fileSearchMaxEntries,
  fileSearchExcludedDirectories: tuiConfigSchemaFields.fileSearchExcludedDirectories,
  showHardwareCursor: tuiConfigSchemaFields.showHardwareCursor,
  theme: tuiConfigSchemaFields.theme,
  title: tuiConfigSchemaFields.title,
})

/** Fully defaulted TUI theme settings. */
export interface ResolvedTuiThemeConfig {
  color: boolean
  truecolor: boolean
  leftPrompt: string
  rightPrompt: string
  inputPrompt: string
  inputPlaceholder: string
}

/** Fully defaulted TUI presentation settings. */
export interface ResolvedTuiConfig {
  fullscreen: boolean
  mouse: boolean
  showReasoning: boolean
  maxToolOutputLines: number
  maxDiffEditLength: number
  maxQuestionOptions: number
  maxModelOptions: number
  maxResumeOptions: number
  resumeScanConcurrency: number
  questionDialogWidth: number
  questionDialogMaxHeight: number
  modelDialogWidth: number
  modelDialogMaxHeight: number
  detailsDialogWidth: number
  fileSearchMaxResults: number
  fileSearchMaxEntries: number
  fileSearchExcludedDirectories: string[]
  showHardwareCursor: boolean
  theme: ResolvedTuiThemeConfig
  title: string
}

/**
 * Apply direct-call defaults after Loader schema validation has normally run.
 *
 * @param config - Deployment-provided terminal presentation settings.
 * @returns Complete settings consumed by the TUI renderer.
 */
export function resolveTuiConfig(config: TuiConfig | undefined): ResolvedTuiConfig {
  return {
    fullscreen: config?.fullscreen ?? false,
    mouse: config?.mouse ?? false,
    showReasoning: config?.showReasoning ?? true,
    maxToolOutputLines: config?.maxToolOutputLines ?? 6,
    maxDiffEditLength: config?.maxDiffEditLength ?? 1000,
    maxQuestionOptions: config?.maxQuestionOptions ?? 8,
    maxModelOptions: config?.maxModelOptions ?? 8,
    maxResumeOptions: config?.maxResumeOptions ?? 8,
    resumeScanConcurrency: config?.resumeScanConcurrency ?? 4,
    questionDialogWidth: config?.questionDialogWidth ?? 200,
    questionDialogMaxHeight: config?.questionDialogMaxHeight ?? 20,
    modelDialogWidth: config?.modelDialogWidth ?? 76,
    modelDialogMaxHeight: config?.modelDialogMaxHeight ?? 20,
    detailsDialogWidth: config?.detailsDialogWidth ?? 72,
    fileSearchMaxResults: config?.fileSearchMaxResults ?? DEFAULT_FILE_SEARCH_MAX_RESULTS,
    fileSearchMaxEntries: config?.fileSearchMaxEntries ?? DEFAULT_FILE_SEARCH_MAX_ENTRIES,
    fileSearchExcludedDirectories: [...(config?.fileSearchExcludedDirectories ?? DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES)],
    showHardwareCursor: config?.showHardwareCursor ?? true,
    theme: {
      color: config?.theme?.color ?? true,
      truecolor: config?.theme?.truecolor ?? false,
      leftPrompt: config?.theme?.leftPrompt ?? DEFAULT_LEFT_PROMPT,
      rightPrompt: config?.theme?.rightPrompt ?? DEFAULT_RIGHT_PROMPT,
      inputPrompt: config?.theme?.inputPrompt ?? DEFAULT_INPUT_PROMPT,
      inputPlaceholder: config?.theme?.inputPlaceholder ?? DEFAULT_INPUT_PLACEHOLDER,
    },
    title: config?.title ?? 'DeepSeek Harness',
  }
}
