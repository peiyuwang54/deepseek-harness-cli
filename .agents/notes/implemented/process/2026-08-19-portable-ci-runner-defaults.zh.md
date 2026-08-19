# Agent Note: CI runner 选择的可移植默认值

Status: implemented

[English](2026-08-19-portable-ci-runner-defaults.md) | 中文

## Problem

PR CI 包含三个必需的 Linux 作业和一个提示性的原生 Windows 作业。对于未配置某个仓库专用托管 runner 标签的仓库，该标签没有可用含义：GitHub 会让作业一直排队且不分配 runner，因此没有工作流步骤能报告有用的失败。runner 容量属于部署状态，而工作流还需要一个适用于仓库独立副本的可用默认值。

## Decision

每个受影响的作业按以下顺序解析 runner：由 `DSH_CI_FAILOVER_LINUX` 或 `DSH_CI_FAILOVER_WINDOWS` 选中的可信自托管故障切换、由 `DSH_CI_HOSTED_LINUX_RUNNER` 或 `DSH_CI_HOSTED_WINDOWS_RUNNER` 提供的仓库已配置主标签，最后是 GitHub 托管的标准 `ubuntu-24.04` 或 `windows-2025` 标签。主选变量接受一个托管 runner 标签。主选变量未设置时构成完整且可运行的配置，而不是对组织所有 runner 的隐式依赖。

该决策仅取代[可移植恢复边界](2026-07-23-portable-required-pull-request-ci.md)与[大型 runner 测量](2026-07-22-evidence-based-larger-hosted-runners.md)中默认必需的大型 runner 分配。它们的作业拆分、已测量容量配置、聚合成员关系和自托管恢复机制仍为当前事实。

标准 Linux 路径使用与标准托管机器相匹配的并发度：两个门禁或覆盖率 worker，以及四个快照任务。已配置的 Linux 托管标签保留大型 runner 设置，自托管路径保留共享虚拟机设置。独立的 [CI 故障切换手册](2026-07-26-ci-failover-runbook.md)继续拥有故障路由和 Dependabot 排除规则；故障切换优先于主托管标签。

`scripts/ci-workflow.spec.ts` 固定选择器顺序、可移植标签、保守的标准 runner 并发度，以及 Linux 和 Windows 变量的相互独立性。该检查特意不证明任意已配置标签实际存在；GitHub 拥有 runner 注册与分配。

## Alternatives considered

**在工作流中保留仓库专用标签。** 不采用，因为缺少的标签会在仓库代码能运行之前导致无限排队，且每个独立部署都必须修改源码才能获得 CI 判定。

**始终使用 GitHub 托管的标准 runner。** 不采用，因为具有更大托管容量的仓库会失去有用的并行能力。仓库变量能保留该容量，但不会将其变成先决条件。

**在更早的作业中探测 runner 可用性。** 不采用，因为工作流无法在分派后动态更改另一个作业的 `runs-on`，而不可用的 runner 又会阻止受影响作业自身执行该探测。

## Consequences

没有 Actions 变量的仓库会在标准托管 runner 上获得完整的 Linux 和 Windows 信号。具有更大托管池的仓库设置两个独立的主选标签变量，并保留更高的并发配置。拼写错误或不可用的已配置标签仍可能无限排队，但该依赖是显式的仓库状态，删除变量即可恢复可移植默认值。工作流包含三种容量配置——标准托管、已配置托管和自托管故障切换，它们的选择与 worker 限制持续由回归测试固定。
