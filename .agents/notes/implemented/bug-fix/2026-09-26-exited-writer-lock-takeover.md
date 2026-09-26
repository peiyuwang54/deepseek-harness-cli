# Agent Note: Taking over an exited writer's lock

Status: implemented

English | [中文](2026-09-26-exited-writer-lock-takeover.zh.md)

## Problem

`withFileLock` creates `<file>.lock` with exclusive create and removes it in a `finally`. A process terminated before that cleanup leaves the lock behind, so later settings, credentials, or managed MCP catalog writes time out until an operator deletes it. File age cannot distinguish a crashed holder from a paused live writer.

## Decision

The lock keeps its existing `<pid>\n` record. A contender probes that PID with signal 0 and considers the holder absent only after `ESRCH`; a live process, `EPERM`, the contender's own PID, and malformed or unreadable records remain contended.

Contenders for one exited holder serialize on `<file>.lock.takeover-<record hash>`, created with `wx`. The claimant re-reads the lock and probes the PID again before removing it, then removes the claim and retries acquisition immediately. A changed record or a PID that became live therefore keeps the lock. Claim contention and a temporarily unremovable lock return to bounded backoff; an unrelated claim-creation failure remains loud.

The optional `waitMs` acquisition setting extends the two-second default for a caller whose protected operation legitimately lasts longer. It changes only how long a live or unprovable holder is awaited; it does not weaken takeover checks.

## Alternatives considered

**Remove a lock older than a fixed duration.** Rejected because age cannot distinguish a crashed process from a paused or slow live holder.

**Remove the lock immediately after one failed PID probe.** Rejected because another contender may replace the lock, or the operating system may reuse the PID, between the probe and removal. The claim, second record read, and second probe close both races.

**Use kernel-released locks.** Deferred because the zero-dependency utility must interoperate with releases that coordinate through the lock file; replacing the protocol would require both mechanisms during transition.

## Testing

Focused coverage uses injected process probes and filesystem failures to pin exited-holder takeover, real exited-process recovery on POSIX, eight concurrent contenders without overlap, live and invalid records, cross-user and self-PID handling, record replacement, PID reuse, unreadable locks, claim contention, removal failures, and loud unrelated failures. The package remains at 100% statement, branch, function, and line coverage.

## Consequences

Locks left by a process that is proven gone recover on the next write without operator action. A malformed record, a reused PID, or an abandoned claim still requires inspection. PID probing is local to one host and namespace, so writers on different hosts or in different PID namespaces must not share these lock files.
