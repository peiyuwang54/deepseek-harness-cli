# Agent Note: Isolated Git worktrees for coding subagents

Status: implemented

[English](2026-08-18-subagent-worktree-isolation.md) | 中文

## Problem

会修改仓库的执行型子代理需要独立于父会话的工作区，这样失败或未完成的修改不会污染用户当前文件。

## Decision

`@deepseek-ai/dsh-subagent-worktree` 为每个隔离的一次性子代理管理一个 Git 分支和检出目录。检出目录默认位于 `$DSH_HOME/subagent-worktrees`，并以 JSON 记录，子代理会话的持久化 `cwd` 指向该目录。进程内 spawn 和 fork provider 声明 `worktree` 能力，外部 provider 会拒绝该选项。`subagent_worktree` 面向模型的工具启动前台隔离子代理。TUI 提供 `/subagents worktree list`、`status`、`merge` 和 `discard`；合并要求明确指定且干净的目标目录，存在未提交修改时丢弃必须使用 `--force`。

## Alternatives considered

- **直接修改父工作区并依赖 `/rewind`** — 否决，因为 rewind 只提供恢复能力，不能阻止并发子代理观察或修改同一批文件。
- **使用没有 Git 分支的临时目录** — 否决，因为选择性审查和合并需要持久分支以及普通 Git diff/status 行为。
- **子代理结束时立即删除所有 worktree** — 否决，因为用户需要检查并选择性合并已完成或部分完成的编码工作。

## Consequences

隔离的一次性子代理要求父工作区是 Git 仓库，并在用户合并或丢弃前保留分支。可继续子代理继续使用原有的进程内工作区约定，不请求隔离；冷恢复时自动重建 worktree 仍是已记录的限制。Worktree 操作是明确的主机侧修改，使用临时真实仓库和 spawn 集成测试覆盖。
