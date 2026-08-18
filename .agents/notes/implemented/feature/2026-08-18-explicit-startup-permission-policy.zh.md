# Agent Note：显式启动权限策略

状态：已实现

[English](2026-08-18-explicit-startup-permission-policy.md) | 中文

## 问题

命令行通过 `--full-auto` 与 `--yolo` 提供了具名 preset，却无法表达精确的沙箱模式与审批策略。因此，自动化调用只能接受部署的 preset 组合，或在启动后修改权限；后一种做法发生在 Agent 发布已经开始之后。

## 决策

交互式与 headless 入口接受 `--sandbox <mode>` 和 `--ask-for-approval <policy>`。沙箱模式为 `read-only`、`workspace-write` 与 `danger-full-access`，审批策略为 `ask` 与 `never`。任一参数都可以单独提供。`deepseek exec resume` 允许将参数写在 `resume` 子命令之前或之后；同一调节项以子命令上的值为准。

精确控制与 `--full-auto`、`--yolo`、`--dangerously-bypass-approvals-and-sandbox` 互斥。系统会拒绝含糊的优先级，而不是静默替换其中一个请求。Startup 在尚未发布的 Agent setup 中通过 `PermissionPresetService.setPolicy()` 应用精确控制。该方法使用规范的 `sandbox/mode` 与 `approval/policy` setter，只写入有效变化，并且不追加 `permission/preset`。存在匹配项时，投影会推导为对应的具名 preset；否则报告 `custom`。这些调节项都是 Session 事件，因此恢复会保留所选策略，除非后续调用显式修改。

该界面参考 Codex CLI 的显式 [`--sandbox` 与 `--ask-for-approval`](https://github.com/openai/codex/blob/main/codex-rs/cli/src/main.rs) 控制，同时保留 DeepSeek Harness 更精简的审批词表与持久 Session 日志模型；没有复制 Codex 源码。

## 考虑过的替代方案

**为每组取值生成临时 preset。** 没有采用，因为选择独立调节项的调用方并未选择具名部署 preset；记录合成名称会让 `/permissions` 的重放结果产生误导。

**让精确参数覆盖快捷参数。** 没有采用，因为命令行顺序会成为隐式优先级规则，记录的意图也会含糊不清。

**在 presentation 挂载后应用取值。** 没有采用，因为初始工具与模型上下文可能会在请求策略生效前观察到默认策略。

## 结果

用户可以用精确策略启动交互式或非交互式 Session，同一策略会通过规范事件在恢复后继续生效。聚焦测试覆盖参数解析、允许值、快捷参数冲突、父命令／resume 优先级、未发布 setup 顺序、推导的 preset 状态与无操作写入。双语命令参考列出了支持的取值与冲突规则。
