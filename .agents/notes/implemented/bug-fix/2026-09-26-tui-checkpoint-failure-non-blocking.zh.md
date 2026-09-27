# Agent Note: A failed workspace checkpoint does not block the turn

Status: implemented

[English](2026-09-26-tui-checkpoint-failure-non-blocking.md) | 中文

## 问题

TUI 在 `tools/execute` 瀑布中执行轮次前工作区捕获，并在调用 `next()` 之前等待它。`ShadowWorkspace.capture()` 采用失败关闭，因此任何拒绝——超过 `rewindMaxFileBytes` 的普通文件、特殊文件、Git 失败——都会让该监听器拒绝并使工具失败。同一次拒绝也会在直接 Shell 提供方运行之前到达 `checkpointDirectShell`。于是无法捕获的工作区会禁用所有工具与直接 Shell，唯一可见的信号是逐个工具的错误；单个超大文件就能让会话连 `rm` 都无法执行。

[回退决策](../feature/2026-08-18-tui-workspace-rewind.md)选择了失败关闭式准入，使不完整的树永远不会被恢复。其代价是检查点失败也会让轮次失败。

## 决策

控制器通过 `attemptCheckpoint` 捕获：失败时以一条去重的警告通知报告并返回。轮次前 hook 随后调用 `next()`，`checkpointDirectShell()` 也会正常结算，因此工具或 Shell 正文会执行，只是该轮次没有检查点事件。之后的成功捕获会清除去重，使新的失败再次报告。

`ShadowWorkspace.capture()` 仍保持失败关闭。它的另一个调用方——`restore()` 内部的安全捕获——必须中止无法确保安全的恢复，因此这层不能吞掉拒绝。

## 考虑过的替代方案

**只排除超过大小上限的文件。** 大小上限只是多种拒绝之一；特殊文件或 Git 失败仍会阻止所有工具。它也修错了层，因为决定轮次能否继续的是准入路径，而不是上限本身。

**报告失败但仍阻止工具。** 只是把同样的失败推迟一次，工作区在用户无法总是修复时仍不可用。

**改为在下一次工具调用时重试捕获。** 对确定性拒绝的重试会让每个工具重复同样的失败，且不给用户任何可见原因。

## 结果

检查点无法捕获的工作区仍可使用：工具与直接 Shell 会运行，`/rewind` 会报告该轮次没有恢复点，而不是悄悄什么也不回退。检查点的失败关闭保证现在只保护 `ShadowWorkspace` 对调用方的承诺，而不保护轮次推进。想要恢复覆盖的用户必须消除拒绝原因；通知会指明它。

## 测试

`packages/ui/tui/tests/rewind.spec.ts` 用一个超过所配置上限的工作区驱动控制器：断言轮次前监听器正常结算、直接 Shell 检查点正常结算、通知只指出一次拒绝原因，并且相同失败在捕获成功之前保持安静。
