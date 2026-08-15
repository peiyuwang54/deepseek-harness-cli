/**
 * Shared user-settings surfaces for the terminal channel: a metadata-only
 * Settings hub plus persistent appearance and terminal-presentation selectors.
 * @module @deepseek-ai/dsh-tui/chat/settings
 */

import {
  settingsNamespace,
  type SettingsDescriptor,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import {
  ActionDialog,
  MultiSelectDialog,
  type ActionDialogChoice,
  type MultiSelectDialogChoice,
} from '../components/dialogs.ts'
import {
  ACCENT_HUES,
  ACCENT_IDS,
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_SELECTION,
  accentHue,
  isAccentId,
  type AccentId,
  type AccentSelection,
} from '../components/theme.ts'
import { displayText } from '../components/text.ts'
import type { TuiOverlaySession } from '../extension/types.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'
import {
  TUI_LOCALE_OPTIONS,
  TUI_LOCALE_SETTINGS_NAMESPACE,
  isTuiLocale,
  readTuiLocale,
  resolveTuiLocale,
  tuiCopy,
  tuiLocaleLabel,
  type TuiLocale,
} from './language.ts'

/** Appearance preferences shared with the Web `ui-theme` settings section. */
const TUI_THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Persistent appearance preference accepted by both terminal and Web. */
export type TuiThemePreference = typeof TUI_THEME_PREFERENCES[number]

/** Shared settings namespace registered by the theme Host plugin. */
const TUI_THEME_SETTINGS_NAMESPACE = settingsNamespace('ui-theme')

/** TUI-owned settings namespace for the terminal accent hue. */
const TUI_ACCENT_SETTINGS_NAMESPACE = settingsNamespace('ui-accent')

/** TUI-owned settings namespace for terminal title and status presentation. */
const TUI_TERMINAL_SETTINGS_NAMESPACE = settingsNamespace('ui-terminal')

/** Communication styles exposed by the Codex-shaped `/personality` command. */
export const TUI_PERSONALITIES = ['friendly', 'pragmatic'] as const

/** Persistent communication style applied to model requests from this TUI. */
export type TuiPersonality = typeof TUI_PERSONALITIES[number]

/** Default communication style used before a user stores a preference. */
export const DEFAULT_TUI_PERSONALITY: TuiPersonality = 'friendly'

/** TUI-owned settings namespace for the model communication style. */
export const TUI_PERSONALITY_SETTINGS_NAMESPACE = settingsNamespace('agent-personality')

/** Prompt text contributed for each communication style. */
const PERSONALITY_PROMPTS: Readonly<Record<TuiPersonality, string>> = {
  friendly: 'Communication style: be warm, collaborative, and helpful.',
  pragmatic: 'Communication style: be concise, task-focused, and direct.',
}

/** Stable terminal-title fields accepted by `/title`. */
export const TERMINAL_TITLE_ITEM_IDS = [
  'app-name',
  'session-title',
  'workspace',
  'status',
  'model',
  'reasoning',
  'session-id',
] as const

/** One persisted terminal-title field. */
export type TerminalTitleItem = typeof TERMINAL_TITLE_ITEM_IDS[number]

/** Default terminal title preserves the product's existing session-title-first presentation. */
export const DEFAULT_TERMINAL_TITLE_ITEMS: readonly TerminalTitleItem[] = ['session-title', 'app-name']

/** User-facing catalog for the terminal-title setup dialog. */
const TERMINAL_TITLE_CHOICES: readonly MultiSelectDialogChoice[] = [
  { value: 'app-name', label: 'App name', description: 'DeepSeek Harness' },
  { value: 'session-title', label: 'Session title', description: 'omitted when unnamed' },
  { value: 'workspace', label: 'Workspace', description: 'current working directory' },
  { value: 'status', label: 'Run status', description: 'idle, running, or waiting state' },
  { value: 'model', label: 'Model', description: 'current model name' },
  { value: 'reasoning', label: 'Reasoning effort', description: 'current effort when selected' },
  { value: 'session-id', label: 'Session ID', description: 'full durable session identifier' },
]

/** Stable footer fields accepted by `/statusline`. */
export const STATUS_LINE_ITEM_IDS = [
  'goal',
  'details',
  'status',
  'model',
  'reasoning',
  'tokens',
  'context',
  'queued',
  'preset',
  'permissions',
  'workspace',
  'git-branch',
  'session-title',
  'session-id',
] as const

/** One persisted footer field. */
export type StatusLineItem = typeof STATUS_LINE_ITEM_IDS[number]

/** Product footer fields used before the user creates an override. */
export const DEFAULT_STATUS_LINE_ITEMS: readonly StatusLineItem[] = [
  'goal',
  'details',
  'model',
  'tokens',
  'context',
  'queued',
]

/** User-facing catalog for the ordered footer setup dialog. */
const STATUS_LINE_CHOICES: readonly MultiSelectDialogChoice[] = [
  { value: 'goal', label: 'Goal', description: 'active Goal state and elapsed time' },
  { value: 'details', label: 'Details', description: 'reasoning and tool-card expansion marker' },
  { value: 'status', label: 'Run status', description: 'idle or running state' },
  { value: 'model', label: 'Model', description: 'current model with reasoning effort' },
  { value: 'reasoning', label: 'Reasoning effort', description: 'current effort only' },
  { value: 'tokens', label: 'Tokens', description: 'uncached input and output totals' },
  { value: 'context', label: 'Context', description: 'context-window percentage used' },
  { value: 'queued', label: 'Queued work', description: 'messages waiting while the agent runs' },
  { value: 'preset', label: 'Preset', description: 'active agent preset' },
  { value: 'permissions', label: 'Permissions', description: 'active permission preset' },
  { value: 'workspace', label: 'Workspace', description: 'current working directory' },
  { value: 'git-branch', label: 'Git branch', description: 'omitted outside a Git worktree' },
  { value: 'session-title', label: 'Session title', description: 'omitted when unnamed' },
  { value: 'session-id', label: 'Session ID', description: 'full durable session identifier' },
]

/** Durable accent section schema; also the wire envelope validation against it. */
const AccentSettingsSchema: z<AccentSelection> = z.object({
  light: z.union([...ACCENT_IDS]).default(DEFAULT_ACCENT),
  dark: z.union([...ACCENT_IDS]).default(DEFAULT_ACCENT),
})

/** Durable terminal presentation section. */
interface TerminalPresentationSettings {
  titleItems: TerminalTitleItem[]
  statusLineItems?: StatusLineItem[]
}

/** Durable terminal-presentation schema and file-input validation. */
const TerminalPresentationSettingsSchema: z<TerminalPresentationSettings> = z.object({
  titleItems: z.array(z.union([...TERMINAL_TITLE_ITEM_IDS])).default([...DEFAULT_TERMINAL_TITLE_ITEMS]),
  statusLineItems: z.array(z.union([...STATUS_LINE_ITEM_IDS])),
})

/** Durable communication-style schema. */
const TuiPersonalitySettingsSchema: z<{ preference: TuiPersonality }> = z.object({
  preference: z.union([...TUI_PERSONALITIES]).default(DEFAULT_TUI_PERSONALITY),
})

/**
 * Register the TUI-owned accent and terminal-presentation namespaces on the
 * host settings service when one is composed.
 * @param ctx - Context whose optional settings service owns the section.
 * @param registered - Called after the namespace has loaded its stored value.
 */
export function registerTuiSettingsNamespaces(ctx: Context, registered?: () => void): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(TUI_ACCENT_SETTINGS_NAMESPACE, AccentSettingsSchema)
    settingsCtx.settings.register(TUI_TERMINAL_SETTINGS_NAMESPACE, TerminalPresentationSettingsSchema)
    settingsCtx.settings.register(TUI_PERSONALITY_SETTINGS_NAMESPACE, TuiPersonalitySettingsSchema)
    registered?.()
  })
}

/** Narrow an unknown setting to a supported communication style. */
function isTuiPersonality(value: unknown): value is TuiPersonality {
  return TUI_PERSONALITIES.some(personality => personality === value)
}

/**
 * Read the persistent communication style.
 * @param settings - optional settings provider.
 * @returns stored style or the friendly default.
 */
export function readTuiPersonality(settings: SettingsProvider | undefined): TuiPersonality {
  const section = settings?.get(TUI_PERSONALITY_SETTINGS_NAMESPACE)
  if (typeof section !== 'object' || section === null) return DEFAULT_TUI_PERSONALITY
  const preference = (section as { preference?: unknown }).preference
  return isTuiPersonality(preference) ? preference : DEFAULT_TUI_PERSONALITY
}

/**
 * Resolve the model instruction for one communication style.
 * @param personality - selected communication style.
 * @returns stable English system-prompt instruction.
 */
export function tuiPersonalityPrompt(personality: TuiPersonality): string {
  return PERSONALITY_PROMPTS[personality]
}

/** Narrow one durable terminal-title id. */
function isTerminalTitleItem(value: unknown): value is TerminalTitleItem {
  return TERMINAL_TITLE_ITEM_IDS.some(item => item === value)
}

/** Resolve one durable terminal-presentation section to its valid, de-duplicated title ordering. */
function resolveTitleItems(section: unknown): TerminalTitleItem[] {
  if (typeof section !== 'object' || section === null) return [...DEFAULT_TERMINAL_TITLE_ITEMS]
  const titleItems = (section as { titleItems?: unknown }).titleItems
  if (!Array.isArray(titleItems)) return [...DEFAULT_TERMINAL_TITLE_ITEMS]
  return [...new Set(titleItems.filter(isTerminalTitleItem))]
}

/**
 * Read the terminal-title item ordering, rejecting unknown durable entries and duplicates.
 * @param settings - optional settings provider.
 * @returns persisted item order or the product default.
 */
export function readTuiTitleItems(settings: SettingsProvider | undefined): TerminalTitleItem[] {
  return resolveTitleItems(settings?.get(TUI_TERMINAL_SETTINGS_NAMESPACE))
}

/** Narrow one durable footer id. */
function isStatusLineItem(value: unknown): value is StatusLineItem {
  return STATUS_LINE_ITEM_IDS.some(item => item === value)
}

/** Resolve an optional durable footer override to valid, de-duplicated ordering. */
function resolveStatusLineItems(section: unknown): StatusLineItem[] | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  const items = (section as { statusLineItems?: unknown }).statusLineItems
  if (!Array.isArray(items)) return undefined
  return [...new Set(items.filter(isStatusLineItem))]
}

/**
 * Read the optional footer override; absence preserves the profile's prompt template.
 * @param settings - optional settings provider.
 * @returns persisted footer ordering or `undefined` when the profile template remains active.
 */
export function readTuiStatusLineItems(settings: SettingsProvider | undefined): StatusLineItem[] | undefined {
  return resolveStatusLineItems(settings?.get(TUI_TERMINAL_SETTINGS_NAMESPACE))
}

/** Narrow an unknown settings value to the shared preference vocabulary. */
function isTuiThemePreference(value: unknown): value is TuiThemePreference {
  return TUI_THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Read the persisted per-background accent selection, falling back to the
 * DeepSeek default when the settings service or namespace is not composed.
 * @param settings - optional settings provider.
 * @returns the persisted light/dark accent ids or the product default.
 */
export function readTuiAccent(settings: SettingsProvider | undefined): AccentSelection {
  const section = settings?.get(TUI_ACCENT_SETTINGS_NAMESPACE)
  if (typeof section !== 'object' || section === null) return DEFAULT_ACCENT_SELECTION
  const value = section as { light?: unknown; dark?: unknown }
  return {
    light: isAccentId(value.light) ? value.light : DEFAULT_ACCENT,
    dark: isAccentId(value.dark) ? value.dark : DEFAULT_ACCENT,
  }
}

/**
 * Read the shared appearance preference, falling back to `system` when the
 * settings service or namespace is not composed.
 * @param settings - optional settings provider.
 * @returns the persisted preference or its product default.
 */
export function readTuiThemePreference(settings: SettingsProvider | undefined): TuiThemePreference {
  const section = settings?.get(TUI_THEME_SETTINGS_NAMESPACE)
  if (typeof section !== 'object' || section === null) return 'system'
  const preference = (section as { preference?: unknown }).preference
  return isTuiThemePreference(preference) ? preference : 'system'
}

/** One keyboard-selectable Settings hub row. */
type SettingsHubItem = ActionDialogChoice

/** Controller dependencies owned by one terminal channel. */
export interface SettingsControllerDeps extends ChatChannelDeps, ChannelNotice {
  /** Apply a committed preference to the terminal palette. */
  applyTheme(preference: TuiThemePreference): void
  /** Rebuild the palette and banner for a committed per-background accent selection. */
  applyAccent(accent: AccentSelection): void
  /** Refresh terminal chrome after the shared locale changes. */
  applyLocale(locale: TuiLocale): void
  /** Preview or commit the ordered terminal-title fields. */
  applyTitle(items: readonly TerminalTitleItem[]): void
  /** Preview or commit footer fields; undefined restores the profile template. */
  applyStatusLine(items: readonly StatusLineItem[] | undefined): void
}

/** Terminal Settings and appearance controller. */
export interface SettingsController {
  /** Current persistent appearance preference. */
  themePreference(): TuiThemePreference
  /** Current locale shared with the browser front door. */
  locale(): TuiLocale
  /** Current model communication style. */
  personality(): TuiPersonality
  /** Queue `/theme`; empty input opens the selector. */
  queueThemeCommand(raw: string): void
  /** Queue `/language`; empty input opens the selector. */
  queueLanguageCommand(raw: string): void
  /** Queue `/personality`; empty input opens the selector. */
  queuePersonalityCommand(raw: string): void
  /** Queue `/settings`; empty input opens the metadata hub. */
  queueSettingsCommand(raw: string): void
  /** Queue `/title`; empty input opens the terminal-title setup dialog. */
  queueTitleCommand(raw: string): void
  /** Queue `/statusline`; empty input opens the ordered footer setup dialog. */
  queueStatusLineCommand(raw: string): void
  /** Close settings-owned overlays during shutdown. */
  clearOverlays(): void
  /** Remove the shared settings listener. */
  detach(): void
}

/** Human summary for one redacted descriptor; no setting value is rendered. */
function descriptorDescription(descriptor: SettingsDescriptor): string {
  const source = descriptor.user === undefined ? 'inherited' : 'user override'
  const secrets = descriptor.secrets?.length ?? 0
  return `${descriptor.applies} · ${source}${secrets === 0 ? '' : ` · ${String(secrets)} secret field(s) hidden`}`
}

/**
 * Build Settings and Appearance surfaces over the shared file provider.
 * Generic namespace rows are metadata-only; writes are field-addressed so a
 * redacted view can never erase secret siblings.
 */
export function createSettingsController(deps: SettingsControllerDeps): SettingsController {
  const { ctx, resolved, palette, overlayManager } = deps
  let themePreference = readTuiThemePreference(ctx.get('settings'))
  let accent = readTuiAccent(ctx.get('settings'))
  let locale = readTuiLocale(ctx.get('settings'))
  let personality = readTuiPersonality(ctx.get('settings'))
  let settingsOverlay: TuiOverlaySession | undefined
  let themeOverlay: TuiOverlaySession | undefined
  let languageOverlay: TuiOverlaySession | undefined
  let personalityOverlay: TuiOverlaySession | undefined
  let titleOverlay: TuiOverlaySession | undefined
  let statusLineOverlay: TuiOverlaySession | undefined
  let titleItems = readTuiTitleItems(ctx.get('settings'))
  let statusLineItems = readTuiStatusLineItems(ctx.get('settings'))
  let operations = Promise.resolve()

  const settings = (): SettingsProvider | undefined => ctx.get('settings')

  const showDocument = async (): Promise<void> => {
    const provider = settings()
    if (provider === undefined) {
      deps.appendNotice('Settings are not available in this composition.', 'warning')
      return
    }
    const path = await provider.prepareDocument()
    if (deps.isDisposed()) return
    deps.appendNotice(path === undefined
      ? 'This settings provider has no local document.'
      : `Settings document: ${displayText(path)}\nEdit it with your terminal editor; valid changes reload automatically.`)
  }

  const commitTheme = async (preference: TuiThemePreference, announce = true): Promise<boolean> => {
    const provider = settings()
    if (provider?.get(TUI_THEME_SETTINGS_NAMESPACE) === undefined) {
      deps.appendNotice('Appearance settings are unavailable: the ui-theme namespace is not registered.', 'warning')
      return false
    }
    await provider.mutate(TUI_THEME_SETTINGS_NAMESPACE, [{
      op: 'set',
      path: ['preference'],
      value: preference,
    }])
    if (themePreference !== preference) {
      themePreference = preference
      deps.applyTheme(preference)
    }
    if (announce && !deps.isDisposed()) deps.appendNotice(`Theme preference: ${preference}.`)
    return true
  }

  const commitAccent = async (scheme: 'light' | 'dark', nextAccent: AccentId, announce = true): Promise<boolean> => {
    const provider = settings()
    if (provider?.get(TUI_ACCENT_SETTINGS_NAMESPACE) === undefined) {
      deps.appendNotice('Accent settings are unavailable: the ui-accent namespace is not registered.', 'warning')
      return false
    }
    await provider.mutate(TUI_ACCENT_SETTINGS_NAMESPACE, [{
      op: 'set',
      path: [scheme],
      value: nextAccent,
    }])
    if (accent[scheme] !== nextAccent) {
      accent = { ...accent, [scheme]: nextAccent }
      deps.applyAccent(accent)
    }
    if (announce && !deps.isDisposed()) deps.appendNotice(`${scheme === 'light' ? 'Light' : 'Dark'} accent: ${accentHue(nextAccent).label}.`)
    return true
  }

  const commitThemePreset = async (
    preference: TuiThemePreference,
    nextAccent: AccentId,
  ): Promise<boolean> => {
    if (!await commitTheme(preference, false)) return false
    if (preference !== 'system') return commitAccent(preference, nextAccent, false)
    if (!await commitAccent('light', nextAccent, false)) return false
    return commitAccent('dark', nextAccent, false)
  }

  const resetDeepSeekTheme = async (): Promise<boolean> => {
    return commitThemePreset('system', DEFAULT_ACCENT)
  }

  const commitLocale = async (nextLocale: TuiLocale): Promise<void> => {
    const provider = settings()
    if (provider?.get(TUI_LOCALE_SETTINGS_NAMESPACE) === undefined) {
      deps.appendNotice('Language settings are unavailable: the locale namespace is not registered.', 'warning')
      return
    }
    await provider.mutate(TUI_LOCALE_SETTINGS_NAMESPACE, [{
      op: 'set',
      path: ['preference'],
      value: nextLocale,
    }])
    if (locale !== nextLocale) {
      locale = nextLocale
      deps.applyLocale(nextLocale)
    }
    if (!deps.isDisposed()) deps.appendNotice(tuiCopy(nextLocale).languageChanged)
  }

  const commitPersonality = async (nextPersonality: TuiPersonality): Promise<boolean> => {
    const provider = settings()
    if (provider?.get(TUI_PERSONALITY_SETTINGS_NAMESPACE) === undefined) {
      deps.appendNotice('Personality settings are unavailable: the agent-personality namespace is not registered.', 'warning')
      return false
    }
    await provider.mutate(TUI_PERSONALITY_SETTINGS_NAMESPACE, [{
      op: 'set',
      path: ['preference'],
      value: nextPersonality,
    }])
    personality = nextPersonality
    if (!deps.isDisposed()) {
      deps.appendNotice(`Personality: ${nextPersonality === 'friendly' ? 'Friendly' : 'Pragmatic'}.`)
    }
    return true
  }

  const commitTitleItems = async (nextItems: readonly TerminalTitleItem[]): Promise<boolean> => {
    const provider = settings()
    if (provider?.get(TUI_TERMINAL_SETTINGS_NAMESPACE) === undefined) {
      deps.appendNotice('Terminal title settings are unavailable: the ui-terminal namespace is not registered.', 'warning')
      return false
    }
    await provider.mutate(TUI_TERMINAL_SETTINGS_NAMESPACE, [{
      op: 'set',
      path: ['titleItems'],
      value: [...nextItems],
    }])
    titleItems = [...nextItems]
    deps.applyTitle(titleItems)
    return true
  }

  const commitStatusLineItems = async (nextItems: readonly StatusLineItem[] | undefined): Promise<boolean> => {
    const provider = settings()
    if (provider?.get(TUI_TERMINAL_SETTINGS_NAMESPACE) === undefined) {
      deps.appendNotice('Status line settings are unavailable: the ui-terminal namespace is not registered.', 'warning')
      return false
    }
    await provider.mutate(TUI_TERMINAL_SETTINGS_NAMESPACE, [nextItems === undefined
      ? { op: 'unset', path: ['statusLineItems'] }
      : { op: 'set', path: ['statusLineItems'], value: [...nextItems] }])
    statusLineItems = nextItems === undefined ? undefined : [...nextItems]
    deps.applyStatusLine(statusLineItems)
    return true
  }

  const showTheme = (): void => {
    const copy = tuiCopy(locale)
    void themeOverlay?.close()
    const lightHues = ACCENT_HUES.map(hue => ({
      value: `light:${hue.id}`,
      label: `Light · ${hue.label}`,
      ...themePreference === 'light' && accent.light === hue.id ? { description: copy.current } : {},
    }))
    const darkHues = ACCENT_HUES.map(hue => ({
      value: `dark:${hue.id}`,
      label: `Dark · ${hue.label}`,
      ...themePreference === 'dark' && accent.dark === hue.id ? { description: copy.current } : {},
    }))
    const items: SettingsHubItem[] = [
      {
        value: '@deepseek',
        label: 'DeepSeek',
        ...themePreference === 'system' && accent.light === DEFAULT_ACCENT && accent.dark === DEFAULT_ACCENT
          ? { description: copy.current }
          : { description: 'System default' },
      },
      ...lightHues,
      ...darkHues,
    ]
    const session = overlayManager.open({
      create: () => new ActionDialog(
        'Theme',
        items,
        items.length,
        palette,
        (value) => {
          void session.close()
          operations = operations.then(async () => {
            if (value === '@deepseek') {
              if (!await resetDeepSeekTheme()) return
              if (!deps.isDisposed()) deps.appendNotice('Theme: DeepSeek.')
              return
            }
            const [scheme, id] = value.split(':', 2) as [string, string | undefined]
            if ((scheme !== 'light' && scheme !== 'dark') || !isAccentId(id)) return
            if (!await commitThemePreset(scheme, id)) return
            if (!deps.isDisposed()) deps.appendNotice(`Theme: ${scheme === 'light' ? 'Light' : 'Dark'} · ${accentHue(id).label}.`)
          }).catch((error: unknown) => {
            if (!deps.isDisposed()) deps.appendNotice(`Theme update failed: ${String(error)}`, 'error')
          })
        },
        () => { void session.close() },
        undefined,
        copy.moveSelectClose,
        false,
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    themeOverlay = session
    void session.closed.then(() => {
      if (themeOverlay === session) themeOverlay = undefined
    })
    deps.requestRender()
  }

  const showLanguage = (): void => {
    const copy = tuiCopy(locale)
    void languageOverlay?.close()
    const items: SettingsHubItem[] = TUI_LOCALE_OPTIONS.map(option => ({
      value: option.id,
      label: option.label,
      ...locale === option.id ? { description: copy.current } : {},
    }))
    const session = overlayManager.open({
      create: () => new ActionDialog(
        copy.language,
        items,
        items.length,
        palette,
        (value) => {
          void session.close()
          if (isTuiLocale(value)) {
            operations = operations.then(() => commitLocale(value)).catch((error: unknown) => {
              if (!deps.isDisposed()) deps.appendNotice(`Language update failed: ${String(error)}`, 'error')
            })
          }
        },
        () => { void session.close() },
        locale,
        copy.moveSelectClose,
        false,
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    languageOverlay = session
    void session.closed.then(() => {
      if (languageOverlay === session) languageOverlay = undefined
    })
    deps.requestRender()
  }

  const showPersonality = (): void => {
    const copy = tuiCopy(locale)
    void personalityOverlay?.close()
    const items: SettingsHubItem[] = [
      {
        value: 'friendly',
        label: copy.personalityFriendly,
        description: personality === 'friendly' ? copy.current : copy.personalityFriendlyDescription,
      },
      {
        value: 'pragmatic',
        label: copy.personalityPragmatic,
        description: personality === 'pragmatic' ? copy.current : copy.personalityPragmaticDescription,
      },
    ]
    const session = overlayManager.open({
      create: () => new ActionDialog(
        copy.personality,
        items,
        items.length,
        palette,
        (value) => {
          void session.close()
          if (!isTuiPersonality(value)) return
          operations = operations.then(async () => { await commitPersonality(value) }).catch((error: unknown) => {
            if (!deps.isDisposed()) deps.appendNotice(`Personality update failed: ${String(error)}`, 'error')
          })
        },
        () => { void session.close() },
        undefined,
        copy.moveSelectClose,
        false,
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    personalityOverlay = session
    void session.closed.then(() => {
      if (personalityOverlay === session) personalityOverlay = undefined
    })
    deps.requestRender()
  }

  const showTitle = (): void => {
    void titleOverlay?.close()
    const original = [...titleItems]
    const session = overlayManager.open({
      create: () => new MultiSelectDialog(
        'Configure Terminal Title',
        TERMINAL_TITLE_CHOICES,
        original,
        resolved.maxModelOptions,
        palette,
        (values) => { deps.applyTitle(values.filter(isTerminalTitleItem)) },
        (values) => {
          void session.close()
          const selected = values.filter(isTerminalTitleItem)
          operations = operations.then(async () => {
            if (!await commitTitleItems(selected)) deps.applyTitle(original)
            else if (!deps.isDisposed()) deps.appendNotice(`Terminal title: ${selected.length === 0 ? 'disabled' : selected.join(' · ')}.`)
          }).catch((error: unknown) => {
            deps.applyTitle(original)
            if (!deps.isDisposed()) deps.appendNotice(`Terminal title update failed: ${String(error)}`, 'error')
          })
        },
        () => {
          deps.applyTitle(original)
          void session.close()
        },
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    titleOverlay = session
    void session.closed.then(() => {
      if (titleOverlay === session) titleOverlay = undefined
    })
    deps.requestRender()
  }

  const showStatusLine = (): void => {
    void statusLineOverlay?.close()
    const original = statusLineItems === undefined ? undefined : [...statusLineItems]
    const selected = statusLineItems ?? DEFAULT_STATUS_LINE_ITEMS
    const session = overlayManager.open({
      create: () => new MultiSelectDialog(
        'Configure Status Line',
        STATUS_LINE_CHOICES,
        selected,
        resolved.maxModelOptions,
        palette,
        (values) => { deps.applyStatusLine(values.filter(isStatusLineItem)) },
        (values) => {
          void session.close()
          const nextItems = values.filter(isStatusLineItem)
          operations = operations.then(async () => {
            if (!await commitStatusLineItems(nextItems)) deps.applyStatusLine(original)
            else if (!deps.isDisposed()) deps.appendNotice(`Status line: ${nextItems.length === 0 ? 'disabled' : nextItems.join(' · ')}.`)
          }).catch((error: unknown) => {
            deps.applyStatusLine(original)
            if (!deps.isDisposed()) deps.appendNotice(`Status line update failed: ${String(error)}`, 'error')
          })
        },
        () => {
          deps.applyStatusLine(original)
          void session.close()
        },
        true,
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    statusLineOverlay = session
    void session.closed.then(() => {
      if (statusLineOverlay === session) statusLineOverlay = undefined
    })
    deps.requestRender()
  }

  const showSettings = (): void => {
    const copy = tuiCopy(locale)
    const provider = settings()
    if (provider === undefined) {
      deps.appendNotice('Settings are not available in this composition.', 'warning')
      return
    }
    const descriptors = provider.describe({ redactSecrets: true })
    const items: SettingsHubItem[] = [
      { value: '@theme', label: 'Theme', description: `${themePreference} · ${accentHue(accent.light).label} / ${accentHue(accent.dark).label}` },
      { value: '@language', label: copy.language, description: tuiLocaleLabel(locale) },
      {
        value: '@personality',
        label: copy.personality,
        description: personality === 'friendly' ? copy.personalityFriendly : copy.personalityPragmatic,
      },
      { value: '@title', label: 'Terminal title', description: titleItems.length === 0 ? 'disabled' : titleItems.join(' · ') },
      {
        value: '@statusline',
        label: 'Status line',
        description: statusLineItems === undefined
          ? 'profile template'
          : statusLineItems.length === 0 ? 'disabled' : statusLineItems.join(' · '),
      },
      {
        value: '@document',
        label: copy.settingsDocument,
        description: provider.documentPath === undefined
          ? 'not file-backed'
          : provider.writable ? displayText(provider.documentPath) : 'read-only',
      },
      ...descriptors.map(descriptor => ({
        value: `namespace:${descriptor.ns}`,
        label: String(descriptor.ns),
        description: descriptorDescription(descriptor),
      })),
    ]
    void settingsOverlay?.close()
    const session = overlayManager.open({
      create: () => new ActionDialog(
        copy.settings,
        items,
        resolved.maxModelOptions,
        palette,
        (value) => {
          void session.close()
          if (value === '@theme') showTheme()
          else if (value === '@language') showLanguage()
          else if (value === '@personality') showPersonality()
          else if (value === '@title') showTitle()
          else if (value === '@statusline') showStatusLine()
          else if (value === '@document') {
            operations = operations.then(showDocument).catch((error: unknown) => {
              if (!deps.isDisposed()) deps.appendNotice(`Settings document failed: ${String(error)}`, 'error')
            })
          } else {
            const descriptor = descriptors.find(item => `namespace:${item.ns}` === value)
            if (descriptor !== undefined) {
              deps.appendNotice(`${descriptor.ns}: ${descriptorDescription(descriptor)}.`)
            }
          }
        },
        () => { void session.close() },
        undefined,
        copy.moveSelectClose,
        false,
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    settingsOverlay = session
    void session.closed.then(() => {
      if (settingsOverlay === session) settingsOverlay = undefined
    })
    deps.requestRender()
  }

  const themeCommand = async (raw: string): Promise<void> => {
    const argument = raw.trim()
    if (argument === '') {
      showTheme()
      return
    }
    if (isTuiThemePreference(argument)) {
      await commitTheme(argument)
      return
    }
    const parts = argument.split(/\s+/u)
    if (parts[0] === 'deepseek' && parts.length === 1) {
      if (!await resetDeepSeekTheme()) return
      if (!deps.isDisposed()) deps.appendNotice('Theme: DeepSeek.')
      return
    }
    const [preference, id] = parts
    if (isTuiThemePreference(preference) && id !== undefined && isAccentId(id) && parts.length === 2) {
      if (!await commitThemePreset(preference, id)) return
      if (!deps.isDisposed()) deps.appendNotice(`Theme: ${preference.charAt(0).toUpperCase() + preference.slice(1)} · ${accentHue(id).label}.`)
      return
    }
    deps.appendNotice(`Usage: /theme [deepseek|light|dark|system] [${ACCENT_HUES.map(item => item.id).join('|')}]`, 'warning')
  }

  const languageCommand = async (raw: string): Promise<void> => {
    const argument = raw.trim().toLowerCase()
    if (argument === '') {
      showLanguage()
      return
    }
    const nextLocale = resolveTuiLocale(argument)
    if (nextLocale === undefined) {
      deps.appendNotice(`Usage: /language [${TUI_LOCALE_OPTIONS.map(option => option.id).join('|')}]`, 'warning')
      return
    }
    await commitLocale(nextLocale)
  }

  const personalityCommand = async (raw: string): Promise<void> => {
    const argument = raw.trim().toLowerCase()
    if (argument === '') {
      showPersonality()
      return
    }
    if (argument === 'status') {
      deps.appendNotice(`Personality: ${personality === 'friendly' ? 'Friendly' : 'Pragmatic'}.`)
      return
    }
    if (!isTuiPersonality(argument)) {
      deps.appendNotice('Usage: /personality [friendly|pragmatic|status]', 'warning')
      return
    }
    await commitPersonality(argument)
  }

  const settingsCommand = async (raw: string): Promise<void> => {
    const argument = raw.trim()
    if (argument === '') {
      showSettings()
      return
    }
    if (argument === 'document' || argument === 'path') {
      await showDocument()
      return
    }
    if (argument === 'list') {
      const descriptors = settings()?.describe({ redactSecrets: true }) ?? []
      deps.appendNotice(descriptors.length === 0
        ? 'No settings namespaces are registered.'
        : descriptors.map(item => `${item.ns} (${descriptorDescription(item)})`).join('\n'))
      return
    }
    deps.appendNotice('Usage: /settings [list|document]', 'warning')
  }

  const titleCommand = async (raw: string): Promise<void> => {
    const argument = raw.trim()
    if (argument === '') {
      showTitle()
      return
    }
    if (argument === 'status') {
      deps.appendNotice(`Terminal title: ${titleItems.length === 0 ? 'disabled' : titleItems.join(' · ')}.`)
      return
    }
    if (argument === 'reset') {
      if (await commitTitleItems(DEFAULT_TERMINAL_TITLE_ITEMS) && !deps.isDisposed()) {
        deps.appendNotice(`Terminal title reset: ${DEFAULT_TERMINAL_TITLE_ITEMS.join(' · ')}.`)
      }
      return
    }
    const tokens = argument.startsWith('set ')
      ? argument.slice(4).split(/[\s,]+/u).filter(Boolean)
      : []
    if (tokens.length === 0 || tokens.some(token => !isTerminalTitleItem(token))) {
      deps.appendNotice(`Usage: /title [status|reset|set <${TERMINAL_TITLE_ITEM_IDS.join('|')}> ...]`, 'warning')
      return
    }
    const selected = [...new Set(tokens.filter(isTerminalTitleItem))]
    if (await commitTitleItems(selected) && !deps.isDisposed()) {
      deps.appendNotice(`Terminal title: ${selected.join(' · ')}.`)
    }
  }

  const statusLineCommand = async (raw: string): Promise<void> => {
    const argument = raw.trim()
    if (argument === '') {
      showStatusLine()
      return
    }
    if (argument === 'status') {
      deps.appendNotice(`Status line: ${statusLineItems === undefined
        ? 'profile template'
        : statusLineItems.length === 0 ? 'disabled' : statusLineItems.join(' · ')}.`)
      return
    }
    if (argument === 'reset') {
      if (await commitStatusLineItems(undefined) && !deps.isDisposed()) {
        deps.appendNotice('Status line reset to the active profile template.')
      }
      return
    }
    if (argument === 'off') {
      if (await commitStatusLineItems([]) && !deps.isDisposed()) deps.appendNotice('Status line disabled.')
      return
    }
    const tokens = argument.startsWith('set ')
      ? argument.slice(4).split(/[\s,]+/u).filter(Boolean)
      : []
    if (tokens.length === 0 || tokens.some(token => !isStatusLineItem(token))) {
      deps.appendNotice(`Usage: /statusline [status|reset|off|set <${STATUS_LINE_ITEM_IDS.join('|')}> ...]`, 'warning')
      return
    }
    const selected = [...new Set(tokens.filter(isStatusLineItem))]
    if (await commitStatusLineItems(selected) && !deps.isDisposed()) {
      deps.appendNotice(`Status line: ${selected.join(' · ')}.`)
    }
  }

  const disposeSettingsUpdates = ctx.on('settings/updated', (namespace, next) => {
    if (typeof next !== 'object' || next === null) return
    if (namespace === TUI_LOCALE_SETTINGS_NAMESPACE) {
      const preference = (next as { preference?: unknown }).preference
      if (!isTuiLocale(preference) || preference === locale) return
      locale = preference
      deps.applyLocale(preference)
      return
    }
    if (namespace === TUI_PERSONALITY_SETTINGS_NAMESPACE) {
      const preference = (next as { preference?: unknown }).preference
      if (!isTuiPersonality(preference)) return
      personality = preference
      return
    }
    if (namespace === TUI_ACCENT_SETTINGS_NAMESPACE) {
      const value = next as { light?: unknown; dark?: unknown }
      const light = isAccentId(value.light) ? value.light : accent.light
      const dark = isAccentId(value.dark) ? value.dark : accent.dark
      if (light === accent.light && dark === accent.dark) return
      accent = { light, dark }
      deps.applyAccent(accent)
      return
    }
    if (namespace === TUI_TERMINAL_SETTINGS_NAMESPACE) {
      const nextItems = resolveTitleItems(next)
      if (nextItems.length !== titleItems.length || nextItems.some((item, index) => item !== titleItems[index])) {
        titleItems = nextItems
        deps.applyTitle(titleItems)
      }
      const nextStatusLineItems = resolveStatusLineItems(next)
      const statusLineChanged = nextStatusLineItems === undefined
        ? statusLineItems !== undefined
        : statusLineItems === undefined
          || nextStatusLineItems.length !== statusLineItems.length
          || nextStatusLineItems.some((item, index) => item !== statusLineItems?.[index])
      if (statusLineChanged) {
        statusLineItems = nextStatusLineItems
        deps.applyStatusLine(statusLineItems)
      }
      return
    }
    if (namespace !== TUI_THEME_SETTINGS_NAMESPACE) return
    const preference = (next as { preference?: unknown }).preference
    if (!isTuiThemePreference(preference) || preference === themePreference) return
    themePreference = preference
    deps.applyTheme(preference)
  })

  return {
    themePreference: () => themePreference,
    locale: () => locale,
    personality: () => personality,
    queueThemeCommand(raw): void {
      operations = operations.then(() => themeCommand(raw)).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Theme command failed: ${String(error)}`, 'error')
      })
    },
    queueLanguageCommand(raw): void {
      operations = operations.then(() => languageCommand(raw)).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Language command failed: ${String(error)}`, 'error')
      })
    },
    queuePersonalityCommand(raw): void {
      operations = operations.then(() => personalityCommand(raw)).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Personality command failed: ${String(error)}`, 'error')
      })
    },
    queueSettingsCommand(raw): void {
      operations = operations.then(() => settingsCommand(raw)).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Settings command failed: ${String(error)}`, 'error')
      })
    },
    queueTitleCommand(raw): void {
      operations = operations.then(() => titleCommand(raw)).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Title command failed: ${String(error)}`, 'error')
      })
    },
    queueStatusLineCommand(raw): void {
      operations = operations.then(() => statusLineCommand(raw)).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Status line command failed: ${String(error)}`, 'error')
      })
    },
    clearOverlays(): void {
      settingsOverlay = undefined
      themeOverlay = undefined
      languageOverlay = undefined
      personalityOverlay = undefined
      titleOverlay = undefined
      statusLineOverlay = undefined
    },
    detach(): void {
      disposeSettingsUpdates()
    },
  }
}
