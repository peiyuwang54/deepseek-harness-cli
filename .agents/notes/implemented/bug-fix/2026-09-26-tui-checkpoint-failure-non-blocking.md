# Agent Note: A failed workspace checkpoint does not block the turn

Status: implemented

English | [中文](2026-09-26-tui-checkpoint-failure-non-blocking.zh.md)

## Problem

The TUI ran its pre-turn workspace capture inside the `tools/execute` waterfall and awaited it before calling `next()`. `ShadowWorkspace.capture()` fails closed, so any refusal — a regular file over `rewindMaxFileBytes`, a special file, a Git failure — rejected the listener and failed the tool. The same refusal reached `checkpointDirectShell` before the shell provider ran. A workspace that could not be captured therefore disabled every tool and direct shell, and the only visible signal was per-tool errors; a single oversized file made the session unable to run even `rm`.

The [rewind decision](../feature/2026-08-18-tui-workspace-rewind.md) chose fail-closed admission so a partial tree could never be restored. Its cost was that a checkpoint failure also failed the turn.

## Decision

The controller captures through `attemptCheckpoint`, which reports a failure as one deduplicated warning notice and returns. The pre-turn hook then calls `next()`, and `checkpointDirectShell()` resolves, so the tool or shell body runs with no checkpoint event for that turn. A later successful capture clears the dedupe, so a new failure reports again.

`ShadowWorkspace.capture()` keeps failing closed. Its other caller, the safety capture inside `restore()`, must abort a restore it cannot make safe, so the refusal cannot be swallowed at the workspace layer.

## Alternatives considered

**Exclude only files over the size limit.** The size limit is one refusal among several; a special file or a Git failure still blocks every tool. It also fixes the wrong layer, because the admission path — not the limit — decides whether the turn continues.

**Report the failure but keep blocking the tool.** Fails the same way one refusal later and leaves the harness unusable for a workspace the user cannot always fix.

**Retry the capture on the next tool call instead of reporting.** Retrying a deterministic refusal repeats the same failure for every tool with no user-visible reason.

## Consequences

A workspace the checkpoint cannot capture stays usable: tools and direct shells run, and `/rewind` reports that it has no restore point for that turn instead of silently reverting nothing. The checkpoint's fail-closed guarantee now protects only what `ShadowWorkspace` promises its callers, not the turn's progress. A user who wants restore coverage must remove the refusal cause; the notice names it.

## Testing

`packages/ui/tui/tests/rewind.spec.ts` drives the controller with a workspace over its configured limit: it asserts the pre-turn listener resolves, a direct shell checkpoint resolves, the notice names the refusal once, and an identical failure stays quiet until a capture succeeds.
