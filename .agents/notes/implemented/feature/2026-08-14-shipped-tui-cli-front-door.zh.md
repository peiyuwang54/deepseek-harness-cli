# Agent Note：将交互式 TUI 作为一等 CLI profile 交付

Status: implemented

[English](2026-08-14-shipped-tui-cli-front-door.md) | 中文

## 问题

DeepSeek Harness 保留了随发行版交付的 Web 应用和单次执行／headless 入口，但不再交付交互式终端应用。早期 `@deepseek-ai/dsh-tui` 因没有产品组合而被删除，因此只恢复 renderer 会再次产生一个不受支持的前端。终端命令必须证明完整产品边界：CLI 选择、Loader 组合、精确 Agent 所有权、会话恢复、模型路由、审批与问题、终端生命周期和软件包发布。

恢复的前端还必须面向当前 Harness API。自删除以来，Cordis import 已迁移到 DeepSeek fork，模型选择改为捕获的 `ModelSelection`，用户交互拆分为 `userQuestions` 与 `approval`，compaction 和 session-reference 服务更名，Agent 事件采用 payload object，prompt-admission／inbox 事件形状也已改变。把历史源码当作当前源码只会得到部分编译结果，并违反新的生命周期和审计契约。

## 决策

安装后的 `deepseek` 命令默认启动应用持有的 `tui` profile，`dsh tui` 保留为兼容写法。该 profile 组合 `base + @deepseek-ai/dsh-tui-app`，不会替换或改变 Web 与 headless profile。`@deepseek-ai/dsh-tui-app` 持有命令行启动和唯一精确 root Agent 身份；`@deepseek-ai/dsh-tui` 仍是挂载到已创建或已恢复 Agent 上的展示／输入包。

启动阶段会在依赖较重的 runner 激活前发布一个新的 `main-session-<uuid>` 身份，或指定的 `--resume` 身份。Runner 等待 Loader 结算，在尚未发布的 Agent setup 中安装配置的模型选择，按该精确身份创建或恢复 Agent，挂载 renderer，然后移除启动期选择，让 TUI 的 `/model` 控制器拥有最终决定权。新建 setup 会解析并记录有效默认 agent preset，然后挂载它；resume setup 则挂载 `resolveSessionPreset(session)`，因此带有后续持久化空白会话切换的 Web 来源会话会重新获得当时的历史组合，而非今天的默认值。Bundle 会禁用 preset 名单持有的每个 base 模型侧 row，因此所选 preset 是这些能力的唯一来源，`minimal` 不会继承 standard／code 栈。Prompt registry 以可单独寻址的 `@deepseek-ai/dsh-tui/prompt` Loader 行先于 runner 挂载。正常启动要求 stdin 与 stdout 都是 TTY，否则会提前失败；`--help` 仍可安全输出到 pipe。Pipe 与自动化使用现有 headless profile。

Settings 与 workspace 状态属于 Host 平面的产品服务，而非浏览器所有权。TUI profile 组合与 Web 相同的文件设置 provider 和 `ui-theme.preference` schema，以及相同的 JSON storage／domain／workspace registry 栈。`/settings` 是一个脱敏 namespace／document hub，而非 Web React 表单的克隆；`/theme` 只 mutate preference 字段，因此绝不会因替换脱敏 section 而擦除同级 secret。`/workspace` 读取持久 registry 并请求全新会话 handoff；它绝不改写已绑定会话不可变的 `SessionHeader.cwd`。

DeepSeek 认证仍由共享 `ctx.credentials` provider 持有。所选 DeepSeek 路由没有配置 `DEEPSEEK_API_KEY` 时，终端会打开一个附着 composer 的首次使用掩码输入框；之后切换到 DeepSeek 模型也会执行同一检查。原始值会从瞬时输入组件直接交给 `credentials.set`，绝不进入编辑器历史、命令文本、Session 事件或 transcript 输出。`/credentials` 只公开配置状态、provider 来源与可写性，并且只接受通过该掩码组件输入的替换值。TUI 无法覆盖从启动环境继承的只读凭据，删除操作也只针对 provider 管理的已保存值。

唯一一个 CLI 持有的进程 Host 同时实现 resume 与全新 workspace 迁移。不带参数的 `/resume` 通过全 viewport 选择器发现持久会话；`/resume <session>` 会跳过发现，但仍将指定 id 送入相同的活跃状态、日志、模型路由与 workspace 预检。Renderer 检查 idle／会话／目录状态，flush 当前会话，drain 输入，并释放 pi-tui 以及 alternate-screen／mouse mode；宿主随后保留所选 profile、patch 栈、environment 和会话参数，在目标目录中替换进程（在没有 `execve` 的平台上监督前台子进程）。所有可恢复校验都先于已提交 teardown。被拒绝的预提交 handoff 会重新进入终端 mode 并强制渲染完整帧，因为 pi-tui 的旧行缓存属于已放弃的 alternate buffer。Renderer seam 上的 `start(cwd)` 为可选方法，因此自定义的仅 resume embedding 仍兼容，即使随附宿主同时实现两种方法。

Renderer 从 DeepSeek Harness 自身删除前的历史中恢复，并迁移到当前 API。权威 `Session` 事件仍是唯一持久对话来源：replay 将这些事件折叠成已提交终端输出，实时 chunk、工具进度、问题与审批则是瞬时 projection。TUI 不会增加第二份聊天日志或工具 scheduler。它消费现有的作用域 command registry、Agent inbox 操作、session query/reference 服务、skill registry、工具 presenter、token meter 与模型选择 seam。

终端命令 catalog 包含受 Codex 启发的 `/skills`、`/keymap`、`/vim`、`/fast`、`/experimental`、`/ide`、`/mention`、`/copy`、`/export`、`/diff`、`/rename`、`/init`、`/review`、`/new`、`/clear`、`/ps`、`/stop` 与 `/approve` 适配器，但不引入 Codex 运行时状态。Skill 仍是 Agent 作用域 registry 条目；Vim 是 pi-tui editor 之上的输入模式 projection；fast 模式仅选择元数据标识为低延迟变体的已公布路由，并保留先前路由以便可逆切换。Experiments 启动现有终端 action，而不创建第二个 feature-flag store。在 embedding 提供 IDE bridge 之前，IDE 上下文会退化为终端宿主诊断、`@` 引用与 workspace handoff；mention 复用这条文件引用 composer 路径。Copy 选择 transcript 中最新可见的 assistant Markdown，并写入 OSC 52 帧，同时支持 tmux 透传和编码前 100,000 字节上限。Export 从稳定的 Session event 快照投影完整的人类可见 transcript，排除注入上下文和仅供模型使用的替换节点；它可以复制该 Markdown，也可以先写入并 sync 同目录临时文件，再用不覆盖目标的 hard link 发布。Diff 会读取未暂存 worktree，并为未跟踪且未忽略的文件生成 no-index diff，而不修改 index；它会禁用 Git textconv、外部 diff、hook、文件系统 monitor 以及已配置的 clean/process 可执行程序，并由展示配置限制每个子进程的运行时间。Rename 将标题规范化、持久 `session/title` 记录和固定行为交给 session-title service。Init 与 review 只在 agent 处于 idle 时，把仓库指引和不修改文件的 worktree 审查提示作为普通持久用户轮次准入；可选的 review 指令仍属于同一条已记录消息。New 与 clear 都会在 idle 检查与 session flush 后进入当前不可变 workspace 的既有全新进程 handoff；宿主未提供或拒绝迁移时，当前会话仍可使用。全局 `command-jobs` Consumer 把 Codex 的后台终端命令映射到调用者可见的活动 `ctx.jobs`：`/ps` 使用不消费输出的 snapshot，`/stop` 只请求取消 `running` 任务，并保持 `stopping` 工作不变。该用户侧 controller 让任务准入不依赖 preset 是否公开面向模型的 `job_*` 工具，而注册表的所有者检查会阻止一个 session 列出或取消其他 session 的任务。Approve 会把活动队列条目结算为 `allowed-once`，或为下一个工具和理由与最新交互拒绝完全匹配的请求预批准一次；如果下一个请求不匹配，它会消耗该授权但不会获得批准，因此该命令不能扩大会话策略，也不会创建持久授权。`/status` 保持为会话诊断 projection，不打印 system prompt 或已注册工具 catalog。

审批策略与执行仍由 `ctx.approval` 持有。TUI 只为 `approval/request` 注册精确 Agent、FIFO 的回答器，返回 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`；Approval 服务持有持久 `approval/asked` 与 `approval/decided` 审计事件对。共享 Permission 服务会贡献 `/permissions`。不带参数的 `/permissions` 会打开一个读取服务所持 preset 表的终端选择器，带参调用与每次选择则使用和 Web 相同的命令 handler。Dashboard 与 footer 会从该服务投影配置的 preset 展示名称。随附应用将 `deepseek --full-auto` 映射到部署中的 `workspace-write` + `never` preset，并将 `deepseek --yolo` 与 `--dangerously-bypass-approvals-and-sandbox` 映射到 `danger-full-access` + `never`；runner 会在发布前固定所选 preset。命令 registry 有意不提供会话级启动快捷命令，主动运行中切换仍归 `/permissions`。`ctx.userQuestions` 仍是独立的结构化问题 provider。两个交互队列共享 renderer 的模态队列，但都不会让 TUI 成为生命周期或策略权威。

终端渲染把稳定历史与实时 projection 分开，保留首 token 前与分阶段计时，渲染工具持有的展示意图，支持会话恢复与作用域 skill，并在 dispose 时恢复 raw mode。已提交的人类消息会作为带留白且无标签的 transcript 卡片保留，并进入编辑器历史；assistant 回复以 `•` 开头而不显示角色标题，可见 reasoning 使用 `Think`。动态 `正在深度求索 (<elapsed> • Esc 中断)` 行跟随实时对话尾部，并在持久 turn 结算时消失。交互界面使用一种[可选的强调色调](2026-08-15-tui-accent-hues.md)，默认保持 DeepSeek 蓝色；表示状态的成功、警告和错误角色仍保留各自颜色。紧凑的第一行 footer 不显示空闲状态与缓存命中率，因为实时进度已在 transcript 中呈现，会话统计行也已持有缓存命中率。按宽度索引的卡片缓存避免每一帧都重新换行已结算输出，一个只向前推进的计时 cursor 则为所有已完成 step footer 提供数据，无需反复扫描完整日志。颜色方案、强调色或 reasoning 重建会保留当前 streaming component 并使其计时缓存失效，因此轮次中的重绘不会丢失累计 response 时间。

运行中 steering 会在持久 Agent inbox 旁维护按身份索引的瞬时 projection。消息提交后会立即按顺序显示在 composer 上方，只有相同 `MessageId` 被 claim 或 discard 后才离开预览；随后的持久 `user/message` 仍是唯一 transcript 记录。有待发 steering 时，Escape 会保留 inbox、中止活动调用，并把最后一个 next-step 条目移至 next-turn：Inbox 先 claim next-step、再 claim next-turn，因此该操作既能唤醒中止后的 driver，也能保持整批顺序。没有待发 steering 时的 Escape 与 Ctrl+C 仍执行既有的丢弃并取消行为。每条消息最多预览三行换行文本和一行省略号，footer 数量继续作为紧凑队列摘要。

随附展示默认使用终端原生 inline scrollback。终端持有对话的鼠标滚轮滚动与拖选，键盘 Up／Down 则只处理编辑器输入历史。显式设置 `fullscreen: true` 后才启用有界 viewport：它会跟随新输出，直到 Page Up／Page Down 移开；用户通过 Ctrl+End 或回到最新页时，它会恢复跟随尾部；`mouse: true` 会另外启用 SGR 点击与滚轮处理。Alternate-screen 和已启用的 SGR mouse mode 在 pi-tui 启动前进入，仅在它停止后退出，启动失败、常规 dispose 与进程 handoff 都使用同一恢复边界。普通内建 picker 占用无边框 composer 之后的专用 composer-flow container，因此会把状态行向下推，而不会遮住对话中央；阻塞式审批／提问保留模态位置，resume 则继续使用全 viewport 浏览器。Slash、Skill、文件和会话引用补全保留 pi-tui editor 拥有的选择状态与输入处理，但通过 composer 后方的独立组件投影其候选行；这既避免了第二套补全状态机，又匹配 composer-attached 布局。所有位置仍由同一个 FIFO 焦点所有者串行化。现有多行 editor、bracketed paste 与感知 cursor 的 `@` 补全仍是输入权威。`/model`、Alt+M 与可选 footer 鼠标目标都进入同一 model controller，因此快捷键和可见操作点不会与命令行为分叉。选择器会把高亮适配器公布的精确 reasoning-effort 选项渲染为专用行，以方括号标记实时选择，并支持用 Tab 或方向键前后移动，最后由 Enter 一次提交模型与强度。该 footer 下方的详细统计栏不会重新折叠浏览器节点：TUI bundle 会挂载 Web 的 `sessionStats` 投影，并把它的全日志计数、LLM／工具时间、TTFT 与解码时长同共享的不相交 token 桶组合。终端只持有单行格式化、宽度省略和主题安全的暗色样式。

直接调用 `/model off`、`/model high` 或 `/model max` 会复用当前路由公布的推理强度 catalog。不可用的等级会被拒绝，且不改变选择。

`/mcp [verbose]` 只投影当前 Agent 作用域工具视图中的 MCP 限定 schema。该投影会报告公开名称与可选描述，不会声称工具注册表无法判定的连接状态。

`/usage` 会把现有共享会话统计线记录到 transcript。它报告已观测的对话耗时与 token 桶；由于没有账户配额服务提供数据，提供方账户限额仍不展示。

真正处于零状态的会话会使用自适应双栏欢迎卡，而不是让紧凑 transcript header 横跨空白 viewport。其编排借鉴 Claude Code 左侧身份／右侧更新的节奏，但只保留第一方 DeepSeek 内容：左栏以终端前景色渲染从官方 SVG 派生的 Braille 鲸鱼，并从各自权威服务投影 preset、模型、权限和 workspace；右栏列出真实 Harness 命令与最新可查询会话。该标志在浅色终端中呈黑色，在深色主题中不会消失，缩小档位也不依赖 Kitty／iTerm 图像协议。第一个持久 turn 会将欢迎卡收缩为仅含产品名的 header，因此 banner 副标题与 Session id 都不会进入对话。多行 composer 与已提交的人类消息卡片使用由 `/theme` 选择的 Web 主题精确明暗用户气泡色；独立底部状态栏显示 Goal、模型、紧凑用量、上下文压力和排队工作，并默认留空左侧，让工作区与分支不占用对话宽度。

富文本输出保持终端原生，而不是导入 Web React tree。pi-tui 的 GFM renderer 持有标题、强调、链接、嵌套／任务列表、引用、表格与代码围栏；一个窄范围 highlighter 把 `diff`/`patch` 元数据、hunk、删除和新增映射到工具 diff 卡片共用的语义 palette。同一路径的相邻 hunk 形成一个可见分组。KaTeX 排版、获取 Markdown 图像、Shiki token 着色、复制控件与水平滚动器仍是明确的浏览器差异，而不是终端包中的隐藏依赖。

欢迎态与紧凑态的产品名旁都会渲染包的基础语义版本，避免维护第二份手写版本源。纯净零状态不再分配空 transcript viewport，而是使用固定的两行 composer 间距，避免把输入框固定到终端底部。编辑器保留 pi-tui 的硬件 cursor marker 作为 IME 锚点，并每隔 530 ms 切换一个预留单字符宽度的软件光标。按键和状态重绘会重新开始可见阶段，因此忽略 DECSCUSR 的终端仍能明确显示焦点，且 placeholder 不会在闪烁时移位。随附 bundle 会保持 `showHardwareCursor` 启用，不再覆盖 renderer 默认值，从而保证真实 `dsh tui` 路径确实挂载两套光标后备。该 timer 在获取终端后启动，并在共享释放边界中清理。Reasoning 默认在 `Think` 标题下显示；注入上下文在紧凑状态渲染零行，只在展开详情时可见。Ctrl+O、Ctrl+R 和 `/details` 无需鼠标捕获即可使用，启用后的 footer `▸`／`▾` 鼠标目标会驱动同一状态。

## 参考与来源边界

我们研究了 Gemini CLI 与 OpenAI Codex 的进程模式分离、终端输入路由、已提交／实时渲染、审批、恢复、headless 输出纪律与 PTY 测试。当前命令名称与行为固定到 OpenAI Codex commit [`22bf16a`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/slash_command.rs)，分派细节来自 [`slash_dispatch.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/chatwidget/slash_dispatch.rs)，回复与人类消息展示来自 [`messages.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/history_cell/messages.rs)，运行状态计时来自 [`status_indicator_widget.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/status_indicator_widget.rs)，Goal footer 计时来自 [`goal_status.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/chatwidget/goal_status.rs)，剪贴板上限来自 [`clipboard_copy.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/clipboard_copy.rs)。`/diff` 的安全行为与未跟踪文件处理还对照了 Codex commit [`4861236`](https://github.com/openai/codex/blob/4861236f06d0df397436531b4aa3d7fa6975959c/codex-rs/tui/src/get_git_diff.rs)；运行中输入预览与 Markdown transcript 导出则分别对照了 Codex commit [`e5470f1`](https://github.com/openai/codex/blob/e5470f1bce099442d73e491ce63d189d355b061e/codex-rs/tui/src/bottom_pane/pending_input_preview.rs) 及其 [`transcript_export.rs`](https://github.com/openai/codex/blob/e5470f1bce099442d73e491ce63d189d355b061e/codex-rs/tui/src/app/transcript_export.rs)。我们还检查了采用 MIT 许可证的 [`dsh-TUI`](https://github.com/ccch1mneyyy/dsh-TUI/tree/9a0559b820fb0a8733089560916dfeb75075c244) 对斜杠命令目录、排队输入验证、压缩投影、主题持久化和启动器检查的实现；没有复制其 Ink renderer 与 rc.6 兼容层。Codex 与 Gemini 的许可证允许带署名复用，但本实现没有复制这些仓库的源码。官方 Claude Code 与检查过的 all-rights-reserved 源码重建只贡献了高层可观察行为，没有复制代码或非平凡表达。`@earendil-works/pi-tui` 仍是显式依赖，并带有本地兼容 patch 与生成的第三方声明。

恢复的 TUI 快照是 DeepSeek Harness 的第一方源码，取自删除提交 `10bb9cbf4a22b5095bb9ff04d1425907af8f08af` 之前的提交 `7248b5ec8f8769f882f12fd521504fa48e97bcf3`。当时仓库与 `@deepseek-ai/dsh-tui` 均声明 BSD 3-Clause。全仓库在 `c905c4694e317eff1f529f0fed047c2ce202d11a` 采用 MIT 时，该包已经被删除，因此历史快照没有参与那次机械式 package manifest 换证。恢复的实现继续保留 BSD 3-Clause 条款；当前迁移与新增内容采用 MIT。组合后的软件包因此声明精确 SPDX 表达式 `(MIT AND BSD-3-Clause)`，并由包内 `LICENSE` 保留两份声明和解释该边界。

## 验证

专用命令 checkpoint 固定 skill 浏览器、keymap 选择器、Vim Normal footer、真实 fast-route 切换、experiment 启动器、IDE 降级界面、空审批状态、剪贴板通知、完整对话导出选择器、Git diff 展示、持久 rename、文件 mention 插入、全新会话 handoff 恢复、后台任务列举与取消，以及仅含会话信息的 status 卡。单元与 Loader 组装测试固定 `/new` 和 `/clear` 的 idle、参数、当前 workspace 与宿主失败行为，按所有者隔离的 `/ps` 过滤、不消费读取、标签上限、`/stop` 取消原因、部分失败与 controller disposal、OSC 52 成帧、tmux 透传、剪贴板 payload 上限、最新可见回复选择、原始 Markdown 保留、transcript 过滤、实时流组装、安全路径解析、sync 后的不覆盖发布与清理、`/diff` 参数与失败状态、已跟踪／未跟踪组合、忽略文件排除和配置 filter 抑制。Approval-service 测试证明程序化命令授权会产生与对话框相同的持久 asked／decided 配对。

Renderer 由纯工具测试、Agent／Session 集成测试、真实 Approval 服务测试、ANSI 感知的 headless-terminal 组件测试与无密钥终端状态快照覆盖。专用零状态 checkpoint 锁定双栏欢迎卡、继承终端前景色的鲸鱼、真实状态标签、最近会话投影、统一背景的 composer 与底部状态栏；交互测试则锁定它在第一个 turn 时收缩。排队 steering checkpoint 锁定 composer 上方的有序预览与中断提示；组件测试锁定空、窄屏、本地化、换行和逐消息截断状态，交互测试则锁定按身份排空及 Escape 保持顺序的重新排队。行为测试会锁定 composer 与已提交记录的背景一致性、实时“正在深度求索”计时与中断文案、Goal 计时状态转换、光标可见—隐藏—可见阶段及 dispose。以真实 tmux 终端启动编译后 CLI 还确认了光标可见／空白交替抓帧，以及模型选择器能从 `[High]` 移动到 `[Max]`。Model、Skills、permissions、Settings、Appearance 与 workspace 快照会锁定 composer—picker—状态行的顺序。完成态、运行态与窄屏 checkpoint 会锁定共享统计栏，包括不折行的宽度边界。权限选择器与一次已提交的 preset 切换通过真实 Command 和 Projection 服务各有一份终端状态 checkpoint。Settings、Appearance、workspace picker 与 handoff 失败恢复各有一份终端状态 checkpoint；交互测试还锁定仅字段 theme mutate、设置文档发现、不可变 cwd，以及重复 Enter 下在首个 await 前占用的 single-flight latch。应用 bundle 具有启动、身份、非 TTY、preset 安全的 Agent 创建／恢复、session-stats 组合与 patch 形状测试。CLI 测试覆盖别名、profile 选择、help、非 TTY 失败、随发行版配置、替换参数忠实度、shutdown 前校验、POSIX exec 与受监督子进程后备。软件包 typecheck、host typecheck、Loader／配置约束、软件包发布约束、生成 catalog、文档链接、许可证与第三方声明均为必需门禁。

凭据交互覆盖使用一个假的只写 provider 与无密钥终端 checkpoint。它证明首次使用检测、提交前掩码渲染、直接交付 `credentials.set`、配置来源报告，以及原始值不会出现在终端输出或 Session 事件中。

## 考虑过的替代方案

**继续只把 Web 作为交互式产品。** 不采用：所需部署是交互式 CLI，而 Web 无法满足终端原生工作流、pipe 边界或 SSH／tmux 使用方式。

**在 renderer 内创建 Agent。** 不采用：这会让 UI 包成为生命周期权威，产生 Loader listener 竞态，也让 bundle 无法在展示挂载前证明精确 create／resume 身份。

**复制完整外部 CLI 前端。** 不采用：这些前端耦合到不同运行时和数据模型；Claude 系源码的许可证也不允许复制。复用 Harness 自己持有的 renderer 能保留原生 Session、Tool、Command、Approval 与 Cordis 契约。

**在终端 shim 中嵌入 Web React settings 与 conversation tree。** 不采用：这会把浏览器 transport、DOM layout 和 client 侧 state 所有权跨过 Host 边界。TUI 改为消费相同的 settings、workspace、preset 和 session 服务，并为它们提供终端原生选择器与 renderer。

**让 TTY 检测静默回退到 headless。** 不采用：重定向交互式命令会改变其协议与审批语义。显式 profile 就是边界：`tui` 要求终端，`headless` 面向自动化。

根 Slash catalog 会过滤嵌套的 `skill:` 行，直到用户明确进入 `/skill:` namespace，并把 `/skills` 保留为普通命令大小的发现入口。

## 后果

DeepSeek Harness 再次拥有受支持的交互式终端产品，可通过 `deepseek` 或兼容写法 `dsh tui` 调用；`dsh web`、`--profile headless`、ACP 与其他入口仍彼此独立。产品新增 renderer 包、随发行版 bundle、pi-tui patch、终端快照和平台生命周期义务，因此新的 Cordis service／catalog 与软件包发布面必须持续生成并测试。TUI 有意只支持文本终端，且没有跨进程会话锁。随附 CLI 持有 `/resume` 与 `/workspace` 的进程替换；省略这些 callback 的自定义 renderer embedding 会退化为警告，而不会改变当前会话。
