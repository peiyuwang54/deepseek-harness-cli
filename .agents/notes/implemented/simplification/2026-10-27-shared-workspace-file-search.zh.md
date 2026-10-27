# Agent Note: 共享工作区文件搜索

Status: implemented

[English](2026-10-27-shared-workspace-file-search.md) | 中文

## Problem

TUI 与本地文件引用提供方分别实现了相同的有界模糊索引、取消、路径校验和排序逻辑。这些副本无法通过重复代码检查，修复遍历或生命周期行为时也容易产生差异。

## Decision

由现有的 `dsh-file-reference-local/search` 导出统一提供搜索实现。每个调用方都显式传入解析后的 `respectIgnoreFiles`：提供方保留仅按目录基名排除的行为，TUI 保留可配置的忽略文件处理。共享语法仍由 `dsh-file-reference/grammar` 提供；TUI 根据 Pi 的闭合引号规则适配目录插入，不再重复解析 token 或校验路径。

## Alternatives considered

让提供方导入 TUI 会颠倒包的归属关系。新建工具包会为已有文件引用提供方负责的功能额外增加一个包。禁用重复检测则会继续保留两套相同的生命周期和排序规则。

## Consequences

TUI 声明对两个文件引用包的依赖，不再直接依赖 `ignore`。搜索上限、取消、候选顺序、符号链接拒绝和插入文本均保持不变。关闭忽略文件处理时也跳过嵌套 `.ignore`，保留提供方不按忽略文件过滤的发现行为，并让 TUI 文档约定的关闭选项在整棵目录树生效。提供方和 TUI 的测试覆盖各自不同的忽略与引号规则；定向覆盖率检查和完整 TUI 文件补全快照验证两种过滤模式。
