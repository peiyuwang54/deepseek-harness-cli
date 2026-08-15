# @deepseek-ai/dsh-tui

[English](README.md) | 中文

DeepSeek Harness agent（智能体）的交互式终端入口，基于 [`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui) 构建。它要求 stdin 和 stdout 均为 TTY；脚本和 Loader pipe 应改用单次执行的 [`@deepseek-ai/dsh-headless`](../../bundle/headless/README.md) profile。

已实现的[随发行版交付 TUI CLI Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-shipped-tui-cli-front-door.md)持有入口、组合、兼容性、来源与验证决策。

支持 macOS、Linux 和 Windows 上的交互式终端。Windows 使用 pi-tui 原生控制台 VT 输入处理与 ConPTY 进程验证。

Renderer 默认使用终端原生 inline scrollback。鼠标滚轮只滚动不断增长的聊天记录，鼠标拖选由终端直接处理，而键盘 Up／Down 只负责切换编辑器输入历史。普通内建选择器会附着在 composer：使用统一背景表面的 composer 保持可见，命令对应的面板紧贴在它下方展开，状态行继续位于面板之下，而不是让模态框盖住对话中央。Slash 命令、Skill、工作区文件和会话引用补全也使用同一布局：composer 内容结束后，候选列表从后续行开始渲染，不会进入输入背景表面。根 `/` catalog 只保留普通命令；具体 Skill 行只会在明确输入 `/skill:` 或打开 `/skills` 浏览器后出现。审批请求和结构化用户问题会继续使用模态样式，因为它们会中断执行并要求明确回答；`/resume` 仍保留专用的全 viewport 浏览器。获得焦点的编辑器会保留 pi-tui 的硬件 cursor marker 作为终端 IME 锚点，并每隔 530 ms 交替渲染一个单字符软件光标，因此即使终端配置禁用或忽略光标闪烁，输入焦点仍清晰可见。按键会重新开始可见阶段。Shift/Alt+Enter 插入换行，bracketed paste 保留多行内容，任意光标位置仍可使用 `@` 补全。Ctrl+G 会释放终端所有权，用 `VISUAL` 或 `EDITOR` 打开当前草稿，并在编辑器退出后恢复已保存文本与完整 TUI；`VISUAL` 优先，`code --wait` 等命令可以包含参数。设置 `fullscreen: true` 后会启用有界 alternate-screen transcript，此时 Page Up／Page Down 负责滚动，Ctrl+End 恢复跟随尾部；再设置 `mouse: true` 才会接管点击与滚轮，用于模型和 footer 操作、选择器、补全及 transcript 滚动，此时文本框选通常需要按住 Shift。

全新的空会话会打开一张自适应、借鉴 Claude Code 编排方式的双栏欢迎卡，但不会复制 Claude 的产品文案或资产。标题显示基础包版本号；左栏显示欢迎语、由仓库第一方 DeepSeek SVG 鲸鱼标志派生的 Braille 字符栅格，并投影已组合的 agent preset、所选模型、有效 permission preset 或 approval policy 以及 workspace。鲸鱼继承终端前景色，因此在浅色终端中呈黑色，在深色终端中仍然可见。右栏列出真实存在的 Harness 入口，并通过可选 session-query 服务显示最多两个最新会话。较窄终端使用缩小鲸鱼、紧凑状态行和操作行。欢迎卡与输入框之间只保留两行安静留白，不再用空 transcript 把输入框推到屏幕底部。第一个 turn 开始后，欢迎卡会自动收缩为普通 transcript header。最近会话行只提供信息而不直接点击；搜索与校验仍由 `/resume` 持有。

提示词区域是无边框多行 composer，其水平留白和背景与每张已提交的用户消息卡片保持一致。提交后的提示词会继续显示在 transcript 中，但不带 `You:` 或提示符标签，同时也保留在持久 Session 和编辑器历史中。操作提示会根据 idle／running 状态切换发送或 steer／cancel 文案，第一条底部状态栏则把紧凑 token 用量、模型和上下文压力与可编辑文本分开。第二条居中统计栏会复用 Web 的全日志 `sessionStats` 投影与 token 计量，显示轮次／步骤、LLM 与工具总耗时、平均 TTFT、解码吞吐、缓存命中率以及计费输入／输出 token。缺失事实会整组省略而不是伪造为零；窄终端会在单行内省略，不会折行挤压编辑器。这些标签投影自当前服务和会话事件，不是另一套 UI 配置真相源。

受 Codex 启发的开发者命令是 Harness 服务之上的终端原生适配器。`/skills` 浏览当前 Agent 作用域中面向用户可调用的 catalog；`/keymap` 与 `/vim` 在默认编辑和 Vim Insert／Normal 模式间切换 composer；`/fast` 仅选择元数据真正标识为 flash、fast、turbo 或 lite 的已公布路由，没有这类路由时不会假称加速。`/experimental` 统一启动现有的 fast、Vim、reasoning 可见性与 Loader reload action。`/ide` 报告检测到的终端宿主，并提供 `@` 文件引用或 workspace handoff；没有 IDE bridge 时仍无法捕获已打开文件与选区。`/approve` 会允许活动请求一次，或为下一个与最新交互拒绝在工具和理由上完全匹配的请求预批准一次；如果下一个请求不匹配，它会消耗该授权但不会获得批准，命令也绝不改变 permission preset。

本包（package）只持有交互式终端展示和输入。它注入 `agents`、[`commands`](../../interaction/commands/README.md)、`approval`、`llm`、`systemPrompt`、`tokenMeter`、`tools` 和 `userQuestions`，在组合存在时可选读取 `credentials`、`hooks`、`settings`、`skills` 与 `workspaceRegistry` 服务，然后驱动由 app 或开发者代码创建或恢复的 agent。Agent 生命周期、持久化、审批策略与模型侧 [`ask_user_question`](../../interaction/tool-ask-user/README.md) 工具仍是独立组合项。

终端成功启动后，本包会提供终端本地的 `ctx.tui` 扩展服务。注入该服务的插件可以使用组件工厂和受限布局选项调用 `openOverlay()`；宿主会公开 viewport、语义化主题（包括终端安全的 DeepSeek `brand` 样式）、显示文本转义、重绘、关闭和生命周期信号，但不公开 pi-tui 树、终端、焦点控制器或 overlay 句柄。插件 overlay、附着 composer 的选择器、用户问题与审批请求虽然位置不同，但共用一个 FIFO 焦点队列。每个请求都是调用方插件 fiber 的 effect，因此卸载会移除排队工作，或在清理结算前关闭可见工作；终端关闭会先卸载依赖项，再停止 pi-tui。Overlay 状态不会记录或回放。组件代码受信任，可以渲染 ANSI 样式，但必须通过 `host.display()` 处理不受信任文本。

TUI 从追加来源的会话事件重建已恢复历史，渲染 Markdown 响应与 reasoning，将每个工具的 `presentCall` / `presentResult` 意图应用到终端、diff 或通用卡片，把站立的 `todo/write` 计划保留在编辑器上方直至下一个 `turn/start`，并内联展示 `ctx.userQuestions`。Agent 作用域的审批请求使用同一个模态队列，策略与持久审计事件仍由 `ctx.approval` 持有。会话标题、重试、token 用量、上下文压力、模型选择与 compaction 标记都继续投影其所属服务和会话事件；表层替换不会抹掉已经渲染的对话。

Turn 运行时，动态 `正在深度求索 (<elapsed> • Esc 中断)` 行固定在实时对话尾部，并从持久 `turn/start` 计时；turn 结算后该行消失，已完成步骤仍保留分阶段计时摘要。右侧 footer 继续显示 Goal、模型、token、context 与排队会话状态，不再重复运行标签。

Markdown 响应支持标题、强调、链接、嵌套列表与任务列表、引用、GFM 表格和围栏代码。`diff` 与 `patch` 围栏使用和工具 diff 卡片一致的语义色板区分新增行、删除行、hunk 表头和文件元数据；diff 卡片把同一文件的相邻 hunk 收在单一路径下，并以 `⋯` 分隔。

如果逻辑工作区标签与会话宿主目录不同，嵌入方可以提供 `TuiRuntime.formatCwd`。该覆盖只改变 footer 标签；工具仍使用会话 `cwd`。

在模型输出、会话事件、工具 presenter、问题、配置或诊断到达 pi-tui 的 ANSI 感知 renderer 或终端标题前，TUI 会把换行之外的 C0 和 C1 控制字符渲染为可见 `\xNN` 文本。这些来源无法添加终端控制序列；终端渲染与样式仍由 TUI 和 pi-tui 持有。

在 token 边界输入 `@` 会搜索会话工作目录下的文件和目录。没有路径的模糊查询使用可复用的有界工作区索引；包含 `/` 的查询直接列出该目录，选择文件夹后会保持补全开启以继续深入。搜索默认遵守仓库 `.git/info/exclude`、分层 `.gitignore` 与嵌套 `.ignore` 规则。含空白的路径会插入为 `@"path with spaces"`。选择文件只会插入其路径和一个尾随空格：TUI 不会读取文件、附加隐藏上下文，也不会把路径替换为引用对象。注册模型侧 `read` 工具后，TUI 会添加一条固定系统提示词指令，要求模型在需要显式路径内容时读取该路径。

挂载可选的 `ctx.sessionReferenceResolver` 后，同一个 `@` 菜单还会提供仅含元数据的会话候选项，插入 `@[label](dsh-session:<payload>)`，并在分派前准备所选快照。会话引用保持结构化，因为模型没有类似文件系统的工具可在稍后检索会话快照。准备期间会禁止重复提交，并在失败时恢复编辑器输入。准备完成后，TUI 会注入解析后的上下文，并根据当前状态选择 `agent.steer()` 或 `agent.followup()`；不存在单独的 prompt-admission hook。

Agent 运行时，普通编辑器提交会调用 `agent.steer()`；其他时候调用 `agent.followup()`。提交行以斜杠开头时会改为进入 `ctx.commands`：已知命令直接执行，未知命令产生警告，两条路径都不会自动到达模型。命令生产方可以显式调度 agent 工作；[`dsh-plan-mode`](../../plan/plan-mode/README.md#model-and-human-interactions) 使用该契约实现 `/plan [message]`。TUI 将 `/help`、`/model`、`/fast`、`/skills`、`/agent`、`/subagents`、`/keymap`、`/vim`、`/experimental`、`/ide`、`/mention`、`/approve`、`/init`、`/review`、`/new`、`/clear`、`/copy`、`/export`、`/diff`、`/details`、`/raw`、`/palette`、`/reload`、`/resume`、`/fork`、`/side`、`/rename`、`/archive`、`/delete`、`/language`、`/personality`、`/settings`、`/credentials`、`/theme`、`/workspace`、`/status`、`/usage`、`/exit` 和 `/quit` 注册为 agent 作用域定义；其他所有有效命令都会动态加入自动补全与 `/help`，`/skill:` 补全也相同。共享 permission service 会贡献 `/permissions [preset]`。不带参数的 `/permissions` 会打开一个附着 composer 的选择器，其选项来自服务当前的 preset 表；选中条目会提交与 Web 选择器相同的带参命令，而 `/permissions <preset>` 仍是直接切换路径。无人值守启动由随附应用的 `deepseek --full-auto` 与 `deepseek --yolo` 参数持有，因此会话命令 catalog 有意不包含对应快捷命令。欢迎卡片与 footer 会显示配置的展示名称，而不是存储 key。运行时 composer 操作提示显示 `Enter steer · Esc interrupt`。每条已提交的 steering 消息都会立即按顺序显示在 composer 上方，并在对应 inbox 身份被 claim 或 discard 前计入 footer 排队数量；随后的持久 `user/message` 会以普通聊天卡片替代该瞬时预览。有待发 steering 时，Escape 会保留整批消息、中断当前调用并唤醒它们立即交付；没有待发消息时的 Escape 与 Ctrl+C 仍执行普通取消。在实时独立压缩（compaction）标记对处于开启状态期间，composer 上方会显示固定的 `Context being compacted <elapsed>` 状态行，终端进度状态保持活跃直至标记对闭合。该状态绝不会从日志中重建；闭合失败时会向 transcript 添加 `Compaction failed: <error>`，而恢复会话时遇到的陈旧未匹配 start 绝不会激活该指示器。工具卡片保留可配置的折叠头尾预览，注入上下文卡片在紧凑状态下则渲染零行。Ctrl+O 在折叠、展开、隐藏三种详情状态之间循环；只有展开状态会显示注入上下文，并在去掉生产方 reminder 外框后呈现来源标签与完整文本。隐藏阶段还会把每个轮次的 assistant 步骤折叠为一条消息：第一个有可见文本或 reasoning 的步骤使用该轮次开头的 `•`，之后的步骤渲染为对齐续段，没有可见正文的步骤则不渲染任何内容；离开隐藏阶段会恢复每步各自的项目符号。Ctrl+R 切换 reasoning，Ctrl+L 重绘，Ctrl+D 在空闲时退出。`/details` 命名的正是这两个快捷键循环的同一份状态：不带参数时打开一个附着 composer 的键盘开关，每个维度一个条目——`Tool cards` 与 `Reasoning`——显示实时值，Tab 循环高亮条目并立即应用变更（编辑器上方的 transcript 即是预览），Enter、Esc 或 Ctrl+C 关闭；`/details collapsed|expanded|hidden` 让工具卡片直接跳到该阶段，`/details reasoning [on|off]` 设置——或裸 `reasoning` 切换——reasoning 块显示；参数可在一次调用中组合，未知参数会以用法行报错，组合调用先应用 reasoning，使其 transcript 重建不会丢掉卡片通知。

`/copy` 通过 OSC 52 将 transcript 中最新可见的 assistant 回复作为原始 Markdown 写入剪贴板，支持 tmux 透传，并在编码前拒绝超过 100,000 个 UTF-8 字节的回复。不带参数的 `/export` 会打开选择器，用于复制完整 Markdown 对话或准备可编辑的默认文件名；`/export <path>` 会相对于工作区直接写入，展开开头的 home 标记，并且绝不替换已有目标。导出内容保留人类直接输入、assistant Markdown、配对工具活动、当前可见 reasoning、图片和仍在进行的模型流，同时排除注入上下文和仅供模型使用的替换事件；剪贴板导出使用与 `/copy` 相同的 OSC 52 上限。`/diff` 会追加当前未暂存 Git diff，并为每个未跟踪且未忽略的文件追加 no-index diff。它保持只读：禁用外部 diff helper、textconv、hook、文件系统 monitor 以及配置的 clean/process 可执行程序；每个 Git 子进程由 `gitDiffTimeoutMs` 限时。`/mention` 会插入 `@` 并打开工作区补全；`/mention <path>` 直接插入该路径。`/rename` 会在 composer 中恢复 `/rename ` 以便继续输入标题，而 `/rename <title>` 会通过可选的 session-title service 记录规范化的用户标题，并立即更新终端标题。

`/raw` 会在富卡片与便于复制的无样式对话源码之间切换；`/raw on`、`/raw off` 与 `/raw status` 是显式形式。Raw 模式会保留人类和 assistant 的原始 Markdown、可见 reasoning、配对工具活动与未结束的模型流，同时去掉角色标题、卡片背景、项目符号和 Markdown 样式。该状态只属于当前进程，不会修改 Session 日志或导出内容。

`/new` 与 `/clear` 都要求 agent 处于 idle；它们会 flush 当前持久会话、释放终端，并请求随附进程宿主在同一个不可变 workspace 中启动全新对话。自定义宿主未提供 handoff 或替换被拒绝时，当前会话与终端仍可继续使用。

`/fork` 是一个 agent 作用域命令，要求 agent 处于 idle 且已挂载持久会话存储。命令生命周期结算后，它会把完整的当前日志复制到一个带新 id 与 parent 链接的子会话，flush 两个会话，再请求同一个进程宿主在当前 workspace 中切换到子会话。切换失败时原终端仍可使用，并会报告保留的子会话 id，便于之后通过 `/resume` 恢复。

`/side [message]` 会在父会话至少完成一轮用户对话后打开临时旁路对话；`/btw` 是不显示在命令目录中的别名。它继承最近一个完整轮次前缀、preset、模型和推理强度，但只把旧指令当作参考，关闭继承的 Plan 模式与 Goal 激活，并禁止子代理和 workflow 工具。旁路 transcript 会隐藏继承行及内部边界，只保留 `/copy`、`/diff`、`/export`、`/ide`、`/mention`、`/raw`、`/status` 和 `/usage`。旁路运行时 Ctrl+C 先中断，空闲时 Ctrl+C 返回未被修改的父会话。随后旁路 Agent 会被释放，其带 `ephemeral` 标记的 Session header 与事件不会进入持久化或 `/resume`。

`/agent` 与别名 `/subagents` 会打开一个附着 composer 的选择器，列出存活的主 Agent 与 `ctx.subagents` 返回的所有存活后代。每行显示持久标签、模式、运行状态、当前标记和会话 id；非活动或无法读取的子项不会进入可切换列表，可改用 `/resume` 打开。选择其他行会把同一个终端通道重新挂载到该 Agent，不会停止任何 Agent，也不会修改 Session 日志。当前 Agent 必须处于 idle，交互 provider 才能安全卸载；所选目标可以已经在运行。如果当前可见子 Agent 随后被 dispose，通道会自动返回仍存活的主 Agent。未提供导航宿主或 subagent service 的自定义 renderer embedding 会报告能力缺失，不会显示虚构条目。

`/archive` 仅在主 Agent 空闲时可用。它会打开确认卡片，刷新 Session，将其 id 加入持久化 workspace 归档集合，并且只在归档写入成功后退出。归档会让 Session 从活动 workspace 列表中隐藏，但保留完整日志。`/delete` 使用单独的破坏性确认，通过持久化服务永久删除当前 Session 日志，并且只在删除成功后退出。两条命令都会拒绝子 Agent 视图；所需存储不可用、写入失败或确认期间开始新轮次时，当前 TUI 会保持打开。

`/debug-config` 按从低到高的优先级报告当前 profile、Loader 根文件与启动器持有的配置来源层。它只列出路径与环境开关名称，绝不显示配置值；需要完整且不启动应用的组合树时，请运行输出中的 `deepseek --profile <name> --dump-config`。未提供启动器来源信息的自定义 embedding 会明确报告该诊断不可用。

`/title` 配置终端窗口或标签页标题，不会重命名持久 Session。不带参数的 `/title` 会打开多选对话框，可选择应用名、Session 标题、工作区、运行状态、模型、推理强度与 Session id。Space 切换字段并实时预览终端标题，Enter 将按目录顺序排列的选择持久化到 `ui-terminal.titleItems`，Escape 恢复之前的标题。`/title status`、`/title reset` 与 `/title set <item> ...` 分别用于非交互查看、恢复默认值和指定明确顺序。修改持久 Session 标题仍使用 `/rename`。

`/statusline` 配置紧凑 footer。不带参数时会打开有序多选对话框：Up/Down 选择行，Left/Right 调整顺序，Space 切换并实时预览，Enter 持久化 `ui-terminal.statusLineItems`，Escape 恢复之前的 footer。可选字段包括 Goal、详情、运行状态、模型、推理强度、token 与上下文用量、排队工作、preset、权限、工作区、Git 分支、Session 标题和 Session id；暂不可用的值会被省略。`/statusline status`、`/statusline off`、`/statusline reset` 与 `/statusline set <item> ...` 支持脚本调用。Reset 会恢复当前 profile 的 `theme.rightPrompt`，不会生成第二套默认值。

`/init` 会安排一个普通用户轮次：先检查仓库，仅当当前目录不存在 `AGENTS.md` 时才创建简洁且基于事实的版本。`/review [instructions]` 会安排一次不修改文件的审查，覆盖 workspace 中已跟踪与未跟踪的改动，并按问题严重程度输出。两条命令都要求 agent 处于 idle，其提示词会走普通的持久 user-message 路径，不会绕过 agent loop。

共享的 [`dsh-command-jobs`](../../jobs/command-jobs/README.md) 插件会贡献 `/ps`、`/stop` 与别名 `/clean`。`/ps` 在不消费输出的前提下列出本会话中处于运行或停止中状态的通用后台任务；`/stop` 与 `/clean` 请求取消全部运行中任务，并保持已经处于停止中状态的任务不变。

`/model`、Alt+M 或左键点击编辑器旁的模型徽标，会把建议性的 `ctx.llm` catalog 紧贴在 composer 下方打开，而不是放在终端中央。列表上方设有一个过滤框，按对每行 `provider/model` 标签、模型名称和描述的大小写不敏感子串匹配来缩小行集，并在高亮行仍通过过滤时保持其选中状态。Up/Down 或鼠标滚轮在模型间移动。专用的 `Reasoning effort` 行会始终列出适配器为高亮模型公布的精确等级（包括存在时的 `Off`），并用方括号标记当前选择；Tab 或 Right 向前切换，Shift+Tab 或 Left 向后切换。Enter 选择当前可见的模型与推理强度组合；Escape 会先清除非空过滤内容，再次按下才关闭选择器。适配器未公布默认推理强度时，该行还会包含 `Default`，用于清除显式选择并保留提供方行为；没有 reasoning 元数据的模型会显示 `Not available`。选择器不会合成、自动调整或在模型之间转移推理强度。`/model <model>` 仍可直接选择无歧义的模型 id，`/model <provider>/<model>` 则选择精确目标，并在存在时使用其适配器默认值。已配置目标或最新记录的请求 header 会初始化选择器；由于 catalog 仅提供建议，未列出的当前模型仍会显示。选择仅对本 TUI 会话有效。提示词组装会为一个步骤建立目标快照，替换 `{{provider}}` 和 `{{model}}`，并通过 `agent/request` 应用同一个提供方／模型／推理强度目标；因此组装期间的切换会从后续步骤开始生效。请求 header 会持久记录真正到达模型的目标，未使用的选择则只存在于进程本地。

`/model off`、`/model high` 与 `/model max` 会直接选择当前路由公布的对应推理强度。不可用的等级只会报告 catalog 限制，不会改变选择。

`/mcp [verbose]` 会列出当前 Agent 作用域工具注册表中可见的 MCP 限定工具。默认视图输出稳定的公开工具名；`verbose` 还会输出经规整的描述。它不会暴露无关工具，也不会推断工具注册表不持有的服务器连接状态。

`/memories [verbose]` 会以只读方式展示当前 Agent 可见的 Memory MCP 能力。它按 MCP server id 中的 `memory`、`memorix` 或 `engram` 识别并归组工具；`verbose` 还会输出经规整的工具描述。DeepSeek Harness 不内置记忆存储，因此使用、生成、保留与重置仍由已配置的 provider 持有。可选 provider 见 [`examples/mcp-memory`](../../../examples/mcp-memory/README.md)。

`/hooks [verbose]` 会列出可选 `ctx.hooks` 中成功加载的 Claude Code 与 Codex hook 桥接配置。默认视图报告每个来源和可运行 handler 总数；`verbose` 展开生命周期点、matcher、命令、超时覆盖与已解析但被跳过的 handler。该命令只用于诊断且为只读；启用、信任、禁用或编辑 hook 仍由 profile 配置负责。

`/plugins [verbose] [query]` 会浏览当前 profile 的实时 Cordis Loader 清单。默认输出最多 20 行，并报告配置总数、active 数与 disabled 数；query 可按模块标识或 Loader id 过滤，`verbose` 则补充完整值与根 Fiber 阶段。该浏览器为只读。安装 profile 软件包需在 chat 外运行 `deepseek plugin --profile tui add <package>`；移除或更新时在相同位置使用 `remove` 或 `update`，也可使用等价的 `dsh` 写法。

`/import` 会检测 Claude Code 与 Codex 的兼容本地配置；两者都有可导入内容时先选择来源，再通过默认勾选的多选器选择用户／项目 Skill 和指令。`/import claude|codex [all|skills|instructions]` 可直接指定来源，并可跳过条目选择器执行。兼容的 `SKILL.md` bundle 与扁平 Markdown Skill 会复制到 `.agents/skills`；用户指令进入 `$DSH_HOME/AGENTS.md`，只存在于项目产品目录中的指令进入项目 `AGENTS.md`。已有目标会原样保留，符号链接与特殊文件会被拒绝；项目根目录的 `CLAUDE.md` 已由 Harness 原生读取，无需导入。设置、插件、hook、MCP server 和聊天历史不会跨越格式或生命周期所有权不同的产品复制。

`/reload`（实验性，仅开发环境）会重新读取所有基于文件的 loader 配置树，并把 diff 应用到运行中 app：它手动调用 HMR（热模块替换）watcher 的配置路径；上下文中必须有 cordis Loader，否则退化为警告。它只在 agent 空闲时运行，并拒绝 reload 进行期间的再次进入。模块源代码热重载仍由 watcher 持有。挂载 `skills` 服务后，`/skill:<name> [instructions]` 会把该 skill 的指令作为一个 user 轮次加载到会话中；自动补全列出用户可调用的 skill，按精确名称调用时也会拒绝用户策略禁用的 skill。

默认紧凑 footer 右侧显示 Goal／详情状态、当前模型、`↑<uncached input> ↓<output>`、已知的 token-meter 上下文压力和排队工作。左侧默认为空，因此工作目录和分支在通过 `/statusline` 选择或通过 `theme.leftPrompt` 配置前不会占用聊天宽度。默认项也不含 idle 状态和缓存命中率：实时工作由对话尾部的动态状态表达，缓存命中率则保留在详细会话统计行。

`/status` 会向 transcript 添加一张时间点诊断卡片，并在 agent 运行时保持可用。它报告会话 id、标题、工作目录、所选提供方／模型、所选推理强度或默认行为、reasoning 块可见性、agent 状态、事件／轮次／步骤／工具调用计数、精确输入／输出／缓存 token bucket、KV-cache 命中率、token-meter 上下文用量与容量、创建时间和最新事件时间。缺失标题、模型、缓存输入或上下文容量时会明确标记，而非推断。该卡片只存在于终端，不会重复紧凑 footer，也不会打印 system prompt 或已注册工具 catalog。

`/usage` 会记录一份时点副本，其内容来自与 Web composer 共享的同一条全会话统计线：已完成轮次与步骤、LLM 与工具耗时、平均 TTFT、解码吞吐率、缓存命中率，以及不相交的输入／输出 token 总量。DeepSeek Harness 不公开提供方账户配额服务，因此该命令报告实测会话用量，不会虚构账户限额或重置日期。

`/feedback <text>` 会复用基础 bundle 挂载的全局会话反馈命令。它只记录一条仅写入日志的 `feedback/record`，不启动模型轮次，并在确认中说明接收 Session、匿名用户 id 与当前会话共享策略。该命令绝不会声称可选遥测后端已经投递或保留该条目。

所选 DeepSeek 路由缺少 `DEEPSEEK_API_KEY` 时，首次使用会打开一个附着 composer 的掩码输入框。原始 Key 不会进入编辑器、命令参数、Session 日志、transcript 或输入历史；Enter 会把它直接交给共享 `ctx.credentials` provider，Escape 则跳过本次启动的引导。`/credentials [status|set|unset]` 只报告配置状态、来源与可写性；新值只能通过同一个掩码输入框提交，删除操作也只移除 provider 管理的已保存值。从启动环境继承的 Key 在 TUI 内保持只读。

`/settings` 是基于共享可选 `ctx.settings` provider 的终端 hub。不带参数时，它显示基于文件的设置文档与所有已注册 namespace 的脱敏元数据（实时／重启作用域、继承值／用户覆盖，以及已隐藏 secret 的数量）；`/settings list` 打印同样的 namespace 摘要，`/settings document` 则准备并报告可编辑文档路径。它刻意不复制 Web React 表单，也不会把一个完整的脱敏 section 写回，因为这类替换可能擦除已存的 secret。`/theme [deepseek|light|dark|system] [id]` 是终端安全的实时 action：它以字段级 mutate 更改与 Web client 共用的 `ui-theme.preference` namespace，跟随外部设置更新，并通过终端颜色方案报告解析 `system`。不带参数的 `/theme` 会打开一个统一选择器，不再拆分「外观」与「配色」。

`/personality` 会打开参考 Codex 设计的「友好」与「务实」沟通风格选择器。「友好」强调温暖与协作；「务实」强调简洁与专注任务。选择结果持久化为 `agent-personality.preference`，通过作用域系统提示词注册表从下一次模型请求起生效，并跟随外部设置更新。`/personality friendly`、`/personality pragmatic` 与 `/personality status` 提供直接调用形式。

统一选择器在顶部展示一个 `DeepSeek` 系统默认行，然后为每种色调展示 `Light ·` 与 `Dark ·` 主题卡。选择卡片会一起提交明暗外观与色调；每个背景仍会在 TUI 自有的 `ui-accent` section 中记住非活跃选择。即使终端不回复背景色查询，当前主题也会一起重绘 prompt、边框、角色标题、选择状态、零状态欢迎面板、composer 与已提交用户卡片。只有 composer 和已提交用户卡片使用背景填充；欢迎面板保留终端背景。卡片表面在终端支持时使用精确 24 位背景，否则回退到 xterm 256 色。真彩色终端的启动 banner 与品牌色还会按背景使用对应色值——深色终端用亮色、浅色终端用深色——前景角色则继续使用适配主题的 ANSI 回退。

`/language [en|zh|ar|fr|ru|es|ja|ko]` 会写入共用的 `locale.preference` 设置，并提供英文、中文、阿拉伯文、法文、俄文、西班牙文、日文和韩文终端文案。不带参数的 `/language` 会打开附着 composer 的选择器；TUI 中的修改会立即刷新欢迎面板、默认输入 placeholder、编辑器 footer、运行状态行与设置界面。浏览器会采用共用的英文或中文选择；若持久化设置仅受终端支持，则浏览器继续采用其自身检测到的语言。模型回复、工具载荷、自定义 placeholder 和第三方命令文案保留来源语言，不做机器翻译。

`/workspace` 会在共享持久 `ctx.workspaceRegistry` 上打开可搜索 selector；`/workspace <directory>` 会先对该目录做 canonicalize 并注册。选择一行后，通过可选宿主 `TuiRuntime.handoffWorkspace` 在该工作区开启一个**全新**会话。Controller 要求 agent 空闲，检查目录，flush 当前会话，drain 输入，并在 handoff 前释放 UI 及全屏／鼠标终端 mode。缺少宿主时，当前 TUI 保持运行并显示警告；宿主拒绝时，会恢复终端并强制渲染完整首帧。该路径绝不改写当前会话不可变的 `SessionHeader.cwd`——更改工作区是一次进程／会话 handoff，而非原地元数据变更。

不带参数的 `/resume` 会打开全 viewport 键盘选择器，而非居中对话框；`/resume <session>` 则对指定持久 id 执行相同的活跃状态、日志、模型路由与 workspace 预检，但不打开选择器。选择器在命令执行时立即打开并接管输入焦点，会话扫描仍在进行时显示加载占位符，直到行数据就绪；Escape 取消进行中的扫描，方式与取消已加载列表相同。两个作用域覆盖同一候选项集合：打开时所处的当前工作区，以及按 Tab 切换到的所有工作区。搜索字段下方的作用域行会给出当前作用域的名称以及另一个作用域包含的数量，且在所有工作区作用域中每行还会报告自身所属的工作区。切换会清除搜索与选择，使高亮行始终属于可见列表。

获得焦点的搜索字段紧跟搜索 glyph 开始，并发出 pi-tui 的 cursor marker，使终端 IME 组合保持锚定在字段内。行数据不读取任何完整日志：挂载可选的投影缓存时，标题来自实时投影注册表或持久化 checkpoint 行，冷读取只折叠 checkpoint 之后的日志尾部（并写回，使下次扫描零 I/O，受 `resumeScanConcurrency` 约束）；未挂载缓存的组合回退到一次对日志的有界批量标题读取。候选项按元数据活动时间排序——实时会话取内存中最后一个事件的时间，否则取持久化产物的 mtime，再回退到创建时间——可按标题或会话 id 搜索，在所有工作区作用域中还可按工作区标签搜索；每行报告该时间戳、current/live/persisted 状态和 id。Up/Down 与 Page Up/Page Down 导航，Enter 恢复，Escape 会先清除非空搜索，再次按下才取消，Ctrl+C 则直接取消。当前会话、已在本运行时中活跃的会话、不可读日志，或没有可运行的已记录工作区的会话仍会显示，但不可选择；不同于当前工作区的工作区属于作用域而非禁用原因，因为恢复会进入该目录。

选择时会重复这些检查，完整读取并回放验证所选中的那一份日志，在其日志所记提供方没有当前适配器时拒绝，并要求当前 agent 空闲。未提供可选的宿主 `TuiRuntime.handoffResume` 时，selector 会关闭并显示警告，但不停止当前 TUI。随附的 `dsh tui` 宿主同时提供恢复会话与全新工作区 handoff；自定义 embedding 可以仍只提供恢复，或两者都不提供。宿主会在当前会话 flush 且终端 UI 停止后收到所选 id 与工作区；文件系统与 shell 工具解析所依据的是进程 cwd，而非恢复出的会话头部，因此宿主必须在替换进程前进入该目录。完成的 handoff 保留相同的 `SessionId`、transcript、标题、todo、持久目标和已记录的 agent preset；目标激活仍保持解除，TUI 会要求用户确认或执行 `/goal resume`。

退出时打印的行由启动器拥有，不可通过配置指定。启动器在启动上下文上提供 `TUI_GOODBYE_MESSAGE_KEY`（对于随附的 `dsh`，即恢复本会话的命令），释放终端后退出会原样打印它；未提供时退出不打印任何内容。只有启动器知道自己是如何被调用的，因此只有它能给出可用的命令。TUI 在渲染前会转义终端控制字符，且绝不执行该文本。若启动器同时提供 `MAIN_SESSION_ID_KEY`，则会固定已挂载应用绑定的会话，因此恢复功能不受配置层修补影响。

嵌入方可通过设置 direct renderer 的 `initialSkill` 配置，或在启动上下文上提供 `INITIAL_SKILL_KEY` 来播种会话。聊天就绪后，TUI 会像用户手动键入 `/skill:<name>` 一样自动调用该 skill；若要获得仅限全新会话的行为，嵌入方必须在恢复会话时省略它。随附的 `dsh tui` 启动器不设置初始 skill；未知名称会以通知形式报告。

Reasoning 首次渲染时默认在 `Think` 标题下显示。提交的用户卡片保留在紧凑 transcript 中，注入上下文与 Session 元数据则不占用任何行。展开详情后才会显示上下文来源和完整文本，并移除生产方的 reminder 外框。设置 `mouse: true` 时，footer 的 `▸` 图标可点击并同时展开上下文与工具卡片；Ctrl+O、Ctrl+R 和 `/details` 仍是对应的键盘与命令入口。

## 配置

`TuiConfig` 是随附 bundle 中 `tui-runner` 行和 direct renderer 共同接受的展示配置 schema。Direct `@deepseek-ai/dsh-tui` 插件的完整 `Config` 另外包含 `sessionId` 与 `initialSkill`；bundle runner 刻意只公开 `TuiConfig`，其会话身份由 `tuiStartup` 持有，而随附启动器不提供初始 skill。

| 键 | 作用域 | 默认值 | 含义 |
|---|---|---|---|
| `sessionId` | 仅 direct renderer | `main` | 由终端驱动的精确共享 agent／会话身份 |
| `initialSkill` | 仅 direct renderer | 未设置 | 聊天就绪后自动调用的 skill |
| `fullscreen` | `TuiConfig` | `false` | 使用有界 alternate screen，而不是终端原生 scrollback |
| `mouse` | `TuiConfig` | `false` | 在全屏模式中接管滚轮和点击；关闭时由终端直接处理拖选 |
| `showReasoning` | `TuiConfig` | `true` | 默认在 `Think` 标题下渲染 reasoning 块；可通过详情切换 |
| `maxToolOutputLines` | `TuiConfig` | `6` | 折叠工具卡片的头尾预览所保留的输出行数 |
| `maxDiffEditLength` | `TuiConfig` | `1000` | 回退到整侧展示前，精确 diff 最多探索的新增与删除行总数 |
| `gitDiffTimeoutMs` | `TuiConfig` | `30000` | `/diff` 使用的每个只读 Git 子进程的最长运行毫秒数 |
| `maxQuestionOptions` | `TuiConfig` | `8` | 一次最多可见的选项块数；行数边界可能进一步减少可见数量 |
| `maxModelOptions` | `TuiConfig` | `8` | 模型选择器中可见的模型数 |
| `maxResumeOptions` | `TuiConfig` | `8` | 恢复选择器中可见的会话数 |
| `resumeScanConcurrency` | `TuiConfig` | `4` | 一次恢复扫描中并发冷投影读取的上限 |
| `questionDialogWidth` | `TuiConfig` | `200` | 问题面板宽度（列数），以终端宽度为上限 |
| `questionDialogMaxHeight` | `TuiConfig` | `20` | 问题面板最大行数，会进一步受限以保留编辑器 |
| `modelDialogWidth` | `TuiConfig` | `76` | 模型选择器宽度（列数） |
| `modelDialogMaxHeight` | `TuiConfig` | `20` | 模型选择器最大行数 |
| `detailsDialogWidth` | `TuiConfig` | `72` | transcript 细节选择器宽度（列数） |
| `fileSearchMaxResults` | `TuiConfig` | `20` | 一次 `@` 查询显示的最大文件和目录候选数 |
| `fileSearchMaxEntries` | `TuiConfig` | `10000` | 无路径模糊查询使用的有界工作区索引最多保留的路径数 |
| `fileSearchExcludedDirectories` | `TuiConfig` | `['.git', 'node_modules']` | 遍历和直接补全时忽略的目录 basename |
| `fileSearchRespectIgnoreFiles` | `TuiConfig` | `true` | 应用仓库 `.git/info/exclude`、分层 `.gitignore` 与嵌套 `.ignore` 规则 |
| `showHardwareCursor` | `TuiConfig` | `true` | 保留 pi-tui 的 IME marker，并显示获得焦点的软件闪烁光标 |
| `theme.color` | `TuiConfig` | `true` | 应用内置 ANSI palette（参见[颜色](#color)） |
| `theme.truecolor` | `TuiConfig` | 进程入口检测 `COLORTERM`；direct runtime 调用使用 `false` | 启用 24-bit 启动渐变与 DeepSeek 品牌色 |
| `theme.leftPrompt` | `TuiConfig` | 空 | 可选的底部状态栏左对齐模板；默认隐藏工作区和分支 |
| `theme.rightPrompt` | `TuiConfig` | `${goal}${details}${model}${token_meter/usage}${context}${queued}` | `/statusline` 尚未保存覆盖项时使用的底部状态栏右对齐模板 |
| `theme.inputPrompt` | `TuiConfig` | `${indicator}` | 编辑器首行前缀模板 |
| `theme.inputPlaceholder` | `TuiConfig` | `Describe a task, @ a file, or / for commands` | 空编辑器 placeholder |
| `title` | `TuiConfig` | `DeepSeek Harness` | 终端窗口标题的产品后缀 |

如需修改展示配置，请修补随附 profile 中已有的 runner 行：

```yaml
# Shipped tui profile: presentation-only TuiConfig.
- id: tui-runner
  config:
    showReasoning: true
    theme:
      color: false
```

Direct renderer 组合还可以选择会话身份与启动 Skill：

```yaml
# Direct renderer: full Config extends TuiConfig.
- id: terminal
  name: '@deepseek-ai/dsh-tui'
  config:
    sessionId: main-session-123
    initialSkill: onboarding
    theme:
      color: true
```

两种进程入口都会在接管终端前拒绝非 TTY stdin 或 stdout。随附 runner 会在 Loader 结算后创建或恢复精确 Agent，再把 renderer 挂载到该已存在的根 Agent。Direct 组合可在由配置创建的 Agent 之前挂载，以观察 `agent-loop/config-start-failed`；`mountTui` 安装 listener 后也会检查已存在的匹配根 Agent。dispose（资源释放）会停止接收扩展请求，卸载 `ctx.tui` 提供方及其依赖插件，中止运行中的命令，移除 TUI 定义，停止 loader，拒绝待处理问题，排空终端输入，恢复终端状态，注销事件 listener 和用户交互提供方，并且绝不会在 HMR 期间退出替换进程。用户退出会先 dispose 应用根上下文以关闭同级资源，再退出进程；五秒兜底可避免某个卡住的 disposer 困住进程。

<a id="color"></a>

## 颜色

TUI 发出的所有通用 SGR 代码都集中在 `components/theme.ts` 的 `paletteSpec` 表中；`createPalette` 从该表派生包装层，`/palette` 则打印该表。该表只包含标准 16 色 ANSI 前景色和 SGR 属性，由终端映射到当前配色方案。启动 banner 渐变、当前强调色的精确色值，以及官网 composer 表面，是有意保留的真彩色例外。正文使用终端默认前景色，而非固定色调。

每种视觉语义只对应一个角色：`dim` 是唯一的弱化色调，`accent` 是当前强调色的 ANSI 回退（默认 `deepseek` 使用亮蓝色），`brand` 是同一色调的标准 ANSI 回退，`success` 和 `error` 还分别充当 diff 的新增行与删除行。颜色和属性分属不同类型，因此 `bold(accent(x))` 可以通过编译，`accent(error(x))` 则不行——SGR 没有颜色栈；在一种颜色内嵌套另一种颜色时，内层颜色闭合时会静默丢弃外层颜色。各属性占用彼此独立的 SGR 组，可以按任一顺序与任何颜色组合。运行 `/palette` 可查看每个角色在你的终端上的实际渲染效果及其 SGR 码对。

`/theme` 可选择 `deepseek`（默认）、`cosmic-orange`、`mist-blue`、`sage`、`lavender` 和 `deep-blue`。每种色调都同时定义用于强调角色与 banner 渐变的 24 位真彩色（按背景区分明暗），以及用于非真彩色终端的 ANSI 16 色回退，因此两类终端都能保持与明暗主题适配。

用户提示词会渲染为带留白且无标签的卡片。默认 DeepSeek 主题在浅色模式中保留 Web 主题的精确 `deepseek-50`（`#EDF3FE`）用户气泡色，在暗色模式中保留 `neutral-bluish-850`（`#2C2C2E`）；其他主题色会用对应色值为用户卡片与当前 composer 同步添加淡色调。Assistant 回复不再显示角色标题，而使用暗色 `•` 与对齐续行；可见 reasoning 以 `Think` 开头。工具状态仍由彩色带下划线的标题字形与标题表达，工具正文与展开后的注入上下文统一使用一种暗色。Diff 卡片会为精确新增 `+` 行和删除 `-` 行着色并计数，未变更上下文保持暗色且不计数；超出 `maxDiffEditLength` 时使用已记录的整侧回退。问题面板以粗体强调色突出活跃行，选择器使用反色。除用户卡片与 composer 的背景表面外，这些效果都只作用于前景色。设置 `theme.color: false` 会移除样式和背景表面。

## 模型体验

### 交互式提示词输入

#### 模型看到的内容

每次非空普通编辑器提交都会成为一个文本块；目标 agent 空闲时通过 `agent.followup()` 发送，运行时通过 `agent.steer()` 发送。会话 mention 会变为可读的 `@label` 文本，加上由 [`dsh-session-reference`](../../context/session-reference/README.md) 定义的持久不受信任上下文；其完整 JSON 隐藏在紧凑引用卡片之后。斜杠命令和按键绑定仅用于 TUI；命令结果仍是终端通知。命令生产方可以调度单独的 agent 输入，例如 `/plan [message]` 接受的可选消息。

#### Token 影响

提交的文本会按 agent loop 的普通会话历史与压缩规则保留。Header、已记录标题、卡片、Markdown 渲染、状态行、计划和帮助文本不会增加 token。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

### 文件引用自动补全

#### 模型看到的内容

所选文件仍是普通 user 文本，例如 `@src/index.ts` 或 `@"docs/design notes.md"`；自动补全不会添加内容块、持久上下文或特殊引用 payload。注册 `read` 后，此 TUI agent 的每个请求还会包含下方固定系统提示词段落。模型会判断任务是否需要文件内容，并在需要时通过普通工具循环调用 `read`；只有路径不能证明文件已经过检查。

##### 精确系统提示词文本

```markdown
Paths prefixed with @ are files explicitly referenced by the user. Use the read tool when their contents are needed; do not claim to have inspected a file before reading it.
```

#### Token 影响

自动补全本身不增加 token。所选路径只贡献普通 user 文本 token；`read` 可用时，固定指令会贡献系统提示词 token。只有模型选择的 `read` 调用返回文件内容后，这些内容才会占用上下文。

#### KV Cache 影响

固定指令属于稳定系统提示词前缀，可以跨轮次复用。每个所选路径都是仅追加 user 文本；后续 `read` 结果通过普通工具 transcript 追加所请求内容。

### 会话模型选择

#### 模型看到的内容

`/model` 命令文本和键盘选择器输入均不会记录或发送。新步骤会在提示词变量中收到所选提供方／模型路由，并在请求路由中收到所选提供方／模型／推理强度目标。

#### Token 影响

选择器不会添加消息。更改目标可能改变插值后的系统提示词文本，并把后续请求发送给所选模型。

#### KV Cache 影响

更改提供方或模型会进入该目标的缓存域；不假定不同目标间可以复用缓存。

### 手动调用 skill

#### 模型看到的内容

提交 `/skill:<name> [instructions]` 会加载具名 skill，并交付一个文本块：用 `<skill name="…">` 元素包装 skill 指令；提供方公开资源基准时，会先添加一行定位 skill 相对资源；最后附上用户输入的尾随指令。交付遵循普通输入同样的空闲时 followup、运行时 steer 规则。选择 skill 的是命令而非模型：自动补全和按精确名称调用都应用 `invocation.userInvocable`，`invocation.modelInvocable` 不限制这个接口。用户禁用的 skill 不出现在自动补全中，按精确名称调用时也会在加载前被拒绝；为防止策略竞态，加载后的定义还会再次接受检查。自动补全会保留最后一份完整 skill 快照，并在 `skills/change` 后重新获取。观测不完整时保留先前菜单，完整的空观测会将其清空；如果目录在斜杠命令名称草稿打开期间到达，则会立即根据该草稿重新查询。skill 服务是可选 peer；这项策略检查仅使用其类型契约，不引入运行时包依赖。

#### Token 影响

渲染后的 skill 块与尾随指令会作为一个 user 轮次保留，并遵循 agent loop 的普通会话历史和压缩规则；重复调用会再次追加正文。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

### 交互式用户问题回答

#### 模型看到的内容

消费方调用 `ctx.userQuestions.ask()` 时，此提供方会按顺序显示各个问题，并返回选中选项标签、`custom` 文本，或为多选题同时返回两者。切回选项后，待提交的自定义文本仍会保留，并在之后从选项模式提交时与已勾选的标签一同返回。中止、取消或 UI dispose 会变为带类型的 `UserQuestionError`；`dsh-tool-ask-user` 会把该结果转换成模型看到的工具结果。

#### Token 影响

等待和终端 overlay 不增加 token；已解析回答或错误只会通过调用工具或插件的结果对模型可见。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

### 工具审批决策

#### 模型看到的内容

对于精确挂载的 agent，TUI 会以 `allowed-once`、`rejected` 或 `cancelled` 回答 `approval/request`。它不评估策略，也不执行工具。`ctx.approval` 仍是权威来源，并记录持久的 `approval/asked` / `approval/decided` 事件对；模型只会观察到该持有方产生的普通工具继续执行或拒绝结果。

#### Token 影响

模态框本身不增加 token。拒绝或取消文本仅会通过持有该流程的工具／运行时结果进入上下文。

#### KV Cache 影响

持有方追加工具结果之前没有影响；该结果会通过普通、仅追加的工具 transcript 跟在可复用前缀之后。

## 已知限制与延期工作

- **恢复功能没有跨进程会话锁**：选择器会拒绝本运行时中已知处于活跃状态的会话，但另一个进程可以在 handoff 之前或期间恢复同一持久 id。所有工作区作用域让这一情形一步即可触及，因为另一个宿主正在其他目录驱动的会话现在也可被选中。能够运行并发宿主的部署必须在 TUI 外协调所有权。
- **一个已绑定会话持有 transcript 和编辑器**：其他 agent 的问题仍可使用共享 overlay 提供方，但会话渲染与提示词输入仍绑定到 direct renderer 的 `sessionId` 或 bundle runner 的 `tuiStartup.identity`。
- **工具卡片是文本终端展示**：终端、diff 与通用卡片使用工具持有的标题／内容，但会话内容目前没有用于内联图像渲染的图像块。
- **Markdown 是终端原生展示，而非与浏览器完全相同**：TeX 保持字面文本，不使用 KaTeX；Markdown 图像保留文本，不获取远程内容；普通编程语言围栏统一使用一种代码色调，不进行 Shiki token 高亮。`diff` 与 `patch` 围栏仍保留语义行着色。
- **有意不支持非 TTY 运行**：pipe 与自动化应使用随发行版交付的 `headless` profile 或其他服务器入口，而不能依赖内部回退。
- **手动 `/skill:` 调用总会重新加载完整 skill 正文**：TUI 不会检测会话中是否已存在某项 skill，因此重复调用会再次追加其指令。
- **文件发现只发现宿主工作区**：自动补全读取 TUI 进程的会话 `cwd`，所选文本随后由已配置 `read` 工具解释。挂载远程或虚拟文件系统的部署必须对齐这些 namespace，或提供其他补全接口。
- **文件搜索不读取 Git 用户级全局排除项**：默认应用仓库 `.git/info/exclude`、分层 `.gitignore` 与嵌套 `.ignore` 规则；设置 `fileSearchRespectIgnoreFiles: false` 可关闭所有 ignore 文件解释。显式目录排除项始终生效，目录 symlink 不会遍历。
