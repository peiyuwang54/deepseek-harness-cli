/** Shared Web/TUI locale preference and terminal-native copy. */

import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'

/** Durable namespace also consumed by the browser locale runtime. */
export const TUI_LOCALE_SETTINGS_NAMESPACE = settingsNamespace('locale')

/** Locale with complete terminal-owned copy. */
export type TuiLocale = 'en' | 'zh' | 'ar' | 'fr' | 'ru' | 'es' | 'ja' | 'ko'

/** One terminal language option, named in its own language. */
export interface TuiLocaleOption {
  readonly id: TuiLocale
  readonly label: string
}

/** Languages offered by the terminal selector. */
export const TUI_LOCALE_OPTIONS: readonly TuiLocaleOption[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
  { id: 'ar', label: 'العربية' },
  { id: 'fr', label: 'Français' },
  { id: 'ru', label: 'Русский' },
  { id: 'es', label: 'Español' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
]

const TUI_LOCALES: readonly TuiLocale[] = TUI_LOCALE_OPTIONS.map(option => option.id)

const TUI_LOCALE_ALIASES: Readonly<Record<string, TuiLocale>> = {
  english: 'en',
  chinese: 'zh',
  '中文': 'zh',
  arabic: 'ar',
  العربية: 'ar',
  french: 'fr',
  français: 'fr',
  russian: 'ru',
  русский: 'ru',
  spanish: 'es',
  español: 'es',
  japanese: 'ja',
  '日本語': 'ja',
  korean: 'ko',
  '한국어': 'ko',
}

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
  readonly pendingSteering: string
  readonly pendingSteeringInterrupt: string
  readonly settings: string
  readonly appearance: string
  readonly language: string
  readonly settingsDocument: string
  readonly current: string
  readonly moveSelectClose: string
  readonly languageChanged: string
  readonly durationHour: string
  readonly durationMinute: string
  readonly durationSecond: string
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
    editorRunningFooter: 'Enter steer · Esc interrupt · Shift+Enter newline',
    deepDiving: 'Deep diving',
    interruptHint: 'esc to interrupt',
    pendingSteering: 'Messages to be submitted after next tool call',
    pendingSteeringInterrupt: 'press esc to interrupt and send immediately',
    settings: 'Settings',
    appearance: 'Appearance',
    language: 'Language',
    settingsDocument: 'Settings document',
    current: 'current',
    moveSelectClose: '↑/↓ move • Enter select • Esc close',
    languageChanged: 'Interface language changed to English.',
    durationHour: 'h',
    durationMinute: 'm',
    durationSecond: 's',
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
    editorRunningFooter: 'Enter 引导 · Esc 中断 · Shift+Enter 换行',
    deepDiving: '正在深度求索',
    interruptHint: 'Esc 中断',
    pendingSteering: '将在下次工具调用后提交的消息',
    pendingSteeringInterrupt: '按 Esc 中断并立即发送',
    settings: '设置',
    appearance: '外观',
    language: '语言',
    settingsDocument: '设置文件',
    current: '当前',
    moveSelectClose: '↑/↓ 移动 • Enter 选择 • Esc 关闭',
    languageChanged: '界面语言已切换为中文。',
    durationHour: '时',
    durationMinute: '分',
    durationSecond: '秒',
  },
  ar: {
    welcomeBack: 'مرحبًا بعودتك!',
    whatsNew: 'ما الجديد',
    recentSessions: 'الجلسات الأخيرة',
    loadingSessions: 'جارٍ تحميل سجل الجلسات…',
    sessionsUnavailable: 'سجل الجلسات غير متاح في هذا الملف التعريفي.',
    noPreviousSessions: 'لا توجد جلسات سابقة في هذا الملف التعريفي.',
    preset: 'الإعداد المسبق:',
    model: 'النموذج:',
    permissions: 'الأذونات:',
    workspaceUnset: 'لم تُحدَّد مساحة العمل',
    skillsAction: 'استعرض مهارات الوكيل وشغّلها',
    permissionsAction: 'اختر وضع الموافقة والعزل',
    modelAction: 'بدّل النموذج ومستوى الاستدلال',
    workspaceAction: 'ابدأ في مساحة عمل أخرى',
    resumeAction: 'ابحث في الجلسات السابقة',
    helpHint: '/help للأوامر · @ لإرفاق ملف',
    compactActions: '/model النموذج  /resume الجلسات  /workspace مساحة العمل  /help المساعدة',
    shortcutHint: 'Enter إرسال · Shift+Enter سطر جديد · Alt+M النموذج · ? الاختصارات',
    inputPlaceholder: 'صِف مهمة، أو أرفق ملفًا باستخدام @، أو اكتب / لعرض الأوامر',
    editorIdleFooter: 'Enter إرسال · Shift+Enter سطر جديد · / الأوامر',
    editorRunningFooter: 'Enter توجيه · Esc مقاطعة · Shift+Enter سطر جديد',
    deepDiving: 'جارٍ الاستكشاف العميق',
    interruptHint: 'Esc للمقاطعة',
    pendingSteering: 'رسائل ستُرسل بعد استدعاء الأداة التالي',
    pendingSteeringInterrupt: 'اضغط Esc للمقاطعة والإرسال فورًا',
    settings: 'الإعدادات',
    appearance: 'المظهر',
    language: 'اللغة',
    settingsDocument: 'ملف الإعدادات',
    current: 'الحالي',
    moveSelectClose: '↑/↓ تنقّل • Enter اختيار • Esc إغلاق',
    languageChanged: 'تم تغيير لغة الواجهة إلى العربية.',
    durationHour: 'س',
    durationMinute: 'د',
    durationSecond: 'ث',
  },
  fr: {
    welcomeBack: 'Bon retour !',
    whatsNew: 'Nouveautés',
    recentSessions: 'Sessions récentes',
    loadingSessions: 'Chargement de l’historique des sessions…',
    sessionsUnavailable: 'L’historique des sessions n’est pas disponible dans ce profil.',
    noPreviousSessions: 'Aucune session précédente dans ce profil.',
    preset: 'préréglage :',
    model: 'modèle :',
    permissions: 'autorisations :',
    workspaceUnset: 'espace de travail non défini',
    skillsAction: 'parcourir et exécuter les compétences de l’agent',
    permissionsAction: 'choisir le mode d’approbation et d’isolation',
    modelAction: 'changer de modèle et de niveau de raisonnement',
    workspaceAction: 'démarrer dans un autre espace de travail',
    resumeAction: 'rechercher les sessions précédentes',
    helpHint: '/help pour les commandes · @ pour joindre un fichier',
    compactActions: '/model modèle  /resume sessions  /workspace espace  /help aide',
    shortcutHint: 'Enter envoyer · Shift+Enter nouvelle ligne · Alt+M modèle · ? raccourcis',
    inputPlaceholder: 'Décrivez une tâche, joignez un fichier avec @ ou tapez / pour les commandes',
    editorIdleFooter: 'Enter envoyer · Shift+Enter nouvelle ligne · / commandes',
    editorRunningFooter: 'Enter guider · Esc interrompre · Shift+Enter nouvelle ligne',
    deepDiving: 'Exploration approfondie',
    interruptHint: 'Esc pour interrompre',
    pendingSteering: 'Messages à envoyer après le prochain appel d’outil',
    pendingSteeringInterrupt: 'appuyez sur Esc pour interrompre et envoyer immédiatement',
    settings: 'Paramètres',
    appearance: 'Apparence',
    language: 'Langue',
    settingsDocument: 'Fichier de paramètres',
    current: 'actuel',
    moveSelectClose: '↑/↓ déplacer • Enter sélectionner • Esc fermer',
    languageChanged: 'Langue de l’interface définie sur le français.',
    durationHour: 'h',
    durationMinute: 'min',
    durationSecond: 's',
  },
  ru: {
    welcomeBack: 'С возвращением!',
    whatsNew: 'Что нового',
    recentSessions: 'Недавние сеансы',
    loadingSessions: 'Загрузка истории сеансов…',
    sessionsUnavailable: 'История сеансов недоступна в этом профиле.',
    noPreviousSessions: 'В этом профиле нет предыдущих сеансов.',
    preset: 'профиль:',
    model: 'модель:',
    permissions: 'разрешения:',
    workspaceUnset: 'рабочая область не задана',
    skillsAction: 'просмотреть и запустить навыки агента',
    permissionsAction: 'выбрать режим подтверждений и изоляции',
    modelAction: 'сменить модель и уровень рассуждений',
    workspaceAction: 'запустить в другой рабочей области',
    resumeAction: 'найти предыдущие сеансы',
    helpHint: '/help — команды · @ — прикрепить файл',
    compactActions: '/model модель  /resume сеансы  /workspace область  /help помощь',
    shortcutHint: 'Enter отправить · Shift+Enter новая строка · Alt+M модель · ? сочетания',
    inputPlaceholder: 'Опишите задачу, прикрепите файл через @ или введите / для команд',
    editorIdleFooter: 'Enter отправить · Shift+Enter новая строка · / команды',
    editorRunningFooter: 'Enter направить · Esc прервать · Shift+Enter новая строка',
    deepDiving: 'Глубокое исследование',
    interruptHint: 'Esc для остановки',
    pendingSteering: 'Сообщения будут отправлены после следующего вызова инструмента',
    pendingSteeringInterrupt: 'нажмите Esc, чтобы прервать и отправить сразу',
    settings: 'Настройки',
    appearance: 'Оформление',
    language: 'Язык',
    settingsDocument: 'Файл настроек',
    current: 'текущий',
    moveSelectClose: '↑/↓ перемещение • Enter выбор • Esc закрыть',
    languageChanged: 'Язык интерфейса изменён на русский.',
    durationHour: 'ч',
    durationMinute: 'мин',
    durationSecond: 'с',
  },
  es: {
    welcomeBack: '¡Qué bueno verte de nuevo!',
    whatsNew: 'Novedades',
    recentSessions: 'Sesiones recientes',
    loadingSessions: 'Cargando el historial de sesiones…',
    sessionsUnavailable: 'El historial de sesiones no está disponible en este perfil.',
    noPreviousSessions: 'No hay sesiones anteriores en este perfil.',
    preset: 'preajuste:',
    model: 'modelo:',
    permissions: 'permisos:',
    workspaceUnset: 'espacio de trabajo sin definir',
    skillsAction: 'explorar y ejecutar habilidades del agente',
    permissionsAction: 'elegir el modo de aprobación y aislamiento',
    modelAction: 'cambiar el modelo y el nivel de razonamiento',
    workspaceAction: 'iniciar en otro espacio de trabajo',
    resumeAction: 'buscar sesiones anteriores',
    helpHint: '/help para ver comandos · @ para adjuntar un archivo',
    compactActions: '/model modelo  /resume sesiones  /workspace espacio  /help ayuda',
    shortcutHint: 'Enter enviar · Shift+Enter nueva línea · Alt+M modelo · ? atajos',
    inputPlaceholder: 'Describe una tarea, adjunta un archivo con @ o escribe / para ver comandos',
    editorIdleFooter: 'Enter enviar · Shift+Enter nueva línea · / comandos',
    editorRunningFooter: 'Enter guiar · Esc interrumpir · Shift+Enter nueva línea',
    deepDiving: 'Exploración profunda',
    interruptHint: 'Esc para interrumpir',
    pendingSteering: 'Mensajes que se enviarán después de la próxima llamada a una herramienta',
    pendingSteeringInterrupt: 'pulsa Esc para interrumpir y enviar de inmediato',
    settings: 'Configuración',
    appearance: 'Apariencia',
    language: 'Idioma',
    settingsDocument: 'Archivo de configuración',
    current: 'actual',
    moveSelectClose: '↑/↓ mover • Enter seleccionar • Esc cerrar',
    languageChanged: 'El idioma de la interfaz se cambió a español.',
    durationHour: 'h',
    durationMinute: 'min',
    durationSecond: 's',
  },
  ja: {
    welcomeBack: 'おかえりなさい！',
    whatsNew: '新着情報',
    recentSessions: '最近のセッション',
    loadingSessions: 'セッション履歴を読み込み中…',
    sessionsUnavailable: 'このプロファイルではセッション履歴を利用できません。',
    noPreviousSessions: 'このプロファイルには過去のセッションがありません。',
    preset: 'プリセット：',
    model: 'モデル：',
    permissions: '権限：',
    workspaceUnset: 'ワークスペース未設定',
    skillsAction: 'エージェントスキルを参照して実行',
    permissionsAction: '承認とサンドボックスのモードを選択',
    modelAction: 'モデルと思考レベルを切り替え',
    workspaceAction: '別のワークスペースで開始',
    resumeAction: '過去のセッションを検索',
    helpHint: '/help でコマンド表示 · @ でファイル添付',
    compactActions: '/model モデル  /resume セッション  /workspace ワークスペース  /help ヘルプ',
    shortcutHint: 'Enter 送信 · Shift+Enter 改行 · Alt+M モデル · ? ショートカット',
    inputPlaceholder: 'タスクを入力、@ でファイルを添付、または / でコマンドを表示',
    editorIdleFooter: 'Enter 送信 · Shift+Enter 改行 · / コマンド',
    editorRunningFooter: 'Enter 指示 · Esc 中断 · Shift+Enter 改行',
    deepDiving: '深く探索中',
    interruptHint: 'Esc で中断',
    pendingSteering: '次のツール呼び出し後に送信されるメッセージ',
    pendingSteeringInterrupt: 'Esc で中断してすぐに送信',
    settings: '設定',
    appearance: '外観',
    language: '言語',
    settingsDocument: '設定ファイル',
    current: '現在',
    moveSelectClose: '↑/↓ 移動 • Enter 選択 • Esc 閉じる',
    languageChanged: 'インターフェース言語を日本語に変更しました。',
    durationHour: '時間',
    durationMinute: '分',
    durationSecond: '秒',
  },
  ko: {
    welcomeBack: '다시 오신 것을 환영합니다!',
    whatsNew: '새로운 기능',
    recentSessions: '최근 세션',
    loadingSessions: '세션 기록을 불러오는 중…',
    sessionsUnavailable: '이 프로필에서는 세션 기록을 사용할 수 없습니다.',
    noPreviousSessions: '이 프로필에는 이전 세션이 없습니다.',
    preset: '프리셋:',
    model: '모델:',
    permissions: '권한:',
    workspaceUnset: '작업 공간이 설정되지 않음',
    skillsAction: '에이전트 스킬 탐색 및 실행',
    permissionsAction: '승인 및 샌드박스 모드 선택',
    modelAction: '모델 및 추론 수준 전환',
    workspaceAction: '다른 작업 공간에서 시작',
    resumeAction: '이전 세션 검색',
    helpHint: '/help 명령어 보기 · @ 파일 첨부',
    compactActions: '/model 모델  /resume 세션  /workspace 작업 공간  /help 도움말',
    shortcutHint: 'Enter 전송 · Shift+Enter 줄 바꿈 · Alt+M 모델 · ? 단축키',
    inputPlaceholder: '작업을 설명하거나 @로 파일을 첨부하거나 /로 명령어를 확인하세요',
    editorIdleFooter: 'Enter 전송 · Shift+Enter 줄 바꿈 · / 명령어',
    editorRunningFooter: 'Enter 지시 · Esc 중단 · Shift+Enter 줄 바꿈',
    deepDiving: '심층 탐색 중',
    interruptHint: 'Esc로 중단',
    pendingSteering: '다음 도구 호출 후 제출할 메시지',
    pendingSteeringInterrupt: 'Esc를 눌러 중단하고 즉시 전송',
    settings: '설정',
    appearance: '외관',
    language: '언어',
    settingsDocument: '설정 파일',
    current: '현재',
    moveSelectClose: '↑/↓ 이동 • Enter 선택 • Esc 닫기',
    languageChanged: '인터페이스 언어를 한국어로 변경했습니다.',
    durationHour: '시간',
    durationMinute: '분',
    durationSecond: '초',
  },
}

/** Narrow an unknown setting to a locale with complete terminal copy. */
export function isTuiLocale(value: unknown): value is TuiLocale {
  return TUI_LOCALES.some(locale => locale === value)
}

/** Resolve a locale id or self-described language name from command input. */
export function resolveTuiLocale(value: string): TuiLocale | undefined {
  const normalized = value.trim().toLowerCase()
  if (isTuiLocale(normalized)) return normalized
  return TUI_LOCALE_ALIASES[normalized]
}

/** Return the self-described label for a terminal locale. */
export function tuiLocaleLabel(locale: TuiLocale): string {
  return TUI_LOCALE_OPTIONS.find(option => option.id === locale)?.label ?? locale
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
 * Format the TUI's live, interruptible turn row.
 * @param elapsedMs - Time since the durable `turn/start` event.
 * @param locale - Active terminal locale.
 * @returns Running label and optional elapsed clock.
 */
export function formatDeepDivingStatus(elapsedMs: number, locale: TuiLocale): string {
  const copy = tuiCopy(locale)
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  const seconds = total % 60
  const compactUnits = locale === 'zh' || locale === 'ja' || locale === 'ko'
  const separator = compactUnits ? '' : ' '
  const duration = hours > 0
    ? `${hours}${copy.durationHour}${separator}${String(minutes).padStart(2, '0')}${copy.durationMinute}${separator}${String(seconds).padStart(2, '0')}${copy.durationSecond}`
    : minutes > 0
      ? `${minutes}${copy.durationMinute}${separator}${String(seconds).padStart(2, '0')}${copy.durationSecond}`
      : `${seconds}${copy.durationSecond}`
  return `${copy.deepDiving} (${duration} • ${copy.interruptHint})`
}
