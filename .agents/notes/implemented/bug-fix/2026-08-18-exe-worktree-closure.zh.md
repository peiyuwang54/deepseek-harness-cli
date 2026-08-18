# Agent Note: 可执行文件依赖闭包包含工作树子代理

Status: implemented

[English](2026-08-18-exe-worktree-closure.md) | 中文

## 问题

工作树隔离子代理 bundle 依赖 `@deepseek-ai/dsh-subagent-worktree`，但可执行文件专用部署清单没有列出这个包。因此运行时闭包校验会在打包前拒绝所有平台构建。

## 决策

可执行文件部署清单与其他子代理包并列声明 `@deepseek-ai/dsh-subagent-worktree`。运行时闭包门禁会沿 `dsh-base` 的依赖关系检查它，删除该条目就会失败。

## 曾考虑的替代方案

**在可执行文件 profile 中禁用工作树子代理。** 不采用：发布版 CLI 应与源码 profile 提供相同的隔离子代理能力。

**在清单之外把包复制到暂存目录。** 不采用：隐式资产绕过依赖闭包，容易与工作区依赖声明漂移。

## 后果

每个平台的 CLI 打包构建都会包含工作树提供方，闭包校验也会在构建期发现后续遗漏。即使会话不创建子代理，可执行文件暂存树也会包含该提供方的运行时文件。

## 测试

本地 `pnpm exec tsx scripts/verify-runtime-closure.ts --manifest=apps/cli/exe/package.json` 已通过；发布 CI 会在每个平台可执行文件构建前运行相同门禁。
