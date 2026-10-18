# Agent Note: Workspace checkpoint size limits skip files instead of blocking tools

Status: implemented

[English](2026-09-26-workspace-checkpoint-size-skip.md) | 中文

## 问题

工作区检查点作为 `tools/execute` 的轮次前 hook 运行，因此任何准入失败都会阻止工具正文。于是单个超过 `rewindMaxFileBytes`（默认 25 MiB）的普通文件会阻止所有工具，连读取那个触发拒绝的文件也不例外。一次内存测试把 56 MB 的 JSON 记录写入工作区，使整个会话在删除该文件或提高上限之前都无法使用。

[回退决策](../feature/2026-08-18-tui-workspace-rewind.md)选择了失败关闭式准入，使不完整的树永远不会被恢复。本记录只改变大小上限准入。

## 决策

`ShadowWorkspace.capture()` 返回 `WorkspaceCheckpointCapture`：提交 id 加上它排除的每个普通文件。预检会分类每个候选路径，跳过超过 `maxFileBytes` 的文件，或跳过使累计总量超过 `maxTotalBytes` 的文件，并记录路径、观测到的字节大小，以及是单文件上限还是总大小上限排除了它。其他准入失败——特殊文件、嵌套仓库、路径逃逸、Git 错误和符号链接父目录——仍会抛出。

捕获只通过一个以 NUL 分隔、由字面量 pathspec 组成的 `--pathspec-from-file` 列表暂存被包含的路径，因此 Git 绝不会读取被排除的文件，含通配符的路径也只会匹配自身。被排除的路径会用 `git rm --cached --ignore-unmatch` 从影子索引中移除，因此任何影子提交都不包含它们。

恢复会复用安全捕获的排除集合：在删除与符号链接检查中跳过这些路径，并在 `read-tree` 之后把它们从索引中移除，因此 `checkout-index` 无法改写安全捕获所排除的文件。于是被排除的文件会在 `/rewind` 中原样保留，包括某个影子提交在它超过上限之前曾跟踪过的文件。

控制器会把每次捕获的第一组排除项作为警告通知报告，最多列出三个路径，并在集合未变化时保持安静。

## 考虑过的替代方案

**提高默认上限。** 该产物本就超过 25 MiB 默认值，而任何固定默认值都可能被超过；提高上限只是把自我阻塞推迟，而不是消除它。

**保留失败关闭式准入并让工具 hook 吞掉错误。** 被拒绝的工具会在该轮次没有任何检查点的情况下运行，悄悄缩小 `/rewind` 的覆盖范围，而不是为上限以内的每个文件保留覆盖。

**先暂存整个工作区，再取消暂存被排除的路径。** `git add --all` 会在取消暂存之前读取每个文件，因此 56 MB 的 blob 会进入对象库，违背该上限的内存约束。

## 结果

包含超限文件的工作区仍保留其工具、检查点和 `/rewind` 对所有合格文件的覆盖；被排除的文件在缩小或上限提高之前不进入检查点历史。影子仓库现在依赖 `git add` 与 `git rm` 对 `--pathspec-from-file` 的支持。预检改为返回文件列表而不是原地校验，`capture()` 的调用方会读取排除集合用于通知。

## 测试

`packages/ui/tui/tests/rewind.spec.ts` 覆盖单文件与总大小排除、所有文件都被排除的工作区、删除暂存，以及恢复会原样保留此前被跟踪但已超过上限的文件。
