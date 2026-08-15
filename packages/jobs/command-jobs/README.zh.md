# `@deepseek-ai/dsh-command-jobs`

[English](README.md) | 中文

基于 [`ctx.jobs`](../jobs/README.md) 的用户侧后台任务控制。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册 `/ps` 与 `/stop`，因此所有已组装的命令适配器无需启动模型轮次，即可发现相同的按所有者隔离操作。加载插件还会附加一个任务控制器；即使某个 Agent 的 preset 未提供面向模型的 [`job_*` 工具](../tool-jobs/README.md)，生产方也可以为该 Agent 启动任务。

## 命令

| 输入 | 结果 |
|---|---|
| `/ps` | 以 `<id> [<kind>] <status> — <label>` 列出调用者可见且状态为 `running` 或 `stopping` 的任务；忽略 `completed`、`killed` 与 `failed` 记录。标签只使用第一行，并限制为 80 个 Unicode code point。该命令绝不消费任务输出。 |
| `/stop` | 使用原因 `Stopped by /stop.` 请求取消调用者可见的全部 `running` 任务；已经处于 `stopping` 的任务保持不变。结果会报告已请求的数量和每个失败的取消 hook。 |
| 任一命令带参数 | 返回对应 usage 行，不读取或修改任务。 |

两个命令都会把发起调用的确切 Agent 传给注册表。因此，属于其他会话的任务保持不可见且无法取消；无所有者任务则保留注册表有意提供的开放访问。`/stop` 报告的是取消请求，而不声称任务已经结束，因为生产方清理可能稍后才完成。

## 组装

挂载命令注册表、一个任务后端和本 Consumer：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
- id: command-jobs
  name: '@deepseek-ai/dsh-command-jobs'
```

随附 base bundle 会全局挂载该插件，使 TUI 与 Web 命令共享它。面向模型的任务工具仍由各 preset 独立选择。

## 模型体验

### 用户侧后台任务控制

#### 模型看到的内容

该命令适配器不会添加模型可见内容。命令输入、结果文本、任务标签和取消确认只保留在 log-only 的 `command/run` / `command/done` 事件中，绝不会进入派生的模型历史。

#### Token 影响

这些命令不增加模型 token。

#### KV Cache 影响

命令执行不会改变模型请求或其可复用前缀。

## 已知限制与延后工作

- **不显示输出预览** —— `/ps` 有意只使用不消费数据的 snapshot；任务输出应通过面向模型的 `job_output` 工具或生产该任务的界面读取。
- **取消是异步的** —— `/stop` 会请求取消全部运行中任务，但不会等待生产方完成结算。
- **注册表范围大于终端** —— 与 Codex 仅列出终端进程不同，Harness 还包含通用后台 subagent 以及未来的其他任务类型。
