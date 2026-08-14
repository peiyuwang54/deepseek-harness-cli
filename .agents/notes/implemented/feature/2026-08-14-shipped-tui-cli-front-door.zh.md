# Agent Note：将交互式 TUI 作为一等 CLI profile 交付

Status: implemented

[English](2026-08-14-shipped-tui-cli-front-door.md) | 中文

## 问题

DeepSeek Harness 保留了随发行版交付的 Web 应用和单次执行／headless 入口，但不再交付交互式终端应用。早期 `@deepseek-ai/dsh-tui` 因没有产品组合而被删除，因此只恢复 renderer 会再次产生一个不受支持的前端。终端命令必须证明完整产品边界：CLI 选择、Loader 组合、精确 Agent 所有权、会话恢复、模型路由、审批与问题、终端生命周期和软件包发布。

恢复的前端还必须面向当前 Harness API。自删除以来，Cordis import 已迁移到 DeepSeek fork，模型选择改为捕获的 `ModelSelection`，用户交互拆分为 `userQuestions` 与 `approval`，compaction 和 session-reference 服务更名，Agent 事件采用 payload object，prompt-admission／inbox 事件形状也已改变。把历史源码当作当前源码只会得到部分编译结果，并违反新的生命周期和审计契约。

## 决策

CLI 将 `dsh tui` 作为应用持有的 `tui` profile 的别名交付。该 profile 组合 `base + @deepseek-ai/dsh-tui-app`，不会替换或改变 Web 与 headless profile。`@deepseek-ai/dsh-tui-app` 持有命令行启动和唯一精确 root Agent 身份；`@deepseek-ai/dsh-tui` 仍是挂载到已创建或已恢复 Agent 上的展示／输入包。

启动阶段会在依赖较重的 runner 激活前发布一个新的 `main-session-<uuid>` 身份，或指定的 `--resume` 身份。Runner 等待 Loader 结算，在尚未发布的 Agent setup 中安装配置的模型选择，按该精确身份创建或恢复 Agent，挂载 renderer，然后移除启动期选择，让 TUI 的 `/model` 控制器拥有最终决定权。新建 setup 会解析并记录有效默认 agent preset，然后挂载它；resume setup 则挂载 `resolveSessionPreset(session)`，因此带有后续持久化空白会话切换的 Web 来源会话会重新获得当时的历史组合，而非今天的默认值。Bundle 会禁用 preset 名单持有的每个 base 模型侧 row，因此所选 preset 是这些能力的唯一来源，`minimal` 不会继承 standard／code 栈。Prompt registry 以可单独寻址的 `@deepseek-ai/dsh-tui/prompt` Loader 行先于 runner 挂载。正常启动要求 stdin 与 stdout 都是 TTY，否则会提前失败；`--help` 仍可安全输出到 pipe。Pipe 与自动化使用现有 headless profile。

Settings 与 workspace 状态属于 Host 平面的产品服务，而非浏览器所有权。TUI profile 组合与 Web 相同的文件设置 provider 和 `ui-theme.preference` schema，以及相同的 JSON storage／domain／workspace registry 栈。`/settings` 是一个脱敏 namespace／document hub，而非 Web React 表单的克隆；`/theme` 只 mutate preference 字段，因此绝不会因替换脱敏 section 而擦除同级 secret。`/workspace` 读取持久 registry 并请求全新会话 handoff；它绝不改写已绑定会话不可变的 `SessionHeader.cwd`。

唯一一个 CLI 持有的进程 Host 同时实现 resume 与全新 workspace 迁移。Renderer 检查 idle／会话／目录状态，flush 当前会话，drain 输入，并释放 pi-tui 以及 alternate-screen／mouse mode；宿主随后保留所选 profile、patch 栈、environment 和会话参数，在目标目录中替换进程（在没有 `execve` 的平台上监督前台子进程）。所有可恢复校验都先于已提交 teardown。被拒绝的预提交 handoff 会重新进入终端 mode 并强制渲染完整帧，因为 pi-tui 的旧行缓存属于已放弃的 alternate buffer。Renderer seam 上的 `start(cwd)` 为可选方法，因此自定义的仅 resume embedding 仍兼容，即使随附宿主同时实现两种方法。

Renderer 从 DeepSeek Harness 自身删除前的历史中恢复，并迁移到当前 API。权威 `Session` 事件仍是唯一持久对话来源：replay 将这些事件折叠成已提交终端输出，实时 chunk、工具进度、问题与审批则是瞬时 projection。TUI 不会增加第二份聊天日志或工具 scheduler。它消费现有的作用域 command registry、Agent inbox 操作、session query/reference 服务、skill registry、工具 presenter、token meter 与模型选择 seam。

审批策略与执行仍由 `ctx.approval` 持有。TUI 只为 `approval/request` 注册精确 Agent、FIFO 的回答器，返回 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`；Approval 服务持有持久 `approval/asked` 与 `approval/decided` 审计事件对。共享 Permission 服务会贡献 `/permissions` 与受 Codex 启发的 `/yolo` 快捷命令。不带参数的 `/permissions` 会打开一个读取服务所持 preset 表的终端选择器，带参调用与每次选择则使用和 Web 相同的命令 handler。Dashboard 与 footer 会从该服务投影配置的 preset 展示名称。`/yolo` 会解析部署中组合 `danger-full-access` 与 `never` 的 preset，并通过相同的沙箱 setter 与实时 Approval setter 写入；显式命令本身就是确认，其结算文本会给出恢复此前可选择 preset 的命令。`ctx.userQuestions` 仍是独立的结构化问题 provider。两个交互队列共享 renderer 的模态队列，但都不会让 TUI 成为生命周期或策略权威。

终端渲染把稳定历史与实时 projection 分开，保留首 token 前与分阶段计时，把空的 Assistant 行重排到已认领的用户／上下文消息之后，渲染工具持有的展示意图，支持会话恢复与作用域 skill，并在 dispose 时恢复 raw mode。按宽度索引的卡片缓存避免每一帧都重新换行已结算输出，一个只向前推进的计时 cursor 则为所有 step footer 提供数据，无需反复扫描完整日志。颜色方案或 reasoning 重建会保留当前 streaming component 并使其计时缓存失效，因此轮次中的重绘不会丢失累计 response 时间。

随附展示默认使用 alternate screen，并把 transcript 位置作为显式 view state：有界 viewport 会跟随新输出，直到 Page Up／Page Down 或鼠标滚轮移开；用户通过 Ctrl+End 或回到最新页时，它会恢复跟随尾部。Alternate-screen 和 SGR mouse mode 在 pi-tui 启动前进入，仅在它停止后退出；启动失败、常规 dispose 与进程 handoff 都使用同一恢复边界。现有多行 editor、bracketed paste 与感知 cursor 的 `@` 补全仍是输入权威。`/model`、Alt+M 与 footer 的鼠标目标都进入同一 model controller，因此快捷键和可见操作点不会与命令行为分叉。

真正处于零状态的会话会使用自适应面板，而不是让紧凑 transcript header 横跨空白 viewport。它渲染由第一方官方 SVG 标志派生的 Braille 字符栅格，从各自持有服务投影已组合 agent preset、所选模型和权限状态，并汇总可查询的最新会话与命令持有的快捷操作。栅格提供完整、缩小和仅字标三档高度，不依赖 Kitty／iTerm 图像协议。第一个持久 turn 会将它收缩为普通 header，因此不会让重复欢迎状态进入对话。多行 editor 持有一圈完整边框，其底框承载随状态变化的发送／steer 提示；独立底部状态栏则把工作区和用量与 agent 状态、模型、上下文压力及排队工作对齐。

富文本输出保持终端原生，而不是导入 Web React tree。pi-tui 的 GFM renderer 持有标题、强调、链接、嵌套／任务列表、引用、表格与代码围栏；一个窄范围 highlighter 把 `diff`/`patch` 元数据、hunk、删除和新增映射到工具 diff 卡片共用的语义 palette。同一路径的相邻 hunk 形成一个可见分组。KaTeX 排版、获取 Markdown 图像、Shiki token 着色、复制控件与水平滚动器仍是明确的浏览器差异，而不是终端包中的隐藏依赖。

## 参考与来源边界

我们研究了 Gemini CLI 与 OpenAI Codex 的进程模式分离、终端输入路由、已提交／实时渲染、审批、恢复、headless 输出纪律与 PTY 测试。它们的 Apache-2.0 许可证允许带署名复用，但本实现没有复制任一仓库的源码。官方 Claude Code 与检查过的第三方源码重建均为 all-rights-reserved；这里只考虑高层可观察行为，没有复制代码或非平凡表达。`@earendil-works/pi-tui` 仍是显式依赖，并带有本地兼容 patch 与生成的第三方声明。

恢复的 TUI 快照是 DeepSeek Harness 的第一方源码，取自删除提交 `10bb9cbf4a22b5095bb9ff04d1425907af8f08af` 之前的提交 `7248b5ec8f8769f882f12fd521504fa48e97bcf3`。当时仓库与 `@deepseek-ai/dsh-tui` 均声明 BSD 3-Clause。全仓库在 `c905c4694e317eff1f529f0fed047c2ce202d11a` 采用 MIT 时，该包已经被删除，因此历史快照没有参与那次机械式 package manifest 换证。恢复的实现继续保留 BSD 3-Clause 条款；当前迁移与新增内容采用 MIT。组合后的软件包因此声明精确 SPDX 表达式 `(MIT AND BSD-3-Clause)`，并由包内 `LICENSE` 保留两份声明和解释该边界。

## 验证

Renderer 由纯工具测试、Agent／Session 集成测试、真实 Approval 服务测试、ANSI 感知的 headless-terminal 组件测试与无密钥终端状态快照覆盖。专用零状态 checkpoint 锁定居中面板、真实状态标签、最近会话投影、带框 editor 与底部状态栏；交互测试则锁定它在第一个 turn 时收缩。权限选择器与一次已提交的 preset 切换通过真实 Command 和 Projection 服务各有一份终端状态 checkpoint。Settings、Appearance、workspace picker 与 handoff 失败恢复各有一份终端状态 checkpoint；交互测试还锁定仅字段 theme mutate、设置文档发现、不可变 cwd，以及重复 Enter 下在首个 await 前占用的 single-flight latch。应用 bundle 具有启动、身份、非 TTY、preset 安全的 Agent 创建／恢复与 patch 形状测试。CLI 测试覆盖别名、profile 选择、help、非 TTY 失败、随发行版配置、替换参数忠实度、shutdown 前校验、POSIX exec 与受监督子进程后备。软件包 typecheck、host typecheck、Loader／配置约束、软件包发布约束、生成 catalog、文档链接、许可证与第三方声明均为必需门禁。

## 考虑过的替代方案

**继续只把 Web 作为交互式产品。** 不采用：所需部署是交互式 CLI，而 Web 无法满足终端原生工作流、pipe 边界或 SSH／tmux 使用方式。

**在 renderer 内创建 Agent。** 不采用：这会让 UI 包成为生命周期权威，产生 Loader listener 竞态，也让 bundle 无法在展示挂载前证明精确 create／resume 身份。

**复制完整外部 CLI 前端。** 不采用：这些前端耦合到不同运行时和数据模型；Claude 系源码的许可证也不允许复制。复用 Harness 自己持有的 renderer 能保留原生 Session、Tool、Command、Approval 与 Cordis 契约。

**在终端 shim 中嵌入 Web React settings 与 conversation tree。** 不采用：这会把浏览器 transport、DOM layout 和 client 侧 state 所有权跨过 Host 边界。TUI 改为消费相同的 settings、workspace、preset 和 session 服务，并为它们提供终端原生选择器与 renderer。

**让 TTY 检测静默回退到 headless。** 不采用：重定向交互式命令会改变其协议与审批语义。显式 profile 就是边界：`tui` 要求终端，`headless` 面向自动化。

## 后果

DeepSeek Harness 再次拥有受支持的交互式终端产品，可通过 `dsh tui` 调用；`dsh web`、`--profile headless`、ACP 与其他入口仍彼此独立。产品新增 renderer 包、随发行版 bundle、pi-tui patch、终端快照和平台生命周期义务，因此新的 Cordis service／catalog 与软件包发布面必须持续生成并测试。TUI 有意只支持文本终端，且没有跨进程会话锁。随附 CLI 持有 `/resume` 与 `/workspace` 的进程替换；省略这些 callback 的自定义 renderer embedding 会退化为警告，而不会改变当前会话。
