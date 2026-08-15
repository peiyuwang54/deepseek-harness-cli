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

/** Terminal copy for DeepSeek credential onboarding and management. */
export interface CredentialCopy {
  readonly title: string
  readonly connectTitle: string
  readonly connectDetail: string
  readonly updateDetail: string
  readonly inputHint: string
  readonly savingHint: string
  readonly configured: string
  readonly missing: string
  readonly source: string
  readonly configure: string
  readonly replace: string
  readonly remove: string
  readonly close: string
  readonly confirmRemove: string
  readonly cancel: string
  readonly saved: string
  readonly removed: string
  readonly unavailable: string
  readonly readOnly: string
  readonly empty: string
  readonly illegalCharacters: string
  readonly failed: string
  readonly usage: string
  readonly moveSelectClose: string
}

const CREDENTIAL_COPY: Readonly<Record<TuiLocale, CredentialCopy>> = {
  en: {
    title: 'DeepSeek API key', connectTitle: 'Connect DeepSeek',
    connectDetail: 'Paste your DeepSeek API key. It is masked and never added to chat history.',
    updateDetail: 'Paste the replacement DeepSeek API key. The value stays hidden.',
    inputHint: 'Enter save • Esc skip', savingHint: 'Saving…', configured: 'Configured', missing: 'Not configured',
    source: 'source', configure: 'Set API key', replace: 'Replace API key', remove: 'Remove saved API key',
    close: 'Close', confirmRemove: 'Remove the saved DeepSeek API key?', cancel: 'Cancel',
    saved: 'DeepSeek API key saved.', removed: 'Saved DeepSeek API key removed.',
    unavailable: 'Credential storage is unavailable in this profile.',
    readOnly: 'The active API key comes from a read-only environment source. Change it before starting DeepSeek CLI.',
    empty: 'Enter an API key.', illegalCharacters: 'API keys may contain printable ASCII characters only.',
    failed: 'Credential update failed', usage: 'Usage: /credentials [status|set|unset]',
    moveSelectClose: '↑/↓ move • Enter select • Esc close',
  },
  zh: {
    title: 'DeepSeek API Key', connectTitle: '连接 DeepSeek',
    connectDetail: '粘贴 DeepSeek API Key。输入会被遮蔽，也不会进入聊天记录。',
    updateDetail: '粘贴新的 DeepSeek API Key，内容始终隐藏。',
    inputHint: 'Enter 保存 • Esc 跳过', savingHint: '正在保存…', configured: '已配置', missing: '未配置',
    source: '来源', configure: '设置 API Key', replace: '更换 API Key', remove: '删除已保存的 API Key',
    close: '关闭', confirmRemove: '删除已保存的 DeepSeek API Key？', cancel: '取消',
    saved: 'DeepSeek API Key 已保存。', removed: '已删除保存的 DeepSeek API Key。',
    unavailable: '当前配置未提供凭据存储。',
    readOnly: '当前 API Key 来自只读环境变量，请在启动 DeepSeek CLI 前修改。',
    empty: '请输入 API Key。', illegalCharacters: 'API Key 只能包含可打印 ASCII 字符。',
    failed: '凭据更新失败', usage: '用法：/credentials [status|set|unset]',
    moveSelectClose: '↑/↓ 移动 • Enter 选择 • Esc 关闭',
  },
  ar: {
    title: 'مفتاح DeepSeek API', connectTitle: 'اتصال DeepSeek',
    connectDetail: 'ألصق مفتاح DeepSeek API. سيبقى مخفيًا ولن يُضاف إلى سجل المحادثة.',
    updateDetail: 'ألصق مفتاح DeepSeek API البديل. تبقى القيمة مخفية.',
    inputHint: 'Enter حفظ • Esc تخطي', savingHint: 'جارٍ الحفظ…', configured: 'مُعدّ', missing: 'غير مُعدّ',
    source: 'المصدر', configure: 'تعيين مفتاح API', replace: 'استبدال مفتاح API', remove: 'حذف المفتاح المحفوظ',
    close: 'إغلاق', confirmRemove: 'حذف مفتاح DeepSeek API المحفوظ؟', cancel: 'إلغاء',
    saved: 'تم حفظ مفتاح DeepSeek API.', removed: 'تم حذف مفتاح DeepSeek API المحفوظ.',
    unavailable: 'تخزين بيانات الاعتماد غير متاح في هذا الملف التعريفي.',
    readOnly: 'يأتي مفتاح API النشط من بيئة للقراءة فقط. غيّره قبل تشغيل DeepSeek CLI.',
    empty: 'أدخل مفتاح API.', illegalCharacters: 'يجب أن يحتوي مفتاح API على أحرف ASCII قابلة للطباعة فقط.',
    failed: 'فشل تحديث بيانات الاعتماد', usage: 'الاستخدام: /credentials [status|set|unset]',
    moveSelectClose: '↑/↓ تنقّل • Enter اختيار • Esc إغلاق',
  },
  fr: {
    title: 'Clé API DeepSeek', connectTitle: 'Connecter DeepSeek',
    connectDetail: 'Collez votre clé API DeepSeek. Elle est masquée et jamais ajoutée à l’historique.',
    updateDetail: 'Collez la nouvelle clé API DeepSeek. La valeur reste masquée.',
    inputHint: 'Enter enregistrer • Esc ignorer', savingHint: 'Enregistrement…', configured: 'Configurée', missing: 'Non configurée',
    source: 'source', configure: 'Définir la clé API', replace: 'Remplacer la clé API', remove: 'Supprimer la clé enregistrée',
    close: 'Fermer', confirmRemove: 'Supprimer la clé API DeepSeek enregistrée ?', cancel: 'Annuler',
    saved: 'Clé API DeepSeek enregistrée.', removed: 'Clé API DeepSeek enregistrée supprimée.',
    unavailable: 'Le stockage des identifiants n’est pas disponible dans ce profil.',
    readOnly: 'La clé API active vient d’un environnement en lecture seule. Modifiez-la avant de lancer DeepSeek CLI.',
    empty: 'Saisissez une clé API.', illegalCharacters: 'La clé API ne peut contenir que des caractères ASCII imprimables.',
    failed: 'Échec de la mise à jour des identifiants', usage: 'Utilisation : /credentials [status|set|unset]',
    moveSelectClose: '↑/↓ déplacer • Enter sélectionner • Esc fermer',
  },
  ru: {
    title: 'Ключ DeepSeek API', connectTitle: 'Подключить DeepSeek',
    connectDetail: 'Вставьте ключ DeepSeek API. Он скрыт и не попадает в историю чата.',
    updateDetail: 'Вставьте новый ключ DeepSeek API. Значение останется скрытым.',
    inputHint: 'Enter сохранить • Esc пропустить', savingHint: 'Сохранение…', configured: 'Настроен', missing: 'Не настроен',
    source: 'источник', configure: 'Задать ключ API', replace: 'Заменить ключ API', remove: 'Удалить сохранённый ключ',
    close: 'Закрыть', confirmRemove: 'Удалить сохранённый ключ DeepSeek API?', cancel: 'Отмена',
    saved: 'Ключ DeepSeek API сохранён.', removed: 'Сохранённый ключ DeepSeek API удалён.',
    unavailable: 'Хранилище учётных данных недоступно в этом профиле.',
    readOnly: 'Активный ключ API задан в среде только для чтения. Измените его до запуска DeepSeek CLI.',
    empty: 'Введите ключ API.', illegalCharacters: 'Ключ API может содержать только печатные символы ASCII.',
    failed: 'Не удалось обновить учётные данные', usage: 'Использование: /credentials [status|set|unset]',
    moveSelectClose: '↑/↓ перемещение • Enter выбор • Esc закрыть',
  },
  es: {
    title: 'Clave API de DeepSeek', connectTitle: 'Conectar DeepSeek',
    connectDetail: 'Pega tu clave API de DeepSeek. Se oculta y nunca se añade al historial del chat.',
    updateDetail: 'Pega la nueva clave API de DeepSeek. El valor permanece oculto.',
    inputHint: 'Enter guardar • Esc omitir', savingHint: 'Guardando…', configured: 'Configurada', missing: 'Sin configurar',
    source: 'origen', configure: 'Configurar clave API', replace: 'Reemplazar clave API', remove: 'Eliminar clave guardada',
    close: 'Cerrar', confirmRemove: '¿Eliminar la clave API de DeepSeek guardada?', cancel: 'Cancelar',
    saved: 'Clave API de DeepSeek guardada.', removed: 'Clave API de DeepSeek guardada eliminada.',
    unavailable: 'El almacenamiento de credenciales no está disponible en este perfil.',
    readOnly: 'La clave API activa procede de un entorno de solo lectura. Cámbiala antes de iniciar DeepSeek CLI.',
    empty: 'Introduce una clave API.', illegalCharacters: 'La clave API solo puede contener caracteres ASCII imprimibles.',
    failed: 'No se pudo actualizar la credencial', usage: 'Uso: /credentials [status|set|unset]',
    moveSelectClose: '↑/↓ mover • Enter seleccionar • Esc cerrar',
  },
  ja: {
    title: 'DeepSeek API キー', connectTitle: 'DeepSeek に接続',
    connectDetail: 'DeepSeek API キーを貼り付けます。入力は隠され、チャット履歴には追加されません。',
    updateDetail: '新しい DeepSeek API キーを貼り付けます。値は常に非表示です。',
    inputHint: 'Enter 保存 • Esc スキップ', savingHint: '保存中…', configured: '設定済み', missing: '未設定',
    source: '取得元', configure: 'API キーを設定', replace: 'API キーを変更', remove: '保存済み API キーを削除',
    close: '閉じる', confirmRemove: '保存済み DeepSeek API キーを削除しますか？', cancel: 'キャンセル',
    saved: 'DeepSeek API キーを保存しました。', removed: '保存済み DeepSeek API キーを削除しました。',
    unavailable: 'このプロファイルでは認証情報ストレージを利用できません。',
    readOnly: '有効な API キーは読み取り専用の環境変数から取得されています。DeepSeek CLI の起動前に変更してください。',
    empty: 'API キーを入力してください。', illegalCharacters: 'API キーには印刷可能な ASCII 文字だけを使用できます。',
    failed: '認証情報の更新に失敗しました', usage: '使用法: /credentials [status|set|unset]',
    moveSelectClose: '↑/↓ 移動 • Enter 選択 • Esc 閉じる',
  },
  ko: {
    title: 'DeepSeek API 키', connectTitle: 'DeepSeek 연결',
    connectDetail: 'DeepSeek API 키를 붙여 넣으세요. 입력은 가려지며 채팅 기록에 추가되지 않습니다.',
    updateDetail: '새 DeepSeek API 키를 붙여 넣으세요. 값은 계속 숨겨집니다.',
    inputHint: 'Enter 저장 • Esc 건너뛰기', savingHint: '저장 중…', configured: '설정됨', missing: '설정되지 않음',
    source: '출처', configure: 'API 키 설정', replace: 'API 키 교체', remove: '저장된 API 키 삭제',
    close: '닫기', confirmRemove: '저장된 DeepSeek API 키를 삭제할까요?', cancel: '취소',
    saved: 'DeepSeek API 키를 저장했습니다.', removed: '저장된 DeepSeek API 키를 삭제했습니다.',
    unavailable: '이 프로필에서는 자격 증명 저장소를 사용할 수 없습니다.',
    readOnly: '활성 API 키가 읽기 전용 환경에서 제공됩니다. DeepSeek CLI를 시작하기 전에 변경하세요.',
    empty: 'API 키를 입력하세요.', illegalCharacters: 'API 키에는 인쇄 가능한 ASCII 문자만 사용할 수 있습니다.',
    failed: '자격 증명 업데이트 실패', usage: '사용법: /credentials [status|set|unset]',
    moveSelectClose: '↑/↓ 이동 • Enter 선택 • Esc 닫기',
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

/** Resolve credential-management copy for a selected terminal locale. */
export function tuiCredentialCopy(locale: TuiLocale): CredentialCopy {
  return CREDENTIAL_COPY[locale]
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
