/** Shared Web/TUI locale preference and terminal-native copy. */

import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'

/** Durable namespace also consumed by the browser locale runtime. */
export const TUI_LOCALE_SETTINGS_NAMESPACE = settingsNamespace('locale')

/** Locale supported by both shipped front doors. */
export type TuiLocale = 'zh' | 'en'

/** Locale identifiers shared with the browser surface's public contract. */
const TUI_LOCALES: readonly TuiLocale[] = ['zh', 'en']

/** User-facing shell copy owned by the terminal channel. */
export interface TuiCopy {
  readonly welcomeBack: string
  readonly whatsNew: string
  readonly recentSessions: string
  readonly loadingSessions: string
  readonly sessionsUnavailable: string
  readonly noPreviousSessions: string
  readonly preset: string
  readonly model: string
  readonly permissions: string
  readonly workspaceUnset: string
  readonly skillsAction: string
  readonly permissionsAction: string
  readonly modelAction: string
  readonly workspaceAction: string
  readonly resumeAction: string
  readonly helpHint: string
  readonly compactActions: string
  readonly shortcutHint: string
  readonly inputPlaceholder: string
  readonly editorIdleFooter: string
  readonly editorRunningFooter: string
  readonly deepDiving: string
  readonly interruptHint: string
  readonly settings: string
  readonly appearance: string
  readonly language: string
  readonly settingsDocument: string
  readonly current: string
  readonly moveSelectClose: string
}

const COPY: Readonly<Record<TuiLocale, TuiCopy>> = {
  en: {
    welcomeBack: 'Welcome back!',
    whatsNew: "What's new",
    recentSessions: 'Recent sessions',
    loadingSessions: 'Loading session history…',
    sessionsUnavailable: 'Session history unavailable in this profile.',
    noPreviousSessions: 'No previous sessions in this profile.',
    preset: 'preset:',
    model: 'model:',
    permissions: 'permissions:',
    workspaceUnset: 'workspace unset',
    skillsAction: 'browse and run agent skills',
    permissionsAction: 'choose approval and sandbox mode',
    modelAction: 'switch model and reasoning effort',
    workspaceAction: 'start in another workspace',
    resumeAction: 'search previous sessions',
    helpHint: '/help for commands · @ to attach a file',
    compactActions: '/model model  /resume sessions  /workspace workspace  /help help',
    shortcutHint: 'Enter sends · Shift+Enter newline · Alt+M model · ? shortcuts',
    inputPlaceholder: 'Describe a task, @ a file, or / for commands',
    editorIdleFooter: 'Enter send · Shift+Enter newline · / commands',
    editorRunningFooter: 'Enter steer · Esc cancel · Shift+Enter newline',
    deepDiving: 'Deep diving',
    interruptHint: 'esc to interrupt',
    settings: 'Settings',
    appearance: 'Appearance',
    language: 'Language',
    settingsDocument: 'Settings document',
    current: 'current',
    moveSelectClose: '↑/↓ move • Enter select • Esc close',
  },
  zh: {
    welcomeBack: '欢迎回来！',
    whatsNew: '新增功能',
    recentSessions: '最近会话',
    loadingSessions: '正在加载会话记录…',
    sessionsUnavailable: '当前配置无法读取会话记录。',
    noPreviousSessions: '当前配置还没有历史会话。',
    preset: '预设：',
    model: '模型：',
    permissions: '权限：',
    workspaceUnset: '未设置工作区',
    skillsAction: '浏览并运行智能体技能',
    permissionsAction: '选择审批和沙箱模式',
    modelAction: '切换模型和思考等级',
    workspaceAction: '在其他工作区启动',
    resumeAction: '搜索历史会话',
    helpHint: '/help 查看命令 · @ 添加文件',
    compactActions: '/model 模型  /resume 会话  /workspace 工作区  /help 帮助',
    shortcutHint: 'Enter 发送 · Shift+Enter 换行 · Alt+M 模型 · ? 快捷键',
    inputPlaceholder: '描述任务，@ 添加文件，或输入 / 查看命令',
    editorIdleFooter: 'Enter 发送 · Shift+Enter 换行 · / 命令',
    editorRunningFooter: 'Enter 引导 · Esc 取消 · Shift+Enter 换行',
    deepDiving: '正在深度求索',
    interruptHint: 'Esc 中断',
    settings: '设置',
    appearance: '外观',
    language: '语言',
    settingsDocument: '设置文件',
    current: '当前',
    moveSelectClose: '↑/↓ 移动 • Enter 选择 • Esc 关闭',
  },
}

/** Narrow an unknown setting to a locale shipped by both surfaces. */
export function isTuiLocale(value: unknown): value is TuiLocale {
  return TUI_LOCALES.some(locale => locale === value)
}

/** Read the shared locale preference; terminal-only compositions default to English. */
export function readTuiLocale(settings: SettingsProvider | undefined): TuiLocale {
  const section = settings?.get(TUI_LOCALE_SETTINGS_NAMESPACE)
  if (typeof section !== 'object' || section === null) return 'en'
  const preference = (section as { preference?: unknown }).preference
  return isTuiLocale(preference) ? preference : 'en'
}

/** Resolve terminal shell copy for a selected shared locale. */
export function tuiCopy(locale: TuiLocale): TuiCopy {
  return COPY[locale]
}

/**
 * Format the Web label as Codex's live, interruptible turn row.
 * @param elapsedMs - Time since the durable `turn/start` event.
 * @param locale - Active shared Web/TUI locale.
 * @returns Running label and optional elapsed clock.
 */
export function formatDeepDivingStatus(elapsedMs: number, locale: TuiLocale): string {
  const copy = tuiCopy(locale)
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  const seconds = total % 60
  const duration = locale === 'zh'
    ? hours > 0
      ? `${hours}时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`
      : minutes > 0 ? `${minutes}分${String(seconds).padStart(2, '0')}秒` : `${seconds}秒`
    : hours > 0
      ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
      : minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
  return `${copy.deepDiving} (${duration} • ${copy.interruptHint})`
}
