# Agent Note: Permission security policy

Status: implemented

English | [中文](2026-08-18-permission-security-policy.md)

## Problem

权限预设可以控制沙箱和审批值，但部署缺少一套共享策略来约束面向模型的工具名、Shell 命令文本、出站获取主机以及 MCP 服务信任关系。

## Decision

`PermissionPresetService` 接受可选的 `security` 策略。组合 `dsh-tools` 后，其 `tools/pre-execute` 监听器会应用精确的工具允许／拒绝列表、适用于 `bash` 和 `pwsh` 的正则表达式命令允许／拒绝列表、用于 `web_fetch` 的精确或通配主机允许列表，以及每个 MCP 服务的操作（`trusted`、`prompt` 或 `blocked`）。正则表达式和主机条目会在构造期间验证。`administratorLocked` 会阻止通过 `/permissions`、`set()` 和 `setPolicy()` 进行运行时权限更改。

## Alternatives considered

**把每条规则放进各自的工具提供方。** 否决：部署需要维护多套策略实现，MCP 工具也无法共享同一个信任决策。

**在策略监听器中改写工具参数。** 否决：`tools/pre-execute` 接收已经记录且面向模型的参数，不能让记录内容与实际执行分离。

**把主机匹配当作 SSRF 防护。** 否决：主机名匹配不会解析 DNS 或判断私有地址；网络隔离仍负责该边界。

## Consequences

配置文件可以在不修改单个工具包的情况下声明一套部署策略。省略字段会保留现有行为。无效策略条目会在加载时失败，MCP 的 `prompt` 信任仍使用常规审批流程。子代理深度和工具调用并发量仍由已有的 subagent 与 agent-loop 配置 seam 负责。

## Verification

`pnpm exec vitest run packages/interaction/permission-presets/tests/permission-presets.spec.ts` 与 `pnpm exec tsc -p packages/interaction/permission-presets/tsconfig.json --noEmit` 覆盖策略决策、错误配置和管理员锁定。
