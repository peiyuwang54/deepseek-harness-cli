# Agent Note：功能开发期间暂缓发布与真实内核检查

Status: implemented

[English](2026-08-15-deferred-release-and-sandbox-checks.md) | 中文

## 问题

预发布 CLI 功能开发需要较短的反馈周期，而 npm 发布演练与真实内核隔离矩阵验证的是独立的发布和平台问题。在发布候选尚不存在时，每次普通 `master` push 都运行这些任务，会报告无法诊断当前终端行为的失败，并占用平台 runner。

## 决策

普通 pull request 与 `master` push 仍保留发布工作流检查。pack 任务会运行并以“打包需手动触发”的说明成功，不再跳过该检查名。发布仍仅在 dispatch 时执行。真实内核 Sandbox 工作流也继续出现在 `master` push 中，但跳过其操作系统矩阵。dsh／vendor 软件包演练以及 bwrap、Landlock、Seatbelt 矩阵仍可手动触发。

这是 CLI 功能与终端 UI 快速变化期间的临时预发布策略。第一个带标签的版本发布前，应恢复自动软件包演练与平台沙箱矩阵，让发布候选的软件包和隔离能力获得验证。

## 考虑过的替代方案

**删除发布与 Sandbox 工作流。** 不采用，因为手动触发可以保留精确的发布和平台验证、明确展示暂缓的覆盖面，也避免在发布前重新创建工作流。

**每次 `master` push 都运行所有任务。** 不采用，因为这会把最慢的平台信号消耗在无关的功能迭代上，并把预期的软件包或内核失败表现成对当前 UI 改动的诊断。

## 后果

功能迭代由聚焦行为测试、快照、类型检查和源码门禁判断，不再被无关的发布流程或稀缺平台 runner 阻塞。暂缓的 pack 检查为绿色，并不声称已经产出 npm 产物。跳过的 Sandbox 矩阵并不声称真实内核隔离已经通过。pull request 检查名见 [fork 托管 CI](2026-08-15-fork-github-hosted-ci.md)。
