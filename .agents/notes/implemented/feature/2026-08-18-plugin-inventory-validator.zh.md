# Agent Note: 无 profile 的插件清单与验证

Status: implemented

[English](2026-08-18-plugin-inventory-validator.md) | 中文

## Problem

Profile 插件通过 pnpm 安装，但用户需要查看 profile 本地清单，并确定组合包声明、活动层和 patch 文件保持一致。

## Decision

`dsh plugin --profile <name> list` 不启动 pnpm，而是读取 profile manifest 和已解析的包 manifest。`dsh plugin --profile <name> verify` 使用与 profile 启动相同的安装优先查找顺序解析每个活动组合包，读取所有声明的 patch，并报告未激活或过期的组合包行。两个命令都支持 `--json`，不会修改 profile。

## Alternatives considered

- **使用 `pnpm list` 作为清单接口** — 否决，因为诊断会依赖包管理器，而且它不会验证 Loader patch 层。
- **只让 profile 启动负责验证** — 否决，因为损坏的 profile 会在用户知道具体包或层出错前就启动失败。

## Consequences

检查命令只报告包元数据和路径，不会安装、更新、启用或停用插件。成功的 pnpm 修改仍按原逻辑协调组合包层；`verify` 可以在正常 profile 启动前发现手工编辑的 manifest 或缺少的 patch。
