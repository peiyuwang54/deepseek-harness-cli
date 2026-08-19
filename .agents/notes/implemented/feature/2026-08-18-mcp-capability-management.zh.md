# Agent Note: MCP catalog 控制与能力发现

Status: implemented

[English](2026-08-18-mcp-capability-management.md) | 中文

## 问题

CLI 可以连接受管 MCP 服务器并暴露工具，但用户不能在不手动编辑 JSON 的情况下暂停服务器，TUI 也无法检查 MCP Resources 或 Prompts。这使服务器生命周期和非工具 MCP 能力在主要界面中不可见。

## 决策

受管 `$DSH_HOME/mcp.json` catalog 接受可选的 `enabled` 标记。`deepseek mcp enable <name>` 与 `deepseek mcp disable <name>` 使用现有锁和原子写入路径更新该标记。停用条目仍可查看，但不会投影到 profile patch；启用或停用会在下一次 CLI 启动后生效。

运行时 MCP registry 提供与传输无关的 Resources、URI 模板、Prompts 发现、资源读取和提示词展开方法。MCP 客户端把这些方法委托给当前 SDK 世代，并排空分页列表。TUI 通过 `/mcp resources [server] [uri]` 与 `/mcp prompts [server] [prompt]` 暴露它们。能力缺失和连接中断都会返回明确诊断；OAuth 仍由传输层负责，registry 不保存凭据。

## 曾考虑的替代方案

**继续手动编辑 `mcp.json`。** 否决：日常安全操作不应依赖编辑包含密钥引用的 catalog，也无法向用户清楚展示停用状态。

**把 Resources 和 Prompts 注册为模型工具。** 否决：它们的协议语义不是工具调用，把所有资源或提示词注入每次模型请求会增加 token 成本，并混淆用户控制的发现与模型可见工具。

**在启动时缓存发现结果。** 否决：可选 MCP 能力不应延迟或破坏只使用工具的启动；按需调用能保持启动行为并反映服务器当前 catalog。

## 后果

用户可以暂时停用 MCP 服务器，同时保留配置和密钥引用。终端现在可以检查 Resources 和 Prompts，工具注册行为保持不变。发现调用使用配置的 MCP 调用超时，服务器断开时不可用。[OAuth 登录与 token 存储](2026-08-18-mcp-oauth.md)特意保持为无需启动 profile 的操作；运行时 registry 仍不接触凭据。
