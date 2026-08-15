/**
 * Shared user-settings surfaces for the terminal channel: a metadata-only
 * Settings hub and a persistent light/dark/system appearance selector.
 * @module @deepseek-ai/dsh-tui/chat/settings
 */

import {
  settingsNamespace,
  type SettingsDescriptor,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { ActionDialog, type ActionDialogChoice } from '../components/dialogs.ts'
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

/** Durable accent section schema; also the wire envelope validation against it. */
const AccentSettingsSchema: z<AccentSelection> = z.object({
  light: z.union([...ACCENT_IDS]).default(DEFAULT_ACCENT),
  dark: z.union([...ACCENT_IDS]).default(DEFAULT_ACCENT),
})

/**
 * Register the TUI accent namespace on the host settings service when one is
 * composed, exactly like the Web `ui-theme` and `locale` sections.
 * @param ctx - Context whose optional settings service owns the section.
 * @param registered - Called after the namespace has loaded its stored value.
 */
export function registerTuiAccentSettings(ctx: Context, registered?: () => void): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(TUI_ACCENT_SETTINGS_NAMESPACE, AccentSettingsSchema)
    registered?.()
  })
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
}

/** Terminal Settings and appearance controller. */
export interface SettingsController {
  /** Current persistent appearance preference. */
  themePreference(): TuiThemePreference
  /** Current locale shared with the browser front door. */
  locale(): TuiLocale
  /** Queue `/theme`; empty input opens the selector. */
  queueThemeCommand(raw: string): void
  /** Queue `/language`; empty input opens the selector. */
  queueLanguageCommand(raw: string): void
  /** Queue `/settings`; empty input opens the metadata hub. */
  queueSettingsCommand(raw: string): void
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
  let settingsOverlay: TuiOverlaySession | undefined
  let themeOverlay: TuiOverlaySession | undefined
  let languageOverlay: TuiOverlaySession | undefined
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

  const disposeSettingsUpdates = ctx.on('settings/updated', (namespace, next) => {
    if (typeof next !== 'object' || next === null) return
    if (namespace === TUI_LOCALE_SETTINGS_NAMESPACE) {
      const preference = (next as { preference?: unknown }).preference
      if (!isTuiLocale(preference) || preference === locale) return
      locale = preference
      deps.applyLocale(preference)
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
    if (namespace !== TUI_THEME_SETTINGS_NAMESPACE) return
    const preference = (next as { preference?: unknown }).preference
    if (!isTuiThemePreference(preference) || preference === themePreference) return
    themePreference = preference
    deps.applyTheme(preference)
  })

  return {
    themePreference: () => themePreference,
    locale: () => locale,
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
    queueSettingsCommand(raw): void {
      operations = operations.then(() => settingsCommand(raw)).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Settings command failed: ${String(error)}`, 'error')
      })
    },
    clearOverlays(): void {
      settingsOverlay = undefined
      themeOverlay = undefined
      languageOverlay = undefined
    },
    detach(): void {
      disposeSettingsUpdates()
    },
  }
}
