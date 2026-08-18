# Agent Note: Permission security policy

Status: implemented

English | [中文](2026-08-18-permission-security-policy.zh.md)

## Problem

Permission presets controlled sandbox and approval values, but deployments had no shared policy for model-facing tool names, shell command text, outbound fetch hosts, or MCP server trust.

## Decision

`PermissionPresetService` accepts an optional `security` policy. When `dsh-tools` is composed, its `tools/pre-execute` listener applies exact tool allow/deny lists, regular-expression command allow/deny lists for `bash` and `pwsh`, exact or wildcard host allowlists for `web_fetch`, and per-server MCP actions (`trusted`, `prompt`, or `blocked`). Regex and host entries are validated during construction. `administratorLocked` prevents runtime permission changes through `/permissions`, `set()`, and `setPolicy()`.

## Alternatives considered

**Put each rule in its tool provider.** Rejected: deployments would need separate policy implementations and MCP tools would not share one trust decision.

**Rewrite tool arguments in the policy listener.** Rejected: `tools/pre-execute` receives logged, model-visible arguments and intentionally cannot desynchronize them from execution.

**Treat host matching as SSRF protection.** Rejected: hostname matching does not resolve DNS or classify private addresses; network isolation remains responsible for that boundary.

## Consequences

Profiles can express one deployment policy without changing individual tool packages. An omitted field preserves the existing behavior. Invalid policy entries fail at load, and `prompt` MCP trust still uses the normal approval path. Subagent depth and tool-call concurrency remain owned by their existing subagent and agent-loop configuration seams.

## Verification

`pnpm exec vitest run packages/interaction/permission-presets/tests/permission-presets.spec.ts` and `pnpm exec tsc -p packages/interaction/permission-presets/tsconfig.json --noEmit` cover policy decisions, malformed configuration, and administrator locking.
