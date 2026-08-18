# Agent Note: TUI 可选完成提示

Status: implemented

[English](2026-08-18-tui-completion-notifications.md) | 中文

## Problem

当终端轮次在用户暂时看不到的位置结束时，TUI 没有可选的终端级提示。新增提示不能写入 transcript、进入模型输入，也不能引入第二个轮次状态来源。

## Decision

TUI 注册带有 `enabled` 布尔值的 `ui-notifications` namespace，默认值为 `false`。`/notifications`、`/notifications status`、`/notifications on` 和 `/notifications off` 通过现有 settings provider 读取或按字段修改该 namespace。只有正在运行的 Agent 从 `running` 变为 `idle`，且 TUI 已接管终端时，才发送一个 BEL 字节；启动、idle 到 idle 的更新以及关闭设置时都不发送。设置会立即应用到当前 renderer，并跟随外部 `settings/updated` 事件更新。

提示是终端副作用，不是 Session 事件或模型输入。它使用现有终端写入器，由宿主决定如何呈现提示音；默认保持静默，避免打扰不需要提示的终端和用户。

## Alternatives considered

**完成时始终发送提示。** 这会改变默认终端行为，并使无人值守或脚本 embedding 产生噪声，因此完成提示保持显式开启。

**追加可见的 transcript 通知。** transcript 行属于持久化展示状态，可能被误认为模型输出；终端副作用已经满足需求。

**使用 OSC 桌面通知协议。** 各终端宿主对 OSC 的支持和权限不同。BEL 是现有运行时写入器接受的可移植终端原语，因此特定宿主的通知协议留在 TUI 之外。

## Verification

TUI 测试覆盖持久化的 on/off 命令、状态查询、running 到 idle 的提示，以及关闭设置时不提示。TypeScript 编译和文档门禁验证 settings 接线与双语包文档。

## Consequences

用户可以开启轻量的完成提示，而不会改变聊天历史或模型上下文。终端宿主可以按自己的偏好忽略或呈现 BEL。桌面通知、通知文本与按通道的投递策略仍由本包之外的组件负责。
