# Agent Note: 与 Tools 无关的 MCP 连接诊断

Status: implemented

[English](2026-08-19-mcp-connectivity-diagnostics.md) | 中文

## Problem

仅检查 catalog 语法无法证明已启用的受管 MCP 服务器能够初始化，而根据 Tools 推断连接健康状况会错误拒绝只提供 Resources 或 Prompts 的服务器。诊断必须使用与 profile 启动相同的传输与凭据处理，并且不能保留工具、进程或凭据。

## Decision

`managedMcpTargets()` 解析权威的版本 0 catalog，并且只为已启用条目解析环境变量引用。`deepseek doctor` 通过 `probeMcpConnection()` 连接每个已启用目标，完成 initialize 和已声明的全部 `tools/list` 分页，随后立即关闭客户端。`--mcp-timeout-ms` 设置单次请求上限，默认值为 5000 毫秒。禁用条目只会报告状态，不会启动。

探测成功时会报告已发现的工具数量。只有 catalog 条目设置 `failOnStartupError` 时，连接失败才会阻断；其他连接失败属于警告，与 profile 激活行为一致。catalog 解析或引用解析失败始终会阻断。诊断输出绝不包含已解析的凭据值。

MCP 客户端把缺少 Tools 能力视为有效的空工具世代。因此，仅提供 Resources 或 Prompts 的服务器会保持连接，并继续通过 `ctx.mcp` 可用；从有工具世代切换为没有 Tools 时，旧注册会被释放。

## Verification

CLI 测试覆盖跳过禁用条目、可选与必需服务器失败、超时传递，以及从 catalog 解析、initialize、发现到进程关闭的真实凭据清理 stdio fixture。MCP 客户端测试证明没有 Tools 的服务器不会发布注册，并会移除之前的工具世代。

## Alternatives considered

**只报告 catalog 有效性。** 否决，因为有效 JSON 无法发现可执行文件缺失、HTTP 连接被拒、OAuth 刷新失败或协议初始化错误。

**从运行时工具列表推断健康状态。** 否决，因为已连接服务器可以合法发布零个工具，而且 doctor 不会挂载 profile。

**让每次连接失败都阻断。** 否决，因为受管 MCP 启动已经区分可选服务器与设置 `failOnStartupError` 的条目；诊断使用相同的可用性决定。

## Consequences

Doctor 可能启动已启用受管 MCP 条目声明的本地命令并发起网络请求。有界探测会关闭每个连接且绝不注册工具，但服务器自身的启动副作用仍会发生。仅提供 Resources 或 Prompts 的服务器可以参与运行时 catalog，无需虚构占位工具。
