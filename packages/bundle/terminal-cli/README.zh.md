# `@deepseek-ai/dsh-terminal-cli`

[English](README.md) | 中文

内置 `cli` profile 使用的面向行终端 CLI（命令行界面）组合包。启动器会在裸 `dsh` 首次运行时自动初始化该 profile；[`cordis.patch.yml`](cordis.patch.yml) 在 [`dsh-base`](../base/README.md) 之上叠加编码 persona、工具模式、Code Mode worker、参数提供方和终端 runner。它不挂载 Host、HTTP server、Web runtime 或浏览器插件。

本包将进程输入输出适配到现有 Harness 运行时。它通过 `ctx.agents` 创建或恢复会话，在一次交互调用中持有一个实时 `Agent` 及其持久化 `Session`，并且只渲染该 Session 的事件。现有 agent loop（智能体循环）、模型适配器、工具、持久化、沙箱策略和审批服务仍由各自所属的包负责。runner 会 flush Session、dispose Agent 句柄，并通过启动器提供的 `ctx.appExit` 钩子请求有边界的关停。

## 命令

```text
dsh [PROMPT...]
dsh cli [PROMPT...]
dsh exec [PROMPT...|-]
dsh resume [SESSION] [PROMPT...]
dsh resume --last
```

裸 `dsh` 与显式别名 `dsh cli` 打开同一个交互应用。初始 `PROMPT` 会在第一次输入提示前提交。`dsh cli --help`、`dsh exec --help` 与 `dsh resume --help` 说明应用持有的提供方、模型、推理强度、沙箱和审批选项；启动器持有 `-C, --cd`，并在加载环境文件或组合 profile 前切换目录。

## 交互会话

交互模式要求 stdin 和 stdout 都是 TTY；使用管道或重定向 stdout 时，应用会失败并提示改用 `dsh exec`。启动横幅会标明 Session、工作区、模型选择和有效权限。应用从 `assistant/chunk` 事件流式显示 assistant 文本；工具调用和有界结果会在可用时使用各工具的纯展示转换器；显示前会移除模型或工具文本中的终端控制字节。

提示词、审批和 [`ask_user_question`](../../interaction/user-questions/README.md) 请求共用一个串行 readline 持有方。`/help` 列出 `/exit` 以及通过 [`ctx.commands`](../../interaction/commands/README.md) 注册的命令；`/exit`、`/quit`、Ctrl-D 或空闲时的 Ctrl-C 会 flush 并关闭 Session。轮次运行期间按 Ctrl-C 会请求 `Agent.cancel()`，取消完成后仍可继续输入；再次中断会交给启动器的有边界进程退出路径。

## 非交互 exec

`dsh exec` 创建全新 Session、提交一个轮次、等待 agent（智能体）进入 idle 后退出。应用以空格连接位置提示词。`-` 显式读取 UTF-8 stdin；未提供提示词时读取非 TTY stdin；同时存在位置提示词和管道输入时，应用在两者之间加入一个空行后进行拼接。stdin 上限为 1 MiB；空输入和超出上限的输入流会在创建 Agent 前失败。

在人类可读模式下，工具进度与诊断写入 stderr，stdout 只包含最终 assistant 文本及其后的一个换行符。轮次完成时退出码为 0；调用无效或轮次未以 `completed` 结束时，退出码为 1。exec 不安装终端提问或审批回答方，因此无人值守任务不能把 stdin 当作隐式交互通道。

`dsh exec --json` 用 stdout 中带 schema 版本的 JSONL 替代人类可读输出。它会发出 `thread.started`、`turn.started`、assistant 的 `item.updated` 与 `item.completed` 记录、工具的 `item.started` 与 `item.completed` 记录，以及最终的 `turn.completed` 或 `turn.failed` 记录。这些记录采用具备稳定 id 与 Session 序号的公开终端事件格式，并非内部 Session 事件的序列化结果；renderer 诊断仍写入 stderr。

只有持久化 Session flush 与所持有 Agent 的释放均成功后，终态记录才会提交。因此，持久化或清理失败只会为真实 Session 与轮次生成一条 `turn.failed`，不会先发出 `turn.completed`，随后再发出与之矛盾的合成失败。

## 恢复

`dsh resume SESSION` 在记录的工作区中重新打开符合条件的持久化 root Session。省略 `SESSION` 或传入 `--last` 时，应用会选择 `cwd` 等于当前工作目录的最新合格 Session；subagent Session、其他工作区中的 Session，以及带有 Web 或自定义 Agent preset 的 Session 都会被拒绝。终端 profile 不挂载 preset 名册；若把 preset 历史静默改用其 base 工具组合回放，会产生不安全的语义漂移。若要进入另一条已记录的工作区，请在组合 profile 前使用启动器持有的 `-C` 选项。显式 Session id 后的可选提示词会在恢复后立即提交。

恢复时，应用先从 Session 的最后一个请求标头推导模型选择，再回退到 [`ctx.agentDefaultModel`](../../core/agent-default-model/README.md)。显式提供方、模型或推理强度选项会覆盖后续请求的选择。如果更换提供方或模型但未显式指定推理强度，应用会清除旧适配器持有的推理强度，而不是将它发送给可能不兼容的新路由。已记录的沙箱与审批选择也会在恢复后继续有效；显式权限选项会追加对应的逐 Session 变更，不会修改进程级默认值。

## 权限

使用随附的 base 组合时，全新交互 Session 以 `workspace-write` 和审批策略 `ask` 启动；部署配置或显式 `--sandbox` 与 `--approval` 选项可以选择其他值。交互式审批只允许单次操作，仅将明确输入的 `y` 或 `yes` 视为允许，其他回答或 EOF 均视为拒绝。

全新 exec Session 独立默认为 `read-only` 与 `never`，不受交互默认值影响。`--sandbox workspace-write` 允许所组合的沙箱提供方在其文件效果策略范围内写入，而 `danger-full-access` 会移除这项文件限制；沙箱模式不描述网络或进程策略。`--approval never` 会在交互分派前拒绝需要审批的操作。所属参考文档定义了持久化的 [`sandbox/mode`](../../sandbox/sandbox-policy/README.md) 与 [`approval/policy`](../../interaction/user-approval/README.md) 行为。

## 扩展点

注册后的斜杠命令无需修改终端包即可出现，工具定义可以提供 `presentCall` 与 `presentResult` 函数，用于生成终端标题和摘要。终端交互提供方的作用域仅限 root Agent：委派 agent 不会取得 root 终端的提问或审批能力。

## 模型体验

无影响，因为终端适配器提交普通用户消息并渲染 Session 事件；模型提示词与工具由所组合的 base 组合包持有。

#### KV Cache 影响

无直接影响；本包不会添加请求前缀内容。

## 已知限制与暂缓事项

- **仅支持面向行渲染**：目前没有多行编辑器、文件补全、鼠标支持、全屏布局，也不支持富 Markdown 与 diff 渲染。
- **仅支持交互式恢复**：`dsh exec` 总是创建全新 Session；目前没有无人值守的 `exec resume` 命令。
- **仅恢复同一工作区的 root Session**：选择器会排除 subagent Session，并拒绝记录的 `cwd` 与进程工作目录不同的 Session。
- **不恢复 Agent preset Session**：终端 profile 不包含 preset 名册，因此会拒绝带 preset 的 Web 与自定义 Session，而不会使用另一套工具和提示词组合回放它们。
- **没有无人值守交互提供方**：`dsh exec --approval ask` 仍不能发出提示；如果组合中没有其他回答方，需要回答的操作会以不可用状态进行故障安全拒绝。
- **显示的工具结果是有界摘要**：终端与通用结果会在显示时截断，持久化 Session 事件仍是回放与其他投影的真源。
- **必须具备启动器宿主钩子**：在 `dsh` 启动器之外挂载 runner 时，如果宿主未提供 `ctx.appExit` 与命令行服务，应用会在激活阶段失败。
