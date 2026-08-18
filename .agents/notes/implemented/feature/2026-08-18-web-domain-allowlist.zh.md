# Agent Note: HTTP fetch 域名 allowlist

Status: implemented

[English](2026-08-18-web-domain-allowlist.md) | 中文

## Problem

本地 HTTP fetch 提供方已经校验协议、凭据、重定向来源和响应上限，但部署无法把出站请求限制在批准的域名集合内。

## Decision

`web-fetch-http` 接受可选的 `allowedDomains` 配置。精确主机条目只允许一个主机；`*.example.com` 条目允许子域但不允许裸后缀。列表会在插件加载时规范化并校验。提供方在首次请求前检查初始 URL，并在 URL 与同源校验后检查每个重定向目标。未设置列表时保留现有部署的 unrestricted 行为；空列表拒绝所有主机。

## Alternatives considered

**只在面向模型的工具层应用列表。** 否决：直接调用 `ctx.web.fetch()` 的路径会绕过限制。

**把列表当作 SSRF 防护。** 否决：主机名匹配不会解析 DNS 或分类私有地址，因此该边界仍由网络隔离负责。

**静默忽略格式错误的条目。** 否决：无效策略必须在加载时失败，不能产生意外的宽泛 allowlist。

## Consequences

部署可以在不改提供方代码的情况下声明窄范围 HTTP 出站策略。直接请求和重定向会一致应用该策略，并返回 `WEB_DOMAIN_BLOCKED` 诊断。此功能是 allowlist，不是私有网络或 DNS 感知 SSRF 防护的替代品。
