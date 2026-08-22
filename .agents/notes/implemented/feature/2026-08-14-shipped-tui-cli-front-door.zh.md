# Agent Note：将交互式 TUI 作为一等 CLI profile 交付

Status: implemented

[English](2026-08-14-shipped-tui-cli-front-door.md) | 中文

## 问题

DeepSeek Harness 保留了随发行版交付的 Web 应用和单次执行／headless 入口，但不再交付交互式终端应用。早期 `@deepseek-ai/dsh-tui` 因没有产品组合而被删除，因此只恢复 renderer 会再次产生一个不受支持的前端。终端命令必须证明完整产品边界：CLI 选择、Loader 组合、精确 Agent 所有权、会话恢复、模型路由、审批与问题、终端生命周期和软件包发布。

恢复的前端还必须面向当前 Harness API。自删除以来，Cordis import 已迁移到 DeepSeek fork，模型选择改为捕获的 `ModelSelection`，用户交互拆分为 `userQuestions` 与 `approval`，compaction 和 session-reference 服务更名，Agent 事件采用 payload object，prompt-admission／inbox 事件形状也已改变。把历史源码当作当前源码只会得到部分编译结果，并违反新的生命周期和审计契约。

## 决策

安装后的 `deepseek` 命令默认启动应用持有的 `tui` profile，`dsh tui` 保留为兼容写法。该 profile 组合 `base + @deepseek-ai/dsh-tui-app`，不会替换或改变 Web 与 headless profile。`@deepseek-ai/dsh-tui-app` 持有命令行启动和唯一精确 root Agent 身份；`@deepseek-ai/dsh-tui` 仍是挂载到已创建或已恢复 Agent 上的展示／输入包。

启动阶段会在依赖较重的 runner 激活前发布一个新的 `main-session-<uuid>` 身份，或指定的 `--resume` 身份。Runner 等待 Loader 结算，在尚未发布的 Agent setup 中安装配置的模型选择，按该精确身份创建或恢复 Agent，挂载 renderer，然后移除启动期选择，让 TUI 的 `/model` 控制器拥有最终决定权。新建 setup 会解析并记录有效默认 agent preset，然后挂载它；resume setup 则挂载 `resolveSessionPreset(session)`，因此带有后续持久化空白会话切换的 Web 来源会话会重新获得当时的历史组合，而非今天的默认值。Bundle 会禁用 preset 名单持有的每个 base 模型侧 row，因此所选 preset 是这些能力的唯一来源，`minimal` 不会继承 standard／code 栈。Prompt registry 以可单独寻址的 `@deepseek-ai/dsh-tui/prompt` Loader 行先于 runner 挂载。正常启动要求 stdin 与 stdout 都是 TTY，否则会提前失败；`--help` 仍可安全输出到 pipe。Pipe 与自动化使用现有 headless profile。

Settings 与 workspace 状态属于 Host 平面的产品服务，而非浏览器所有权。TUI profile 组合与 Web 相同的文件设置 provider 和 `ui-theme.preference` schema，以及相同的 JSON storage／domain／workspace registry 栈。`/settings` 是一个脱敏 namespace／document hub，而非 Web React 表单的克隆；`/theme` 只 mutate preference 字段，因此绝不会因替换脱敏 section 而擦除同级 secret。`/workspace` 与 `/cd` 读取持久 registry 并请求全新会话 handoff；`/pwd` 与 `/cwd` 报告有效目录，这些命令都绝不改写已绑定会话不可变的 `SessionHeader.cwd`。

DeepSeek 认证仍由共享 `ctx.credentials` provider 持有。所选 DeepSeek 路由没有配置 `DEEPSEEK_API_KEY` 时，终端会打开一个附着 composer 的首次使用掩码输入框；之后切换到 DeepSeek 模型也会执行同一检查。原始值会从瞬时输入组件直接交给 `credentials.set`，绝不进入编辑器历史、命令文本、Session 事件或 transcript 输出。`/credentials` 只公开配置状态、provider 来源与可写性，并且只接受通过该掩码组件输入的替换值。TUI 无法覆盖从启动环境继承的只读凭据，删除操作也只针对 provider 管理的已保存值。

唯一一个 CLI 持有的进程 Host 同时实现 resume 与全新 workspace 迁移。不带参数的 `/resume` 通过全 viewport 选择器发现持久会话；`/resume <session>` 会跳过发现，但仍将指定 id 送入相同的活跃状态、日志、模型路由与 workspace 预检。Renderer 检查 idle／会话／目录状态，flush 当前会话，drain 输入，并释放 pi-tui 以及 alternate-screen／mouse mode；宿主随后保留所选 profile、patch 栈、environment 和会话参数，在目标目录中替换进程（在没有 `execve` 的平台上监督前台子进程）。所有可恢复校验都先于已提交 teardown。被拒绝的预提交 handoff 会重新进入终端 mode 并强制渲染完整帧，因为 pi-tui 的旧行缓存属于已放弃的 alternate buffer。Renderer seam 上的 `start(cwd)` 为可选方法，因此自定义的仅 resume embedding 仍兼容，即使随附宿主同时实现两种方法。

终端命令 catalog 还会通过这个精确会话进程宿主公开 `/fork`。配对的 `command/run` 与 `command/done` 事件结算后，controller 会调用 `ctx.sessions.fork`，flush 子会话与来源会话，drain 输入，再切换到来源 workspace 中的子会话。切换被拒绝时，它会恢复终端并报告持久子会话 id，而不会删除子会话或修改来源会话。

`/side [message]` 及其隐藏别名 `/btw` 会从父会话最近一个完整轮次前缀，在同一进程中创建第二个 Agent。它复用父会话的 preset 与模型选项，插入一条已记录的指令边界，关闭继承的 Plan 模式与 Goal 激活，并禁止子代理和 workflow 工具。Renderer 只显示该边界之后的事件，并将命令限制为只读 transcript 与 workspace 辅助项。Ctrl+C 会先中断运行中的旁路工作，再从空闲旁路返回未被修改的父会话。子会话 header 带 `ephemeral: true`；持久化协调器会忽略该生命周期的创建、事件、flush、dispose 与 HMR 接管，因此正常退出或进程崩溃都不会把它加入恢复存储。

进程宿主还持有一套实时终端通道导航器。`/agent` 与 `/subagents` 会打开同一个附着 composer 的选择器，列出根 Agent 与 `ctx.subagents` 报告的存活后代；标签和模式来自持久 subagent projection，运行状态与可切换性来自 Agent registry。选择另一个存活条目只会 dispose 当前 renderer，并为所选 Agent 挂载新 renderer，不会停止任何 Agent 或修改 Session。当前 Agent 必须处于 idle，审批和提问 provider 才能安全卸载，但目标可以已经在运行。如果所选子 Agent 被 dispose，通道会返回仍存活的根 Agent。省略导航宿主或 subagent service 的自定义 embedding 会报告能力缺失；非活动后代仍通过 `/resume` 打开，不会被伪装成存活 Agent。

`/archive` 是主 CLI 会话的非破坏性生命周期操作。它只在主 Agent 空闲时可用，并要求明确确认。Renderer 会先 flush Session，再让 `ctx.workspaceRegistry` 把该 id 加入持久归档集合；两步都成功后才请求退出进程。`/delete` 是破坏性对应操作：用户通过独立确认后，持久化服务会 flush 并删除当前日志，阻止 teardown 将其重新创建，renderer 随即退出。删除尚未结算时产生的事件会在后端操作失败时恢复。取消、所需能力缺失、存储失败或任一操作期间状态改变都会让当前 TUI 保持可用。

`/debug-config` 是不显示配置值的启动器诊断。Profile 启动器会在 Loader 条目挂载前提供当前 profile、Loader 根文件，以及按应用顺序排列的所有文件、运行时与环境来源层。Renderer 只打印这些名称与路径；确实需要完整组合值的用户会被引导到现有且不启动应用的 `--dump-config` 命令。自定义 TUI embedding 可以省略该 provider，此时命令会明确报告不可用。

`/title` 持有终端窗口展示，而不是 Session 命名。`ui-terminal.titleItems` 设置会保存应用名、Session 标题、工作区、运行状态、模型、推理强度与 Session id 的有序子集。不带参数时会打开附着 composer 的多选对话框并实时预览；取消会恢复之前的选择，确认则通过共享 settings service 写入。显式 `status`、`reset` 与 `set` 形式支持非交互使用，并保留参数顺序。`/rename` 继续作为独立的持久 `session/title` 操作。

`/statusline` 持有对 profile 右侧 footer 模板的可选有序覆盖。选择器会把当前选择排在最前，支持 Left/Right 调整顺序与 Space 切换，实时预览每次编辑，并在取消时恢复之前的模板。确认会把有序 id 持久化到 `ui-terminal.statusLineItems`；reset 会 unset 该字段，让当前 profile 的 `theme.rightPrompt` 重新成为权威。每个所选字段都读取已有 TUI projection，不可用的值会直接消失，不会获得占位内容。

`/personality` 持有一项持久化沟通风格偏好，提供「友好」与「务实」两个选项。TUI 注册一个作用域动态系统提示词 section，在每次请求时解析 `agent-personality.preference`，因此标准模型输入日志会记录最终指令，无需增加平行 Session 事件。命令选择器、直接参数和外部设置更新都会修改同一个值；默认使用「友好」。

Renderer 从 DeepSeek Harness 自身删除前的历史中恢复，并迁移到当前 API。权威 `Session` 事件仍是唯一持久对话来源：replay 将这些事件折叠成已提交终端输出，实时 chunk、工具进度、问题与审批则是瞬时 projection。TUI 不会增加第二份聊天日志或工具 scheduler。它消费现有的作用域 command registry、Agent inbox 操作、session query/reference 服务、skill registry、工具 presenter、token meter 与模型选择 seam。

Ctrl+G 会通过用户的 `VISUAL` 或 `EDITOR` 命令编辑当前 composer 草稿。Renderer 会在继承 stdio 的子进程启动前释放 pi-tui、alternate-screen、cursor 与 mouse 所有权，并在编辑器退出后重新取得这些 mode、强制渲染完整帧。草稿经由一个私有临时 Markdown 文件传递；成功或失败后都会删除该文件，其内容只有在用户提交后才进入 Session。同一时间只允许一个编辑器 handoff；若 renderer 在子进程存活期间被 dispose，则不会重新挂载。

以 `!` 开头的输入会在根 Agent 空闲时提交一条精确的人类 shell 命令。TUI 消费已组合的 `ctx.shell` 能力和当前 Session 的沙箱策略，不自行启动子进程，也不把文本转换成模型轮次。`tui/user-shell-start` 与 `tui/user-shell-result` 形成按 id 配对的持久记录，包含命令、绝对工作目录、有界输出、耗时、退出状态和沙箱信息；恢复、raw 模式与 transcript 导出投影相同事件，缺少结果的 start 会显示为已中断。执行期间 composer 不可用，Escape 或 Ctrl+C 会中止请求，缺少 Shell 或必需的 Sandbox Policy 能力时会明确失败。由于该命令是用户的精确指令，而不是模型提出的工具调用，它不会再次请求批准；所选沙箱策略仍是执行权威。

终端命令 catalog 包含受 Codex 启发的 `/skills`、`/agent`、`/subagents`、`/archive`、`/delete`、`/keymap`、`/vim`、`/fast`、`/experimental`、`/ide`、`/mention`、`/copy`、`/export`、`/diff`、`/rename`、`/init`、`/review`、`/new`、`/clear`、`/ps`、`/stop`、`/clean` 与 `/approve` 适配器，但不引入 Codex 运行时状态。Skill 仍是 Agent 作用域 registry 条目；Vim 是 pi-tui editor 之上的输入模式 projection；fast 模式仅选择元数据标识为低延迟变体的已公布路由，并保留先前路由以便可逆切换。Experiments 启动现有终端 action，而不创建第二个 feature-flag store。在 embedding 提供 IDE bridge 之前，IDE 上下文会退化为终端宿主诊断、`@` 引用与 workspace handoff；mention 复用这条文件引用 composer 路径。Copy 选择 transcript 中最新可见的 assistant Markdown，并写入 OSC 52 帧，同时支持 tmux 透传和编码前 100,000 字节上限。Export 从稳定的 Session event 快照投影完整的人类可见 transcript，排除注入上下文和仅供模型使用的替换节点；它可以复制该 Markdown，也可以先写入并 sync 同目录临时文件，再用不覆盖目标的 hard link 发布。Diff 会读取未暂存 worktree，并为未跟踪且未忽略的文件生成 no-index diff，而不修改 index；它会禁用 Git textconv、外部 diff、hook、文件系统 monitor 以及已配置的 clean/process 可执行程序，并由展示配置限制每个子进程的运行时间。Rename 将标题规范化、持久 `session/title` 记录和固定行为交给 session-title service。Init 与 review 只在 agent 处于 idle 时，把仓库指引和不修改文件的 worktree 审查提示作为普通持久用户轮次准入；可选的 review 指令仍属于同一条已记录消息。New 与 clear 都会在 idle 检查与 session flush 后进入当前不可变 workspace 的既有全新进程 handoff；宿主未提供或拒绝迁移时，当前会话仍可使用。全局 `command-jobs` Consumer 把 Codex 的后台终端命令映射到调用者可见的活动 `ctx.jobs`：`/ps` 使用不消费输出的 snapshot，`/stop` 与 `/clean` 只请求取消 `running` 任务，并保持 `stopping` 工作不变。该用户侧 controller 让任务准入不依赖 preset 是否公开面向模型的 `job_*` 工具，而注册表的所有者检查会阻止一个 session 列出或取消其他 session 的任务。Approve 会把活动队列条目结算为 `allowed-once`，或为下一个工具和理由与最新交互拒绝完全匹配的请求预批准一次；如果下一个请求不匹配，它会消耗该授权但不会获得批准，因此该命令不能扩大会话策略，也不会创建持久授权。`/status` 保持为会话诊断 projection，不打印 system prompt 或已注册工具 catalog。

工作区文件补全会先应用仓库 `.git/info/exclude`、父级与嵌套 `.gitignore`，以及嵌套 `.ignore` 规则，再展示直接或模糊候选。工具结果会同时刷新有界索引与 ignore 状态。部署可独立关闭 ignore 文件解释，而固定目录 basename 排除项仍然生效。目录 symlink 仍不参与遍历。

审批策略与执行仍由 `ctx.approval` 持有。TUI 只为 `approval/request` 注册精确 Agent、FIFO 的回答器，返回 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`；Approval 服务持有持久 `approval/asked` 与 `approval/decided` 审计事件对。共享 Permission 服务会贡献 `/permissions`。不带参数的 `/permissions` 会打开一个读取服务所持 preset 表的终端选择器，带参调用与每次选择则使用和 Web 相同的命令 handler。Dashboard 与 footer 会从该服务投影配置的 preset 展示名称。随附应用将 `deepseek --full-auto` 映射到部署中的 `workspace-write` + `never` preset，并将 `deepseek --yolo` 与 `--dangerously-bypass-approvals-and-sandbox` 映射到 `danger-full-access` + `never`；runner 会在发布前固定所选 preset。命令 registry 有意不提供会话级启动快捷命令，主动运行中切换仍归 `/permissions`。`ctx.userQuestions` 仍是独立的结构化问题 provider。两个交互队列共享 renderer 的模态队列，但都不会让 TUI 成为生命周期或策略权威。

终端渲染把稳定历史与实时 projection 分开，保留首 token 前与分阶段计时，渲染工具持有的展示意图，支持会话恢复与作用域 skill，并在 dispose 时恢复 raw mode。已提交的人类消息会作为带留白且无标签的 transcript 卡片保留，并进入编辑器历史；assistant 回复以 `•` 开头而不显示角色标题，可见 reasoning 使用 `Think`。动态 `正在深度求索 (<elapsed> • Esc 中断)` 行跟随实时对话尾部，并在持久 turn 结算时消失。交互界面使用一种[可选的强调色调](2026-08-15-tui-accent-hues.md)，默认保持 DeepSeek 蓝色；表示状态的成功、警告和错误角色仍保留各自颜色。紧凑的第一行 footer 不显示空闲状态与缓存命中率，因为实时进度已在 transcript 中呈现，会话统计行也已持有缓存命中率。按宽度索引的卡片缓存避免每一帧都重新换行已结算输出，一个只向前推进的计时 cursor 则为所有已完成 step footer 提供数据，无需反复扫描完整日志。颜色方案、强调色或 reasoning 重建会保留当前 streaming component 并使其计时缓存失效，因此轮次中的重绘不会丢失累计 response 时间。

运行中 steering 会在持久 Agent inbox 旁维护按身份索引的瞬时 projection。消息提交后会立即按顺序显示在 composer 上方，只有相同 `MessageId` 被 claim 或 discard 后才离开预览；随后的持久 `user/message` 仍是唯一 transcript 记录。有待发 steering 时，Escape 会保留 inbox、中止活动调用，并把最后一个 next-step 条目移至 next-turn：Inbox 先 claim next-step、再 claim next-turn，因此该操作既能唤醒中止后的 driver，也能保持整批顺序。没有待发 steering 时的 Escape 与 Ctrl+C 仍执行既有的丢弃并取消行为。每条消息最多预览三行换行文本和一行省略号，footer 数量继续作为紧凑队列摘要。

随附展示默认使用终端原生 inline scrollback。终端持有对话的鼠标滚轮滚动与拖选，键盘 Up／Down 则只处理编辑器输入历史。显式设置 `fullscreen: true` 后才启用有界 viewport：它会跟随新输出，直到 Page Up／Page Down 移开；用户通过 Ctrl+End 或回到最新页时，它会恢复跟随尾部；`mouse: true` 会另外启用 SGR 点击与滚轮处理。Alternate-screen 和已启用的 SGR mouse mode 在 pi-tui 启动前进入，仅在它停止后退出，启动失败、常规 dispose 与进程 handoff 都使用同一恢复边界。普通内建 picker 占用无边框 composer 之后的专用 composer-flow container，因此会把状态行向下推，而不会遮住对话中央；阻塞式审批／提问保留模态位置，resume 则继续使用全 viewport 浏览器。Slash、Skill、文件和会话引用补全保留 pi-tui editor 拥有的选择状态与输入处理，但通过 composer 后方的独立组件投影其候选行；这既避免了第二套补全状态机，又匹配 composer-attached 布局。所有位置仍由同一个 FIFO 焦点所有者串行化。现有多行 editor、bracketed paste 与感知 cursor 的 `@` 补全仍是输入权威。`/model`、Alt+M 与可选 footer 鼠标目标都进入同一 model controller，因此快捷键和可见操作点不会与命令行为分叉。选择器会把高亮适配器公布的精确 reasoning-effort 选项渲染为专用行，以方括号标记实时选择，并支持用 Tab 或方向键前后移动，最后由 Enter 一次提交模型与强度。该 footer 下方的详细统计栏不会重新折叠浏览器节点：TUI bundle 会挂载 Web 的 `sessionStats` 投影，并把它的全日志计数、LLM／工具时间、TTFT 与解码时长同共享的不相交 token 桶组合。终端只持有单行格式化、宽度省略和主题安全的暗色样式。

直接调用 `/model off`、`/model high` 或 `/model max` 会复用当前路由公布的推理强度 catalog。不可用的等级会被拒绝，且不改变选择。

`/mcp [list|desc|schema|reload] [server]` 会把 [MCP 运行时 registry](2026-08-18-mcp-runtime-status-and-reload.md)与当前 Agent 作用域工具视图中的 MCP 限定 schema 合并。它会按服务器归组稳定的公开工具名；描述视图与参数 schema 视图会逐级展示更多发现数据，可选的服务器 id 可过滤任一视图。`ls` 是 `list` 的别名，`verbose` 则继续作为 `desc` 的别名。连接状态与重连进度来自持有该连接的 client supervisor，而不是根据工具是否存在来推断。reload 只在所有存活 Agent 都空闲时重连一个当前服务器或全部服务器；缺少运行时服务的 TUI 嵌入会保留只读工具发现，并报告 reload 不可用。

`/memories [verbose]` 会把同一份作用域工具视图缩小到 server id 能识别为 `memory`、`memorix` 或 `engram` 的 MCP 工具，再按 provider 归组可见工具。该命令为只读，不会推断已存数据、启用记忆使用或提供破坏性重置。Harness 没有内置记忆存储；provider 配置与所有数据生命周期操作都留在该 TUI projection 之外。

`/hooks [verbose]` 会从只读 `ctx.hooks` registry 投影成功加载的 Claude Code 与 Codex 桥接配置。基础 bundle 挂载该 registry；每个桥接会在其 effect 生命周期内贡献绝对来源路径、可运行生命周期条目与被跳过的 handler；TUI 只在 verbose 模式展开命令、matcher 与超时覆盖。启用、信任、禁用或编辑 hook 仍由 profile 组合持有。

`/plugins [verbose] [query]` 会把现有 Host 插件清单投影到终端，提供有界输出、软件包或 Loader id 过滤，以及可选的根 Fiber 诊断。TUI bundle 挂载与 Web 设置相同的 inventory provider，软件包修改则继续由 chat 外、感知 profile 的 `deepseek plugin` 命令负责。Renderer 因此保持只读，也不会产生第二套插件或 marketplace 状态存储。

`/import` 会从本地用户目录与项目目录检测 Claude Code 和 Codex 配置，提供产品与类别选择，并且只复制 Harness 文件系统 provider 已能直接消费的指令文件和 Skill 条目。用户与项目 Skill 分别汇入共享的 `.agents/skills` 根；用户指令汇入 `$DSH_HOME/AGENTS.md`，而产品目录中的项目指令可以成为根 `AGENTS.md`。检测会略过已有目标，执行时再使用排他文件创建复查，因此并发出现的目标仍会保留。目录复制会在开始前拒绝符号链接与特殊文件，并在失败后只移除本次新建的不完整目标。项目根 `CLAUDE.md` 保持原位，因为 agent-instructions 已原生读取它；无关的设置、插件、hook、MCP 与 Session 格式继续由各自产品所有。

`/usage` 会把现有共享会话统计线记录到 transcript。它报告已观测的对话耗时与 token 桶；由于没有账户配额服务提供数据，提供方账户限额仍不展示。

`/feedback <text>` 会通过与 Web 相同的命令适配器进入现有全局 `command-feedback` 插件。接受的文本仍只形成一条仅写入日志的 `feedback/record`；TUI 不新增第二套反馈存储、模型轮次、上传路径或投递声明。确认文本保留命令所有者提供的 Session、匿名用户与共享策略披露。

真正处于零状态的会话会使用自适应双栏欢迎卡，而不是让紧凑 transcript header 横跨空白 viewport。其编排借鉴 Claude Code 左侧身份／右侧更新的节奏，但只保留第一方 DeepSeek 内容：左栏以终端前景色渲染从官方 SVG 派生的 Braille 鲸鱼，并从各自权威服务投影 preset、模型、权限和 workspace；右栏列出真实 Harness 命令与最新可查询会话。该标志在浅色终端中呈黑色，在深色主题中不会消失，缩小档位也不依赖 Kitty／iTerm 图像协议。第一个持久 turn 会将欢迎卡收缩为仅含产品名的 header，因此 banner 副标题与 Session id 都不会进入对话。多行 composer 与已提交的人类消息卡片使用由 `/theme` 选择的 Web 主题精确明暗用户气泡色；独立底部状态栏显示 Goal、模型、紧凑用量、上下文压力和排队工作，并默认留空左侧，让工作区与分支不占用对话宽度。

富文本输出保持终端原生，而不是导入 Web React tree。pi-tui 的 GFM renderer 持有标题、强调、链接、嵌套／任务列表、引用、表格与代码围栏；一个窄范围 highlighter 把 `diff`/`patch` 元数据、hunk、删除和新增映射到工具 diff 卡片共用的语义 palette。同一路径的相邻 hunk 形成一个可见分组。KaTeX 排版、获取 Markdown 图像、Shiki token 着色、复制控件与水平滚动器仍是明确的浏览器差异，而不是终端包中的隐藏依赖。

欢迎态与紧凑态的产品名旁都会渲染包的基础语义版本，避免维护第二份手写版本源。纯净零状态不再分配空 transcript viewport，而是使用固定的两行 composer 间距，避免把输入框固定到终端底部。编辑器保留 pi-tui 的硬件 cursor marker 作为 IME 锚点，并每隔 530 ms 切换一个预留单字符宽度的软件光标。按键和状态重绘会重新开始可见阶段，因此忽略 DECSCUSR 的终端仍能明确显示焦点，且 placeholder 不会在闪烁时移位。随附 bundle 会保持 `showHardwareCursor` 启用，不再覆盖 renderer 默认值，从而保证真实 `dsh tui` 路径确实挂载两套光标后备。该 timer 在获取终端后启动，并在共享释放边界中清理。Reasoning 默认在 `Think` 标题下显示；注入上下文在紧凑状态渲染零行，只在展开详情时可见。Ctrl+O、Ctrl+R 和 `/details` 无需鼠标捕获即可使用，启用后的 footer `▸`／`▾` 鼠标目标会驱动同一状态。

`/raw [on|off|status]` 会在现有富组件树与无样式源码之间切换对话投影，而不修改 Session 事件。Raw 投影复用 transcript 导出的事件筛选，因此直接人类消息、assistant Markdown、可见 reasoning、配对工具活动与未结束的模型流会保持持久顺序，注入上下文和仅模型可见的替换事件则继续排除。它省略角色标题与展示前缀，在 renderer 中转义终端控制字符，并在每个实时事件后从日志重建；切回后会从同一份日志恢复富 streaming 状态。

Raw 展示对照了 OpenAI Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/history_cell/mod.rs)：其中的 history cell 会公开便于复制的逻辑源码行，`/raw` action 则切换当前渲染模式。DeepSeek Harness 使用自己的 Session 投影与 pi-tui 组件树，没有复制 Codex 源码。专用无密钥 checkpoint 会固定原始 Markdown、去除卡片装饰后的界面和模式提示；聚焦测试会固定 reasoning 可见性、切换、显式模式、状态、无效参数与富模式恢复。

Agent 选择器对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/app/session_lifecycle.rs)：其中的 `Subagents` 视图会标记当前线程，并把选择交给应用线程所有者；共享标签与状态 helper 位于 [`multi_agents.rs`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/multi_agents.rs)。DeepSeek Harness 从自己的持久 subagent projection 派生层级，并切换 pi-tui renderer 通道；没有复制 Rust 源码。

归档与删除生命周期对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/chatwidget/slash_dispatch.rs) 及其[应用分派](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/app/event_dispatch.rs)。DeepSeek Harness 使用自己的 Session flush、workspace 归档集合与 JSONL／SQLite 删除原语，没有复制 Rust 源码。

配置诊断对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/chatwidget/slash_dispatch.rs)。DeepSeek Harness 报告自己的 Cordis profile 组合，并有意把不显示值的 TUI 来源信息与启动器的完整 `--dump-config` 输出分开；没有复制 Rust 源码。

终端标题设置对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/bottom_pane/title_setup.rs)。DeepSeek Harness 使用自己的 settings provider、pi-tui 对话框与已有运行时 projection；没有复制 Rust 源码。

状态栏设置对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/bottom_pane/status_line_setup.rs)。DeepSeek Harness 把适用目录映射到自身已有 footer 值与共享 settings provider；未复刻不可用的 Codex 账户和云端字段，也没有复制 Rust 源码。

沟通风格选择对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/chatwidget/settings_popups.rs)。DeepSeek Harness 使用自身的 settings 与系统提示词注册表，没有复制 Rust 源码。

Hook 浏览器对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/chatwidget/hooks.rs) 及其 [`hooks_browser_view.rs`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/bottom_pane/hooks_browser_view.rs)。DeepSeek Harness 读取自身 bridge registry 与 profile 持有的配置，没有复刻 Codex 的信任和修改界面，也没有复制 Rust 源码。

插件浏览器对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/chatwidget/plugins.rs)。Codex 的远端 marketplace、账号策略与 application-server 安装流程不适用于本地开源 CLI。DeepSeek Harness 改为读取已有 Cordis Loader 清单，并把修改操作引导至既有 profile 软件包命令；没有复制 Rust 源码。

本地配置导入器对照了 Codex commit [`c494130`](https://github.com/openai/codex/tree/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/external_agent_config_migration)；其 `/import` 流程先检测来源、按作用域分组配置，再要求显式选择后交给 app-server 迁移。DeepSeek Harness 只实现自身可直接消费的文件系统格式，并使用自己的 Node 文件系统与 pi-tui 对话框代码；没有复制 Rust 源码。

记忆能力视图对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/bottom_pane/memories_settings_view.rs)。Codex 控制自身本地 app-server 的记忆生成器与重置生命周期。DeepSeek Harness 改为只报告可选 Memory MCP provider 暴露的工具，并保持其数据策略不变；没有复制 Rust 源码。

反馈入口对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/bottom_pane/feedback_view.rs)。Codex 使用由 app-server 管理的类别、备注、同意、诊断与上传流程。DeepSeek Harness 已有更小且与触发方式无关的反馈事件与可选遥测策略，因此 TUI 会复用该命令，而不复制 Codex 上传状态；没有复制 Rust 源码。

文件引用发现与 Codex commit [`c494130`](https://github.com/openai/codex/tree/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/file-search) 做过对照；其有界 walker 默认启用仓库 ignore 处理。DeepSeek Harness 使用维护中的 `ignore` 包、自有可取消 Node 遍历、显式目录排除项与不跟随目录 symlink 的规则；没有复制 Rust 源码。

外部草稿编辑对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/external_editor.rs) 及其[终端 handoff](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/app/input.rs)。DeepSeek Harness 使用自己的 Node 进程边界、临时文件生命周期与 pi-tui 终端所有者实现相同的可观察 Ctrl+G 流程；没有复制 Rust 源码。

直接 shell 输入对照了 Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/chatwidget/input_submission.rs) 及其[线程路由](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/thread_routing.rs)。DeepSeek Harness 使用自身的 Shell 能力、沙箱策略服务、Session 事件词汇和 pi-tui 组件；没有复制 Rust 源码。

待发输入撤回与前台 turn 转后台复用现有 Agent 和 jobs 权威，不引入仅 TUI 可见的状态。Composer 为空时按 Up，renderer 会通过 `Inbox.remove()` 撤回最新且仍待发的 steering `MessageId`，并恢复其精确草稿；已被 claim 和已持久消息会回落到普通编辑器历史。Ctrl+B 跟随精确的持久 `turn/start`/`turn/end` 边界，以取消、结算和消费式输出 hooks 调用 `JobRegistry.adopt()`。新 composer 提交随后进入 Agent 的 next-turn FIFO，已接管 turn 继续运行；`/ps`、`job_output`、`job_kill`、owner teardown 与完成通知都观察同一条 `agent-turn-N` 记录。注册表拒绝时前台 turn 保持不变，Escape 仍会取消它。

打包后的 Windows 启动保留共享 profile-boot HMR 配置行。其 `base` 是原生可写 profile 路径，而可执行文件 Loader base 是 `file:///C:/snapshot/...` URL。现在的 vendored HMR 兼容边界会在 URL 解析前识别盘符与 UNC 路径，防止盘符变成非 file URL scheme，且不改变相对 URL 或 POSIX 行为。

## 参考与来源边界

我们研究了 Gemini CLI 与 OpenAI Codex 的进程模式分离、终端输入路由、已提交／实时渲染、审批、恢复、headless 输出纪律与 PTY 测试。当前命令名称与行为固定到 OpenAI Codex commit [`22bf16a`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/slash_command.rs)，分派细节来自 [`slash_dispatch.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/chatwidget/slash_dispatch.rs)，回复与人类消息展示来自 [`messages.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/history_cell/messages.rs)，运行状态计时来自 [`status_indicator_widget.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/status_indicator_widget.rs)，Goal footer 计时来自 [`goal_status.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/chatwidget/goal_status.rs)，剪贴板上限来自 [`clipboard_copy.rs`](https://github.com/openai/codex/blob/22bf16a37ed45006c0226541874abd7449c29911/codex-rs/tui/src/clipboard_copy.rs)。`/diff` 的安全行为与未跟踪文件处理还对照了 Codex commit [`4861236`](https://github.com/openai/codex/blob/4861236f06d0df397436531b4aa3d7fa6975959c/codex-rs/tui/src/get_git_diff.rs)；运行中输入预览与 Markdown transcript 导出则分别对照了 Codex commit [`e5470f1`](https://github.com/openai/codex/blob/e5470f1bce099442d73e491ce63d189d355b061e/codex-rs/tui/src/bottom_pane/pending_input_preview.rs) 及其 [`transcript_export.rs`](https://github.com/openai/codex/blob/e5470f1bce099442d73e491ce63d189d355b061e/codex-rs/tui/src/app/transcript_export.rs)。我们还检查了采用 MIT 许可证的 [`dsh-TUI`](https://github.com/ccch1mneyyy/dsh-TUI/tree/9a0559b820fb0a8733089560916dfeb75075c244) 对斜杠命令目录、排队输入验证、压缩投影、主题持久化和启动器检查的实现；没有复制其 Ink renderer 与 rc.6 兼容层。Codex 与 Gemini 的许可证允许带署名复用，但本实现没有复制这些仓库的源码。官方 Claude Code 与检查过的 all-rights-reserved 源码重建只贡献了高层可观察行为，没有复制代码或非平凡表达。`@earendil-works/pi-tui` 仍是显式依赖，并带有本地兼容 patch 与生成的第三方声明。

当前 `/fork` 行为还对照了 OpenAI Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/chatwidget/slash_dispatch.rs) 及其[应用分派](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/app/event_dispatch.rs)。DeepSeek Harness 使用自己的持久 Session 日志与进程宿主，没有复制 Codex 源码。

`/side` 生命周期对照了 OpenAI Codex commit [`c494130`](https://github.com/openai/codex/blob/c4941302c73c6322b153bba13ac0a9f4396301d6/codex-rs/tui/src/app/side.rs)。DeepSeek Harness 使用自己的 Agent registry、Session 事件日志、提示词 registry 与 pi-tui renderer 实现可观察的父会话／旁路切换，没有复制 Rust 源码。

恢复的 TUI 快照是 DeepSeek Harness 的第一方源码，取自删除提交 `10bb9cbf4a22b5095bb9ff04d1425907af8f08af` 之前的提交 `7248b5ec8f8769f882f12fd521504fa48e97bcf3`。当时仓库与 `@deepseek-ai/dsh-tui` 均声明 BSD 3-Clause。全仓库在 `c905c4694e317eff1f529f0fed047c2ce202d11a` 采用 MIT 时，该包已经被删除，因此历史快照没有参与那次机械式 package manifest 换证。恢复的实现继续保留 BSD 3-Clause 条款；当前迁移与新增内容采用 MIT。组合后的软件包因此声明精确 SPDX 表达式 `(MIT AND BSD-3-Clause)`，并由包内 `LICENSE` 保留两份声明和解释该边界。

## 验证

Windows HMR 回归测试会把精确的原生 profile 路径与打包后 `file:///C:/snapshot/...` 组合传入已导出的兼容边界，并同时覆盖 UNC、file URL、相对路径与 POSIX 场景。发布验证还会构建可执行文件闭包并练习 profile 组装，而不只依赖 `--version`。

`background-agent-turn` 无密钥终端 checkpoint 锁定 Ctrl+B 接管、已释放 composer、job id 与 `/ps` 可见性。聚焦交互覆盖证明：按 Up 会从权威 Inbox 移除待发 steering，编辑后以新 id 重新进入；Ctrl+B 不会启动重复工作，会通过 `ctx.jobs` 流式读取目标 turn 输出、把新文本排入下一 turn，并保留 Escape 取消。注册表 Service Provider 测试锁定接管预检、控制器拒绝、取消、结算与消费式读取。

专用命令 checkpoint 固定 skill 浏览器、keymap 选择器、Vim Normal footer、真实 fast-route 切换、experiment 启动器、IDE 降级界面、空审批状态、剪贴板通知、完整对话导出选择器、Git diff 展示、持久 rename、文件 mention 插入、全新会话 handoff 恢复、后台任务列举与取消，以及仅含会话信息的 status 卡。单元与 Loader 组装测试固定 `/new` 和 `/clear` 的 idle、参数、当前 workspace 与宿主失败行为，按所有者隔离的 `/ps` 过滤、不消费读取、标签上限、`/stop` 取消原因、部分失败与 controller disposal、OSC 52 成帧、tmux 透传、剪贴板 payload 上限、最新可见回复选择、原始 Markdown 保留、transcript 过滤、实时流组装、安全路径解析、sync 后的不覆盖发布与清理、`/diff` 参数与失败状态、已跟踪／未跟踪组合、忽略文件排除和配置 filter 抑制。Approval-service 测试证明程序化命令授权会产生与对话框相同的持久 asked／decided 配对。

Renderer 由纯工具测试、Agent／Session 集成测试、真实 Approval 服务测试、ANSI 感知的 headless-terminal 组件测试与无密钥终端状态快照覆盖。专用零状态 checkpoint 锁定双栏欢迎卡、继承终端前景色的鲸鱼、真实状态标签、最近会话投影、统一背景的 composer 与底部状态栏；交互测试则锁定它在第一个 turn 时收缩。排队 steering checkpoint 锁定 composer 上方的有序预览与中断提示；组件测试锁定空、窄屏、本地化、换行和逐消息截断状态，交互测试则锁定按身份排空及 Escape 保持顺序的重新排队。行为测试会锁定 composer 与已提交记录的背景一致性、实时“正在深度求索”计时与中断文案、Goal 计时状态转换、光标可见—隐藏—可见阶段及 dispose。以真实 tmux 终端启动编译后 CLI 还确认了光标可见／空白交替抓帧，以及模型选择器能从 `[High]` 移动到 `[Max]`。Model、Skills、permissions、Settings、Appearance 与 workspace 快照会锁定 composer—picker—状态行的顺序。完成态、运行态与窄屏 checkpoint 会锁定共享统计栏，包括不折行的宽度边界。权限选择器与一次已提交的 preset 切换通过真实 Command 和 Projection 服务各有一份终端状态 checkpoint。Settings、Appearance、workspace picker 与 handoff 失败恢复各有一份终端状态 checkpoint；交互测试还锁定仅字段 theme mutate、设置文档发现、不可变 cwd，以及重复 Enter 下在首个 await 前占用的 single-flight latch。应用 bundle 具有启动、身份、非 TTY、preset 安全的 Agent 创建／恢复、session-stats 组合与 patch 形状测试。CLI 测试覆盖别名、profile 选择、help、非 TTY 失败、随发行版配置、替换参数忠实度、shutdown 前校验、POSIX exec 与受监督子进程后备。软件包 typecheck、host typecheck、Loader／配置约束、软件包发布约束、生成 catalog、文档链接、许可证与第三方声明均为必需门禁。

凭据交互覆盖使用一个假的只写 provider 与无密钥终端 checkpoint。它证明首次使用检测、提交前掩码渲染、直接交付 `credentials.set`、配置来源报告，以及原始值不会出现在终端输出或 Session 事件中。

`/fork` checkpoint 覆盖宿主失败恢复并显示保留的子会话 id。聚焦集成测试证明配对命令生命周期事件先于子会话 end-seed，子会话记录来源 parent 与 workspace，必须挂载持久化服务，参数会被拒绝，并且宿主失败时原终端仍可使用。

`/side` checkpoint 固定一份隐藏继承父会话行与内部指令边界、但保留旁路提示词、回答和返回提示的 transcript。聚焦测试覆盖完整轮次 seed、首轮准入、preset 与模型继承、Plan 关闭、工具限制、隐藏 `/btw` 别名、旁路命令过滤、运行中与空闲时两阶段 Ctrl+C、同进程恢复父会话、Agent dispose，以及 ephemeral Session 完全不进入持久化。

`/agent` checkpoint 会固定主项与后代项、当前标记、运行状态、模式和会话 id。聚焦测试覆盖 `/subagents` 别名、参数拒绝、宿主能力缺失、后代列举、当前运行时拒绝切换，以及真实终端重新挂载后由 `/status` 读取所选子 Session。

`/archive` checkpoint 会固定默认安全的确认对话框。聚焦测试覆盖取消、参数拒绝、Agent 运行时拒绝、先 flush 再归档的顺序、持久归档身份、成功退出、workspace 能力缺失，以及存储失败时不退出。`/delete` checkpoint 会固定其独立的破坏性确认；持久化约定测试覆盖 memory、JSONL、Zstandard JSONL 与 SQLite 的删除和目标不存在状态，存活 Session 覆盖则证明 teardown 无法重新创建已删除日志。

`/debug-config` checkpoint 会固定 profile 身份、来源顺序、路径换行与 `--dump-config` 交接，且不记录配置值。聚焦 TUI 测试覆盖参数与启动器能力缺失；编译后 CLI 的 PTY 测试通过发布版 Loader 树注入该诊断 service，并验证真实启动器会报告 `tui` profile 及其来源层。

`/title` checkpoint 会固定多选字段、当前勾选状态与键盘提示。聚焦集成测试证明启动恢复、有序字段持久化、终端标题预览、取消回滚、参数拒绝，以及它与持久 Session 标题相互独立。

`/statusline` checkpoint 会固定启用字段、排序控制与有界选择器 viewport。聚焦集成测试证明持久顺序、键盘重排、实时预览、取消回滚、参数处理，以及恢复 profile 自定义 footer 模板。

`/personality` 选择器具有无密钥 checkpoint。聚焦集成测试证明设置写入、无效参数处理、外部更新接纳，以及两种沟通风格的提示词重新组装。

`/hooks verbose` 具有无密钥终端 checkpoint。Registry 单元测试覆盖 handler 总数、注册顺序、effect dispose 与不可变快照；两套真实桥接集成测试证明成功解析的可运行和跳过 handler 会进入目录，同时该目录不会成为执行的强制依赖。

`/plugins verbose <query>` 具有无密钥终端 checkpoint。聚焦测试覆盖生命周期总数、紧凑行、模块与 Loader id 过滤、完整诊断、空结果，以及缺少可选 inventory 服务的 profile。

`/import` 具有无密钥选择器与完成结果 checkpoint。文件系统测试覆盖用户／项目检测、Git 根解析、Skill bundle 与扁平文件复制、全局与项目指令、直接参数解析、类别过滤、结果格式，以及目标在检测和执行之间出现时不覆盖该目标。

`/memories verbose` 具有无密钥终端 checkpoint。聚焦测试覆盖 provider 归组、确定性的工具顺序、规整描述、排除无关工具、能力缺失，以及拒绝类似修改的参数。

除了 producer、registry、Loader 组合、脱敏与遥测测试，现有 `/feedback` 命令还具有无密钥 TUI 用法 checkpoint。该 checkpoint 证明插件命令能进入 TUI adapter，无需重复注册。

文件补全 checkpoint 会固定一个可见匹配，同时排除匹配 `.ignore` 的路径。聚焦测试覆盖仓库本地 exclude、父级与嵌套 Git 规则、通用 ignore 规则、否定规则、worktree git-directory pointer、直接与模糊过滤、关闭选项、失效刷新，以及既有 symlink 与条目上限。

外部编辑器 checkpoint 会固定 Ctrl+G handoff 后保存的草稿。聚焦测试覆盖命令优先级、POSIX 与 Windows 环境变量语法、临时文件清理、终端释放与恢复、抑制重复启动、编辑器错误和 renderer dispose 竞态。

直接 shell checkpoint 会固定一张不产生模型轮次的已完成 `!command` 卡片。聚焦测试覆盖 Shell 与 Sandbox Policy 解析、当前工作区执行、有界结果分离、仅空闲时准入、空输入、composer 锁定、Escape 与 Ctrl+C 取消、失败恢复、回放、详情切换、raw 与导出 transcript 投影，以及持久 start/result 不变量。

## 考虑过的替代方案

**继续只把 Web 作为交互式产品。** 不采用：所需部署是交互式 CLI，而 Web 无法满足终端原生工作流、pipe 边界或 SSH／tmux 使用方式。

**在 renderer 内创建 Agent。** 不采用：这会让 UI 包成为生命周期权威，产生 Loader listener 竞态，也让 bundle 无法在展示挂载前证明精确 create／resume 身份。

**复制完整外部 CLI 前端。** 不采用：这些前端耦合到不同运行时和数据模型；Claude 系源码的许可证也不允许复制。复用 Harness 自己持有的 renderer 能保留原生 Session、Tool、Command、Approval 与 Cordis 契约。

**在终端 shim 中嵌入 Web React settings 与 conversation tree。** 不采用：这会把浏览器 transport、DOM layout 和 client 侧 state 所有权跨过 Host 边界。TUI 改为消费相同的 settings、workspace、preset 和 session 服务，并为它们提供终端原生选择器与 renderer。

**让 TTY 检测静默回退到 headless。** 不采用：重定向交互式命令会改变其协议与审批语义。显式 profile 就是边界：`tui` 要求终端，`headless` 面向自动化。

**把 `!command` 交给模型工具循环，或由 TUI 自己启动 shell。** 不采用：前者会把精确的人类输入变成模型轮次，后者会绕过已组合的平台 Shell 与沙箱策略 provider。TUI 保持为这些能力的 consumer，只记录它自身持有的直接命令生命周期。

根 Slash catalog 会过滤嵌套的 `skill:` 行，直到用户明确进入 `/skill:` namespace，并把 `/skills` 保留为普通命令大小的发现入口。

## 后果

DeepSeek Harness 再次拥有受支持的交互式终端产品，可通过 `deepseek` 或兼容写法 `dsh tui` 调用；`dsh web`、`--profile headless`、ACP 与其他入口仍彼此独立。产品新增 renderer 包、随发行版 bundle、pi-tui patch、终端快照和平台生命周期义务，因此新的 Cordis service／catalog 与软件包发布面必须持续生成并测试。TUI 有意只支持文本终端，且没有跨进程会话锁。随附 CLI 持有 `/resume`、`/workspace` 与 `/cd` 的进程替换；省略这些 callback 的自定义 renderer embedding 会退化为警告，而不会改变当前会话。
