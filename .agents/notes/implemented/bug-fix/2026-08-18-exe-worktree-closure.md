# Agent Note: Executable dependency closure includes worktree subagents

Status: implemented

English | [中文](2026-08-18-exe-worktree-closure.zh.md)

## Problem

The worktree-isolated subagent bundle depends on `@deepseek-ai/dsh-subagent-worktree`, but the executable-only deploy manifest did not list that package. Runtime-closure verification therefore rejected every platform build before packaging.

## Decision

The executable deploy manifest declares `@deepseek-ai/dsh-subagent-worktree` alongside the other subagent packages. The runtime-closure gate follows the dependency from `dsh-base` and fails if this entry is removed.

## Alternatives considered

**Disable worktree subagents in the executable profile.** Rejected: the published CLI must include the same isolated-subagent capability as the source profile.

**Copy the package into the staging tree outside the manifest.** Rejected: implicit assets bypass the dependency closure and can drift from workspace dependency declarations.

## Consequences

Packaged CLI builds include the worktree provider on every target, and the closure check detects future omissions at build time. The executable staging tree gains the provider's runtime files even when a session does not create a child.

## Testing

`pnpm exec tsx scripts/verify-runtime-closure.ts --manifest=apps/cli/exe/package.json` passes locally; release CI runs the same gate before each platform executable build.
