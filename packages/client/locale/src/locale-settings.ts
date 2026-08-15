/** Locale preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the locale plugin. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field carrying an explicit locale selection; absence delegates to the browser. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Locale identifiers with complete browser dictionaries. */
export const LOCALE_IDS = ['zh', 'en'] as const

/** Browser locale identifier. */
export type LocaleId = typeof LOCALE_IDS[number]

/** Locale preferences accepted by the shared Web/TUI settings document. */
export const LOCALE_PREFERENCE_IDS = ['en', 'zh', 'ar', 'fr', 'ru', 'es', 'ja', 'ko'] as const

/** Locale preference persisted for either shipped front door. */
export type LocalePreferenceId = typeof LOCALE_PREFERENCE_IDS[number]

/** Durable locale section shared by the Host schema and the browser scope. */
export interface LocaleSettings {
  /** Explicit locale selection; absence delegates to the browser. */
  preference?: LocalePreferenceId
}

/** Durable locale schema; also the wire envelope the browser scope validates against. */
export const LocaleSettingsSchema: z<LocaleSettings> = z.object({
  [LOCALE_PREFERENCE_FIELD]: z.union([...LOCALE_PREFERENCE_IDS]).required(false),
})
