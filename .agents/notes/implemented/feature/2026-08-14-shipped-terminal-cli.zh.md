# Agent Note: 交付行式终端 CLI

Status: implemented

[English](2026-08-14-shipped-terminal-cli.md) | 中文

## 问题

`@deepseek-ai/dsh` launcher 负责 profile 选择、profile 插件、Web 应用与一次性 headless 执行。headless profile 有意保持非交互模式，因此无法提供具备实时进度、审批、模型提问、取消与持久化恢复能力的多轮终端应用。要在不增加 launcher 或执行引擎的情况下提供该产品，需要在现有 Agent 与会话服务之上增加终端专用的呈现和交互层。

仓库删除了未交付且达到产品规模的 `@deepseek-ai/dsh-tui` 包，因为它没有受维护的部署。该决策仍然是已删除实现及其维护成本的有效依据。本决策只取代[不提供终端前端的后果](../simplification/2026-08-04-remove-tui-package.md)，不会否定删除旧全屏包的理由。

## 决策

DeepSeek Harness 通过叠加在 `@deepseek-ai/dsh-base` 之上的内置 `cli` profile，交付行式终端 CLI（命令行界面）前端 `@deepseek-ai/dsh-terminal-cli`。现有 `@deepseek-ai/dsh` launcher 继续作为唯一二进制入口，现有 Agent、会话、工具、持久化、沙箱与模型服务继续作为执行引擎。终端包负责命令解析、终端交互、会话事件投影与面向进程的输出。

默认命令约定为：

```text
dsh [PROMPT]             start an interactive REPL; submit PROMPT first when present
dsh exec [PROMPT|-]      run one unattended turn and exit
dsh resume [SESSION]     resume a persisted Session, or select the latest eligible Session
```

显式 `dsh cli` 别名进入相同的交互 profile。继续支持 `dsh web`、`dsh plugin`、显式 `--profile` 与 `dsh --profile headless`。`-C`/`--cd`、提供方、模型、推理强度、沙箱与审批选项会在 profile 和个人配置之后解析。恢复操作只考虑所选工作目录中不携带 Agent preset 的根会话。显式指定带 preset 的会话会被拒绝，隐式选择最新会话时则跳过它。恢复会话时，除非调用显式覆盖，否则保留日志中记录的模型与权限选择。

## 交互与输出约定

交互模式让每一次后续输入都复用同一个 Agent 和会话。它订阅持久 `session/event` 事件流，在助手文本到达时即时渲染，报告工具调用和有界结果，分发已注册的 slash command，并提供唯一活动的用户问题提供方与审批回答器。运行中第一次按 Ctrl-C 会调用 `Agent.cancel()` 并保留 REPL，第二次按 Ctrl-C 则通过 launcher 升级为退出 `130`。空闲时按 Ctrl-C、Ctrl-D 或输入 `/exit` 会 flush（刷盘）并正常退出。

`dsh exec` 绝不会打开终端问题。除非显式覆盖，新的 exec 会话以只读沙箱和 `never` 审批策略启动，使无人值守进程快速失败，而不是等待输入。人类可读模式的 stdout 只包含最终助手文本，进度与诊断写入 stderr。启用 `--json` 后，stdout 是由稳定 CLI 事件词汇生成的 JSONL，而不是内部会话事件的原样转储。位置文本与管道 stdin 遵循 Codex 风格规则：`-` 读取 stdin；省略文本时读取非 TTY stdin；同时存在位置文本与管道时，把管道内容追加到位置文本之后。

参数与用法错误退出 `1`；完成的轮次退出 `0`；配置、模型、工具、持久性、中断或失败轮次退出 `1`。只有在会话 flush 与所持 Agent 的 dispose（资源释放）完成结算后，才会提交 JSON 终结记录：成功时只发出一条 `turn.completed`，轮次或生命周期失败时只发出一条带真实会话身份的 `turn.failed`。每个由终端表层持有的 Agent 都会通过应用的有界关闭路径完成 flush 和 dispose。

## 包边界

终端包是一个 profile 组合包，不是另一个 launcher，也不是可复用的全屏组件库。它提供：

- 在创建 Agent 之前解析终端应用参数的 startup provider；
- 通过 `ctx.agents` 创建或恢复、保留日志模型状态，并拒绝 `cli` profile 无法重建之会话组合的会话适配器；
- 基于同一会话事件源的人类可读、JSONL 与交互式渲染器；
- 基于 readline 的命令、审批和用户问题交互。

它不会复制 Codex 的 Rust 核心、app-server、Ratatui UI、认证产品或模型／工具循环。全屏渲染不属于本决策，需要独立的产品与生命周期证据。

## 验证

- [终端启动解析器测试](../../../../packages/bundle/terminal-cli/tests/startup.spec.ts)会在沙箱值无效、同时指定 `resume --last` 与会话 id，以及模型选项为空时拒绝输入且不发布启动状态；每个用例都记录退出 `1`。
- [运行器测试](../../../../packages/bundle/terminal-cli/tests/runner.spec.ts)只在 `runTurn` 与 `close()` 成功后提交 `turn.completed`。在任一次持久化 flush 中注入失败时，测试会验证只生成一条带真实会话身份的 `turn.failed`、完成 Agent dispose，并以 `1` 退出，而不是发布待定的成功记录。
- [会话适配器测试](../../../../packages/bundle/terminal-cli/tests/session.spec.ts)会在选择最新会话时跳过带 preset 的会话，并拒绝显式指定的会话，无论其 preset 来自会话头还是 `agent-preset/selected` 事件。
- 运行器测试会验证第一次按 Ctrl-C 取消活动轮次，第二次调用 `appInterrupt.escalate(130)`，而 launcher 传入的重复中断会交给 launcher 关闭路径。[真实 PTY 快照](../../../../apps/cli/tests/terminal-cli.snapshot.ts)确认在运行中的轮次发送两次 Ctrl-C 字节会让进程以 `130` 退出。
- 真实 PTY 快照通过组装后的 `cli` profile 执行两个提示词、正常退出、持久化与同会话恢复。[构建后二进制验收测试](../../../../apps/cli/tests/built-bin.e2e.ts)通过发布入口覆盖 argv、stdin、组合提示词输入、人类可读 stdout 与带终结记录的 JSONL。同一 `DSH_HOME` 中已经保存成功会话时，该测试还确认空输入 `dsh exec -` 会以 `1` 退出并报告 `a prompt is required`，而不会因 profile 监视器挂住。

## 考虑过的替代方案

**仅将 `dsh --profile headless` 记录为足够的 CLI。** 不予采纳，因为它只能解决 shell 自动化，不能满足多轮终端产品、实时输出、人工交互、取消与恢复能力。

**恢复已删除的 TUI 包。** 不予采纳，因为其产品规模的全屏实现在当前 profile、Agent、权限和持久化约定之前形成。恢复它会继承陈旧的职责与生命周期假设，而不是依据当前服务证明新的部署。

**直接把 REPL 放入 `apps/cli`。** 不予采纳，因为 launcher 负责 profile 选择和组合，而应用参数与交互属于已经启动的 profile。将终端前端保留在组合包中，才能维持与 Web 和 headless 表层相同的外部插件及个人 patch 模型。

## 后果

DeepSeek Harness 增加了一个终端产品，却没有增加第二个二进制入口或模型／工具循环。交互式、无人值守与恢复的工作共用相同的持久会话服务，脚本则获得稳定的 stdout、JSONL、权限默认值与退出码约定。

行式渲染器有意不提供多行编辑、文件补全、鼠标交互或丰富的 Markdown 与 diff 布局。单一输入所有者、有界工具摘要、显式资源清理和 transcript（文本记录）快照可以约束提示符交错与终端残留，但不会提供全屏行为。

带 preset 的会话仍不属于终端恢复范围，因为 `cli` profile 无法重建其组合。把 JSON 终结记录推迟到持久化与 dispose 完成结算之后会增加关闭延迟，但可以避免脚本在持久会话与所持 Agent 成功关闭之前观察到成功状态。
