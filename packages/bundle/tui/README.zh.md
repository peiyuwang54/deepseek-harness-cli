# `@deepseek-ai/dsh-tui-app`

[English](README.md) | 中文

这是随发行版交付的交互式终端组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 之上；当 renderer 持有终端 raw mode 时禁用模块 HMR，并加入 Code Mode、跨 Session 引用、tmux 上下文、`ask_user_question`、TUI prompt 注册表、应用自有的命令行提供方和终端 runner。它不挂载 Host、HTTP server、Web runtime 或浏览器 client。

[`src/startup.ts`](src/startup.ts) 持有 `dsh tui` 的 `--resume` 与 `--help`。一次成功的交互启动会发布唯一且不可变的 `tuiStartup.identity`：要么是新的 `main-session-<uuid>`，要么是指定的持久化 Session。它还会提供 renderer 所需的 main-session 身份与可打印的恢复命令。帮助信息仍可在管道中使用；除此之外，若一次本应成功的启动缺少 TTY stdin 或 stdout，它会在依赖较多的 runner 激活前请求有界失败退出。

Loader 结算后，[`src/index.ts`](src/index.ts) 读取 `ctx.agentDefaultModel`，并针对该精确身份调用 `ctx.agents.create` 或 `ctx.agents.resume`。它在尚未发布的 Agent setup 中通过 `installModelSelection` 安装所选路由；发布完成后，将 [`@deepseek-ai/dsh-tui`](../../ui/tui/README.md) 挂载到这个已存在的根 Agent，再移除启动期 listener，让 renderer 可变的 `/model` 选择继续拥有后续请求的最终决定权。Agent 生命周期仍由 runner fiber 与核心 registry/factory 持有。

## 模型体验

间接影响来自组合后的 base 与 TUI 行：面向模型的 prompt 与工具内容由这些软件包持有；runner 的启动期模型选择会改变请求路由，但不会增加 prompt 文本。

#### KV Cache 影响

无；本组合包自身不会向稳定的请求前缀添加内容。

## 已知限制与暂缓事项

- **仅限交互式终端**：正常启动要求 stdin 与 stdout 均为 TTY。管道与自动化请使用随附的 headless profile。
- **会话内 `/resume` handoff 取决于宿主**：`dsh tui --resume <id>` 可以直接恢复会话。selector 可通过 base query 服务检查 Session，但若要原地替换当前进程，还需要宿主提供 `ctx.tuiResumeHost`。
- **不支持 renderer 模块 HMR**：终端状态存活期间，本组合包会禁用共享模块 reload；启动器仍会通过仅 watch 的后备实现保持 profile patch 层可热更新。
