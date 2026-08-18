# @deepseek-ai/dsh-subagent-worktree

[English](README.md) | 中文

`dsh-subagent-worktree` 为编码子代理提供隔离的 Git 检出目录。每个检出使用 `dsh/subagent/<id>` 分支，默认保存在 `$DSH_HOME/subagent-worktrees`（也可配置根目录）。创建过程不会修改用户当前检出目录。

子代理退出后检出仍会保留。使用 `merge(id, targetCwd)` 将它合并到明确指定且干净的检出目录，或使用 `discard(id)` 删除检出和分支。存在未提交修改的检出必须使用 `force: true` 才能丢弃。

## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `root` | `$DSH_HOME/subagent-worktrees` | 持久化检出目录。 |
| `maxConcurrent` | `4` | 同时执行 `git worktree add` 的最大数量。 |

服务要求系统安装 Git，并且父会话具有绝对路径的工作区。非 Git 工作区会在子代理发布前失败。

## Model Experience

无。本包管理主机侧 Git 检出目录，不注册面向模型的工具，也不会向模型请求添加内容。

#### KV Cache effect

无；worktree 元数据保存在会话记录之外。

## 已知限制与后续工作

- Worktree 记录会持久化到磁盘，但隔离的可继续子代理在冷恢复时还不会自动重建缺失的检出目录。
- 合并是显式的 Git 合并，不会自动解决冲突。
