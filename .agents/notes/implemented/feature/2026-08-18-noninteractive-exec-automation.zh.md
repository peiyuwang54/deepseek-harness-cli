# Agent Note: 非交互 exec 自动化

Status: implemented

[English](2026-08-18-noninteractive-exec-automation.md) | 中文

## 问题

Headless profile 只能从一个新的持久化 Session 返回最终 assistant 文本。脚本无法消费生命周期事件、要求符合 Schema 的数据、附加图片、把结果独立保存到 stdout 之外、继续先前工作，或选择无人值守权限预设。因此，自动化调用方必须为 Agent、Session、附件、权限与结构化输出服务中已有的能力编写自定义 profile 代码。

## 决策

`deepseek exec` 是随附 headless profile 的产品别名，`dsh --profile headless` 保持兼容。两种写法解析同一套应用持有的语法。新调用与恢复调用都必须提供任务。

文本模式把最终结果及一个换行写入 stdout。`--json` 改为写入 JSONL，使用顶层 `thread.started`、`turn.started`、`turn.completed`、`turn.failed`、`item.started`、`item.updated`、`item.completed` 与 `error` 记录。该投影公开 assistant 文本与 reasoning、通用工具生命周期、todo 状态和累计 Token 用量，但不公开原始提供方 chunk，也不把每一种 Session 事件都纳入自动化协议。

`--output-schema <file>` 通过现有 `dsh-tools` 子集验证对象根 JSON Schema，并在未发布的 Agent setup 阶段安装共享的有作用域结构化输出运行时。符合 Schema 且已提交的捕获会取代普通 assistant 文本成为结果；完成时没有捕获会失败。`--output-last-message <file>` 把选定结果写入文件，不额外添加换行。

可重复的 `--image <file>` 读取 PNG、JPEG、WebP 与 GIF 输入，通过附件服务将其作为一个有序批次接收，并在任务文本旁附加持久化图片引用。`resume <session-id>` 使用现有 Agent 恢复路径。`resume --last` 选择当前工作目录中最新的持久化 header；`--all` 会移除目录过滤。`--ephemeral` 只标记新 Session，并与 resume 冲突。

`--full-auto`、`--yolo` 与 `--dangerously-bypass-approvals-and-sandbox` 解析与终端入口相同的已配置权限预设，并在未发布 setup 阶段应用。`--full-auto` 与无限制模式互斥。

实现参考了 OpenAI Codex commit [`f5e9d66`](https://github.com/openai/codex/tree/f5e9d66851a20311b8385204686990c6c5960014/codex-rs/exec) 的用户可见 exec 命令组织与生命周期命名。DeepSeek Harness 在自身持久化 Session 事件与 Cordis 服务之上实现这些行为，未复制源码表达式。

## 验证

命令测试固定直接别名路由、`resume` 前后的参数解析、帮助、缺失任务与冲突参数。Runner 测试使用真实 Session、工具、system prompt 与 Agent 注册表，固定 JSONL 和用量投影、结构化捕获、图片顺序、结果文件、临时元数据、指定及最新 Session 恢复、权限选择、flush 顺序与失败格式。组装后的 headless 快照与构建后二进制 smoke 继续作为无密钥产品路径。

## 考虑过的替代方案

**把自动化保留在自定义 profile 中。** 未采用，因为每个调用方都必须重新组合相同的生命周期、持久化、附件与结构化输出行为，而随附 headless 入口已经持有单任务进程执行。

**恢复已删除的 `dsh-cli-demo` 包。** 未采用，因为这会重新产生第二个应用所有者与第二套组合。现有 headless 组合包可以持有自动化协议，无需另一个 binary 或 package。

**发出原始 Session 事件。** 未采用，因为内部事件增长会变成公开 CLI 兼容承诺，并暴露提供方专属 chunk。更小的生命周期投影使持久化内部实现与自动化协议保持独立。

**把普通 assistant JSON 当作结构化输出。** 未采用，因为解析文本无法证明模型遵循 Schema，也会绕过现有的权威工具结果提交语义。

## 后果

脚本获得一个受支持的统一命令，用于新任务与恢复任务、人类可读输出、机器可读生命周期事件、图片与结构化结果。Headless 组合包现在依赖随附 base 已组合的 preset、持久化、附件、权限、工具与结构化运行时服务。

JSONL 生命周期分类属于公开行为，其字段变化需要聚焦兼容测试。一次调用仍只提交一个任务；多轮自动化通过 `exec resume` 启动另一个进程，交互式工作仍由终端 UI 负责。
