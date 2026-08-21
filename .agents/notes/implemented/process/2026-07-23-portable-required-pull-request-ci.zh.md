# Agent Note: 拉取请求 CI 的可移植恢复边界

Status: implemented

[English](2026-07-23-portable-required-pull-request-ci.md) | 中文

## 问题

分配到组织自有运行器标签的拉取请求必需作业，在 GitHub 无法为这些池分配运行器时会持续排队。工作流本身有效，GitHub 标准托管作业仍能通过，但 `all checks passed` 始终无法启动，原本健康的拉取请求因此无法满足分支保护要求。

账单状态正常、运行器定义处于 `Ready` 状态以及较高的自动扩缩容上限，都不能证明指定的运行器池可以接收作业。必需的正确性检查需要预先明确一条可移植恢复路径，即使日常低延迟路径依赖仓库外部的运行器预配也不例外。

## 决策

[CI](../../../../.github/workflows/ci.yml) 在托管选择器上运行必需的主 Node 24 作业：默认使用标准 `ubuntu-24.04`，也可接受仓库配置的可选大型 runner 标签。稳定的 `all checks passed` 聚合流程使用标准 `ubuntu-latest`，除非 Linux 故障切换开关将它与工作作业一同重定向。[可移植 runner 默认值](2026-08-19-portable-ci-runner-defaults.md)取代本记录中以企业级池为主选的分配决策，同时将大型托管容量保留为显式仓库状态。必需的 Windows 作业在标准 `ubuntu-latest` 上通过 Wine 运行 Windows Node，覆盖阻断性检查范围；一个独立的原生 Windows 作业默认使用 `windows-2025`，但不参与聚合流程（[双 Windows 决策](2026-08-08-native-windows-pull-request-ci.md)）。标准托管作业还保留 Node 22.19、Node 26、Python SDK 单元测试套件与[发布形态的 Linux x64 Python 运行时验证](../testing/2026-08-12-required-python-runtime-pull-request-ci.md)，串行参考流程仍是完整且未分片的跨平台定义。

三项 Linux 主作业、Node 兼容性、Python SDK 单元测试套件、Python 运行时验证和 `windows node 24 / wine blocking` 继续作为 `all checks passed` 的依赖项；`windows node 24 / native complete` 被刻意排除。分支保护继续要求 `e2e` 和 `all checks passed`。未设置主选标签变量时，每个必需作业都有 GitHub 托管的标准分配。无法分配的已配置标签仍会让对应作业持续排队；删除该变量会恢复可移植分配，而独立的自托管开关仍可用于已配置池故障。

[大型 runner 决策](2026-07-22-evidence-based-larger-hosted-runners.md)拥有已测量的更高容量配置。[跨平台串行参考流程](2026-07-21-serial-cross-platform-ci-reference.md)继续作为独立的完整性检查，现由 `master` 上公司自有 `vm-backup`／`dsh-win-ci` 自托管热备通道提供；仅存的托管串行参考是禁用的 `serial-macos`。手动大型 runner 套件则保留规格比较，同时不扩大普通必需矩阵。

## 曾考虑的替代方案

**要求 Linux 主作业使用大型 runner 标签。** 这能为已配置仓库提供更快反馈，但没有这些标签的仓库无法获得判定。托管主选变量保留已测量的配置，但不会将其设为可运行默认值。

**根据标称核心数选择企业规格。** 基准测试表明扩展效果不呈单调变化，设置耗时也存在波动，因此必需运行器池改由完整作业的精确测量结果选定。

**在容量不可用时跳过检查或降低其级别。** 这种方式通过丢弃证据而非执行仓库的必需约定来使状态变绿。

**在每台主机上使用同一工作线程策略。** 外层门禁并发与内层工具工作线程在 Linux、Windows 和标准运行器上的争用方式不同；按主机实测的上限可以避免新增核心反而拖慢执行。

## 后果

普通拉取请求不需要仓库专用 runner 标签。配置了更大托管标签的仓库会将该容量用于 Linux 关键路径和独立的原生 Windows 信号，而 Wine 作业让必需的 Windows 判定继续使用标准 Linux 分配。一次针对确切分支头的实际运行会区分分支保护采用的命令与单独的诊断约定；排队延迟与每个作业从 `startedAt` 到 `completedAt` 的执行区间分开报告。

已配置 runner 标签是显式的加速依赖，而不是隐式的正确性依赖。该标签发生故障时，删除主选标签变量会恢复标准托管分配，故障切换变量则可将可信拉取请求路由到已验证的自托管池。仅改变运行器池定义的状态，仍不足以证明它可以接收作业。
