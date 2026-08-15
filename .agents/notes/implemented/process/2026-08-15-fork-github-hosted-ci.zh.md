# Agent Note：Fork CI 使用 GitHub 托管 runner

Status: implemented

[English](2026-08-15-fork-github-hosted-ci.md) | 中文

## 问题

本社区 fork 没有 DeepSeek 的企业 runner 池（`dsh-ubuntu-24-04-16core`、`dsh-windows-2025-16core`）。必跑的 `node 24` 任务一直排队，因此 `all checks passed` 从不执行。暂缓的发布 pack 任务使用任务级 `if: workflow_dispatch`，在 pull request 上会跳过该检查名；分支保护把缺失的必跑检查视为失败。CLI 发布工作流没有 `pull_request` 触发器，因此必跑的 `plan release` 检查也会立即失败。

## 决策

必跑的 Linux worker 默认使用 `ubuntu-latest`。原生 Windows 任务默认使用 `windows-2025`。当 `DSH_CI_FAILOVER_LINUX` 与 `DSH_CI_FAILOVER_WINDOWS` 为 `selfhosted` 时，仍会改到内部自托管池；见[故障转移手册](2026-07-26-ci-failover-runbook.md)。

GitHub 托管默认路径的并发按 2 核机器取值：`DSH_GATE_CONCURRENCY=2`、两个 coverage worker、四个 snapshot worker。

[Release (dsh)](../../../../.github/workflows/release.yml) 与 [Release (vendor)](../../../../.github/workflows/release-vendor.yml) 的 pack 任务始终运行。非 `workflow_dispatch` 时打印“打包需手动触发”并成功。Dispatch 仍然执行打包。

[Release deepseek-harness-cli](../../../../.github/workflows/deepseek-harness-cli-release.yml) 在 pull request 上运行 `plan release`，并在该事件上跳过 build、package、release、npm 与 brew 任务。

手动 benchmark 矩阵仍使用企业 runner 名称；这些任务保持仅 dispatch。

## 测试

`scripts/ci-workflow.spec.ts` 固定未设置时的默认值为 `ubuntu-latest` / `windows-2025`、pack 任务的暂缓步骤，以及 CLI 发布在 pull request 上只跑 plan 的约定。

## 考虑过的替代方案

**保留企业标签，等待 DeepSeek runner。**否决，因为本 fork 无法分配这些标签；排队的必跑任务会阻塞每个 pull request。

**从 pull_request 中删除发布工作流。**否决，因为分支保护已经点名 `Pack npm tarballs` 与 `plan release`；一次成功的空操作可以让这些名称变绿，而不真正打包。

**每个 pull request 都跑五目标 CLI exe 构建。**否决，因为 macos-15-intel、ubuntu-24.04-arm 以及完整的 pkg SEA 构建是发布成本，不是 pull request 信号。

## 后果

本 fork 上的 pull request 可以在标准 GitHub 托管 runner 上跑完必跑的 Linux 与 Wine 任务。coverage 与 snapshot 通道比 16 核企业池更慢。若写作者拥有那些机器，自托管故障转移仍然可用。只有 dispatch 才会打包 npm tarball 或构建发布 exe。
