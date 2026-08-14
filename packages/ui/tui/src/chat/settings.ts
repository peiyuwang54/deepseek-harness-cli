/**
 * Shared user-settings surfaces for the terminal channel: a metadata-only
 * Settings hub and a persistent light/dark/system appearance selector.
 * @module @deepseek-ai/dsh-tui/chat/settings
 */

import {
  Key,
  SelectList,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type SelectItem,
} from '@earendil-works/pi-tui'
import {
  settingsNamespace,
  type SettingsDescriptor,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import { dialogSelectTheme } from '../components/theme.ts'
import { displayText } from '../components/text.ts'
import type { TuiOverlaySession } from '../extension/types.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'
import {
  TUI_LOCALE_SETTINGS_NAMESPACE,
  isTuiLocale,
  readTuiLocale,
  tuiCopy,
  type TuiLocale,
} from './language.ts'

/** Appearance preferences shared with the Web `ui-theme` settings section. */
const TUI_THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Persistent appearance preference accepted by both terminal and Web. */
export type TuiThemePreference = typeof TUI_THEME_PREFERENCES[number]

/** Shared settings namespace registered by the theme Host plugin. */
const TUI_THEME_SETTINGS_NAMESPACE = settingsNamespace('ui-theme')

/** Narrow an unknown settings value to the shared preference vocabulary. */
function isTuiThemePreference(value: unknown): value is TuiThemePreference {
  return TUI_THEME_PREFERENCES.some(preference => preference === value)
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
interface SettingsHubItem extends SelectItem {
  value: string
}

/** Compact bordered selector shared by Settings and Appearance. */
class SettingsSelectDialog implements Component {
  private readonly list: SelectList

  constructor(
    private readonly title: string,
    items: readonly SettingsHubItem[],
    maxVisible: number,
    private readonly palette: ChatChannelDeps['palette'],
    done: (value: string) => void,
    private readonly cancel: () => void,
    initialValue?: string,
    private readonly instructions = '↑/↓ move • Enter select • Esc close',
  ) {
    this.list = new SelectList([...items], maxVisible, dialogSelectTheme(palette))
    const selected = initialValue === undefined ? -1 : items.findIndex(item => item.value === initialValue)
    if (selected >= 0) this.list.setSelectedIndex(selected)
    this.list.onSelect = (item) => { done(item.value) }
    this.list.onCancel = cancel
  }

  invalidate(): void {
    this.list.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) this.cancel()
    else this.list.handleInput(data)
    this.invalidate()
  }

  render(width: number): string[] {
    const cardWidth = Math.max(20, width)
    const innerWidth = Math.max(1, cardWidth - 4)
    const label = ` ${displayText(this.title)} `
    const body = [
      ...this.list.render(innerWidth),
      this.palette.dim(this.instructions),
    ]
    const lines = [
      this.palette.accent(`╭${label}${'─'.repeat(Math.max(0, cardWidth - visibleWidth(label) - 2))}╮`),
      ...body.map((line) => {
        const clipped = truncateToWidth(line, innerWidth, '')
        return `${this.palette.accent('│')} ${clipped}${' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${this.palette.accent('│')}`
      }),
      this.palette.accent(`╰${'─'.repeat(Math.max(0, cardWidth - 2))}╯`),
    ]
    return lines
  }
}

/** Controller dependencies owned by one terminal channel. */
export interface SettingsControllerDeps extends ChatChannelDeps, ChannelNotice {
  /** Apply a committed preference to the terminal palette. */
  applyTheme(preference: TuiThemePreference): void
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

  const commitTheme = async (preference: TuiThemePreference): Promise<void> => {
    const provider = settings()
    if (provider?.get(TUI_THEME_SETTINGS_NAMESPACE) === undefined) {
      deps.appendNotice('Appearance settings are unavailable: the ui-theme namespace is not registered.', 'warning')
      return
    }
    await provider.mutate(TUI_THEME_SETTINGS_NAMESPACE, [{
      op: 'set',
      path: ['preference'],
      value: preference,
    }])
    if (!deps.isDisposed()) deps.appendNotice(`Theme preference: ${preference}.`)
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
    if (!deps.isDisposed()) deps.appendNotice(nextLocale === 'zh' ? '界面语言已切换为中文。' : 'Interface language changed to English.')
  }

  const showTheme = (): void => {
    const copy = tuiCopy(locale)
    void themeOverlay?.close()
    const items: SettingsHubItem[] = TUI_THEME_PREFERENCES.map(preference => ({
      value: preference,
      label: preference.charAt(0).toUpperCase() + preference.slice(1),
      ...preference === themePreference ? { description: 'current' } : {},
    }))
    const session = overlayManager.open({
      create: () => new SettingsSelectDialog(
        copy.appearance,
        items,
        items.length,
        palette,
        (value) => {
          void session.close()
          if (isTuiThemePreference(value)) {
            operations = operations.then(() => commitTheme(value)).catch((error: unknown) => {
              if (!deps.isDisposed()) deps.appendNotice(`Theme update failed: ${String(error)}`, 'error')
            })
          }
        },
        () => { void session.close() },
        themePreference,
        copy.moveSelectClose,
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
    const items: SettingsHubItem[] = [
      { value: 'zh', label: '中文', ...locale === 'zh' ? { description: copy.current } : {} },
      { value: 'en', label: 'English', ...locale === 'en' ? { description: copy.current } : {} },
    ]
    const session = overlayManager.open({
      create: () => new SettingsSelectDialog(
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
      { value: '@appearance', label: copy.appearance, description: themePreference },
      { value: '@language', label: copy.language, description: locale === 'zh' ? '中文' : 'English' },
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
      create: () => new SettingsSelectDialog(
        copy.settings,
        items,
        resolved.maxModelOptions,
        palette,
        (value) => {
          void session.close()
          if (value === '@appearance') showTheme()
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
    if (!isTuiThemePreference(argument)) {
      deps.appendNotice('Usage: /theme [light|dark|system]', 'warning')
      return
    }
    await commitTheme(argument)
  }

  const languageCommand = async (raw: string): Promise<void> => {
    const argument = raw.trim().toLowerCase()
    if (argument === '') {
      showLanguage()
      return
    }
    const nextLocale = argument === '中文' ? 'zh' : argument === 'english' ? 'en' : argument
    if (!isTuiLocale(nextLocale)) {
      deps.appendNotice('Usage: /language [zh|en]', 'warning')
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
