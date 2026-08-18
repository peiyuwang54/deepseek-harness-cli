# `@deepseek-ai/dsh-tui-app`

[English](README.md) | 中文

这是随发行版交付的交互式终端组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 之上；当 renderer 持有终端 raw mode 时禁用模块 HMR，并加入 Code Mode、共享 agent-preset 名单、`ui-theme` 设置注册、只读 Loader 插件清单、JSON 持久化的 workspace 存储／注册表、跨 Session 引用、tmux 上下文、默认 standard preset 的 `ask_user_question`、TUI prompt 注册表、应用自有的命令行提供方和终端 runner。它不挂载 HTTP server、Web runtime 或浏览器 client；settings、storage、workspace、plugin-inventory 与 preset 服务是共享的 Host 平面设施，而非 Web 专用 UI 代码。

[`src/startup.ts`](src/startup.ts) 持有直接 `deepseek` 命令的 `--resume`、可重复的 `--add-dir`、`--full-auto`、`--yolo`、`--dangerously-bypass-approvals-and-sandbox` 与 `--help` 参数；`dsh tui` 保留为兼容写法。一次成功的交互启动会发布唯一且不可变的 `tuiStartup.identity`：要么是新的 `main-session-<uuid>`，要么是指定的持久化 Session。每个 `--add-dir` 都以会话 cwd 为基准解析，验证为已存在目录，并在 Agent 发布前加入会话的持久额外可写根目录集合；恢复的会话会保留原有根目录，也可继续添加。Agent 发布前，`--full-auto` 会固定配置中的 `workspace-write` + `never` preset，两种无限制写法则会固定 `danger-full-access` + `never` preset。缺少所需 preset 或根目录无效时会在 presentation 挂载前失败，且两种无限制启动模式不能同时使用。命令 registry 有意不包含会话级启动快捷命令；运行中的权限切换继续使用 `/permissions`。Startup 还会提供 renderer 所需的 main-session 身份与可打印的 `deepseek --resume` 命令。帮助信息仍可在管道中使用；除此之外，若一次本应成功的启动缺少 TTY stdin 或 stdout，它会在依赖较多的 runner 激活前请求有界失败退出。

Loader 结算后，[`src/index.ts`](src/index.ts) 读取 `ctx.agentDefaultModel` 与 `ctx.agentPresets`，并针对该精确身份调用 `ctx.agents.create` 或 `ctx.agents.resume`。新建会话会解析有效默认 preset，把它记录到 `SessionHeader.agentPreset`，并在尚未发布的 Agent setup 中挂载该 preset。恢复会话则调用 `resolveSessionPreset(session)`，因此后续持久化的 `agent-preset/selected` 事件优先于 header，历史上由 Web 创建的会话会重新获得当初产生它的组合，而非今天的默认值。Preset 名单持有的每个 base 模型侧 row 都会在 bundle 作用域内禁用，因此只有所选 preset 会挂载这些能力，`minimal` 无法继承 standard／code 工具栈。同一 setup 通过 `installModelSelection` 安装所选模型路由；发布完成后，将 [`@deepseek-ai/dsh-tui`](../../ui/tui/README.md) 挂载到这个已存在的根 Agent，再移除启动期 listener，让 renderer 可变的 `/model` 选择继拥有后续请求的最终决定权。Agent 生命周期仍由 runner fiber 与核心 registry/factory 持有。

随附 CLI 为 `/resume` 与 `/workspace` 提供同一个进程 handoff Host：renderer 侧完成校验并 flush 当前会话后，它会在所选目录中以相同 profile 与 patch 栈重新 exec（在不支持进程替换的平台上，则监督一个替换子进程）。Workspace 选择不带 `--resume` 开启；resume 选择则把该标志替换为所选持久 id。所有校验都在旧树提交 shutdown 之前完成，预提交失败拒绝时，终端所有权会返回 renderer。

## 模型体验

间接影响来自组合后的 base 与 TUI 行：面向模型的 prompt 与工具内容由这些软件包持有；runner 的启动期模型选择会改变请求路由，但不会增加 prompt 文本。

#### KV Cache 影响

无；本组合包自身不会向稳定的请求前缀添加内容。

## 已知限制与暂缓事项

- **仅限交互式终端**：正常启动要求 stdin 与 stdout 均为 TTY。管道与自动化请使用随附的 headless profile。
- **自定义 embedding 可省略 handoff**：随附 CLI 同时提供恢复会话与全新 workspace 替换，direct renderer embedding 则可以只提供 resume，或两者都不提供。缺少的能力会显示警告，并保持当前 TUI／会话不变。
- **不支持 renderer 模块 HMR**：终端状态存活期间，本组合包会禁用共享模块 reload；启动器仍会通过仅 watch 的后备实现保持 profile patch 层可热更新。
