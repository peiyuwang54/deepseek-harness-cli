# Agent Note: Isolated Git worktrees for coding subagents

Status: implemented

English | [中文](2026-08-18-subagent-worktree-isolation.zh.md)

## Problem

Execution-oriented subagents that edit a repository need a workspace separate from the parent checkout so failed or partial work cannot modify the user's active files.

## Decision

`@deepseek-ai/dsh-subagent-worktree` manages one Git branch and checkout per isolated one-shot child. The checkout is created under `$DSH_HOME/subagent-worktrees`, recorded as JSON, and assigned to the child session's durable `cwd`. The in-process spawn and fork providers advertise the `worktree` capability, while external providers reject the option. The `subagent_worktree` model tool requests a foreground isolated child. The TUI exposes `/subagents worktree list`, `status`, `merge`, and `discard`; merge requires an explicitly selected clean target, and discard requires `--force` for a dirty checkout.

## Alternatives considered

- **Edit the parent checkout and rely on `/rewind`** — rejected because rewind protects recovery but does not prevent concurrent subagents from observing or changing the same files.
- **Use temporary directories without Git branches** — rejected because selective review and merge need a durable branch and ordinary Git diff/status behavior.
- **Delete every worktree when the run ends** — rejected because users need to inspect and selectively merge completed or partial coding work.

## Consequences

Isolated one-shot children require a Git workspace and leave a persistent branch until the user merges or discards it. Continuable children keep their existing process-local workspace contract and do not request isolation; cold-resume recreation remains a documented limitation. Worktree operations are explicit host-side mutations and are covered by real temporary repositories plus the spawn integration test.
