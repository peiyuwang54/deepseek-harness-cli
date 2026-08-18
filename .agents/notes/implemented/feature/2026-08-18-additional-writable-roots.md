# Agent Note: Durable additional writable roots

Status: implemented

English | [中文](2026-08-18-additional-writable-roots.zh.md)

## Problem

An agent session had one immutable workspace root from `SessionHeader.cwd`. Work spanning a sibling repository or shared directory therefore required `danger-full-access`, even when the user wanted only one additional path. A startup-only allowlist would not survive resume, and a path accepted by the CLI but ignored by one sandbox backend would overstate the permission boundary.

## Decision

The interactive and headless front doors accept repeatable `--add-dir <dir>` options. Relative paths resolve from the session cwd. `SandboxPolicyService.addWritableRoots()` requires every input to identify an existing directory, resolves filesystem identity, removes the primary root and duplicates, and appends one complete `sandbox/writable-roots` snapshot only after every input validates. Resume folds the latest snapshot and can add more roots. The primary root remains the process cwd; additional roots widen only `workspace-write`. `read-only` grants none of them, and `danger-full-access` still bypasses confinement.

`SandboxExecutionPolicy` carries a required `additionalWritableRoots` array. The in-process filesystem fence, Bubblewrap, Landlock, Seatbelt, and the Windows ACL runner all consume the same resolved root set. The policy context lists the declared roots as JSON, so model-visible authority remains reconstructable from the session log. The new additive event does not change the session envelope and does not bump `SESSION_FORMAT_VERSION`.

Windows derives its standing write SID from the sorted, deduplicated canonical root set. One SID is granted on every root in that exact set, while the private temporary SID remains scoped to a live session/root-set pair. Changing the set produces a different SID instead of silently accumulating authority under an existing identity. The runner accepts repeated `--workspace` arguments and verifies a seam-managed SID against the complete order-independent set.

The command surface follows Codex CLI's repeatable [`--add-dir`](https://github.com/openai/codex/blob/main/codex-rs/cli/src/main.rs), while persistence and enforcement use DeepSeek Harness's session log and sandbox seams; no Codex source was copied.

This decision partially supersedes the single-root assumptions in the [shared sandbox policy](2026-07-14-cross-family-fs-sandbox.md) and [Windows ACL sandbox](2026-08-08-windows-acl-restricted-token-sandbox.md) notes. Their capability ownership, escalation, backend limits, and ACL mechanism remain current.

## Alternatives considered

**Treat each extra directory as a one-call escalation.** Rejected because a multi-project task needs stable authority across tools and turns, while approval escalation intentionally applies to one retry.

**Store extra roots in user settings.** Rejected because directory authority belongs to a session and must be replayable with the model-visible policy, not inherited by unrelated sessions.

**Let backends read CLI options directly.** Rejected because in-process filesystem tools and subprocess sandboxes would resolve different policies, and embedded callers would have no typed path to the same behavior.

## Consequences

Users can run `deepseek --add-dir ../shared` or `deepseek exec --add-dir ../shared "task"`, repeat the option, and resume with the same root set. Invalid batches fail without partially changing the session. Focused tests cover option parsing, validation, replay, policy context, filesystem containment, every POSIX profile, Windows SID derivation and runner arguments, bundle startup order, and available real sandbox backends. Keyless snapshots pin the changed workspace-write context.
