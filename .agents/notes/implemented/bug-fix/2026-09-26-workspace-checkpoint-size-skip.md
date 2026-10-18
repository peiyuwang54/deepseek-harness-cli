# Agent Note: Workspace checkpoint size limits skip files instead of blocking tools

Status: implemented

English | [中文](2026-09-26-workspace-checkpoint-size-skip.zh.md)

## Problem

A workspace checkpoint runs as a `tools/execute` pre-turn hook, so any admission failure stopped the tool body. One regular file over `rewindMaxFileBytes` (25 MiB by default) therefore blocked every tool, including reading the file that caused the refusal. A memory test that wrote a 56 MB JSON transcript into the workspace made the whole session unusable until the file was removed or the limit raised.

The [rewind decision](../feature/2026-08-18-tui-workspace-rewind.md) chose fail-closed admission so a partial tree could never be restored. This note changes only size-limit admission.

## Decision

`ShadowWorkspace.capture()` returns a `WorkspaceCheckpointCapture`: the commit id plus every regular file it excluded. Preflight classifies each candidate path and skips a file over `maxFileBytes`, or one whose size would push the running total past `maxTotalBytes`, recording the path, its observed byte size, and whether the per-file or aggregate limit excluded it. Other admission failures — special files, embedded repositories, path escapes, Git errors, and symbolic-link parents — still throw.

Capture stages only the included paths through a NUL-separated `--pathspec-from-file` list of literal pathspecs, so Git never reads an excluded file and a path containing glob characters names only itself. Excluded paths are removed from the shadow index with `git rm --cached --ignore-unmatch`, so no shadow commit contains them.

Restore reuses the safety capture's exclusions: it skips those paths in the removal and symbolic-link checks and drops them from the index after `read-tree`, so `checkout-index` cannot rewrite a file the safety capture excluded. An excluded file therefore survives `/rewind` untouched, including one a shadow commit tracked before it grew past the limit.

The controller reports the first exclusion set of each capture as a warning notice naming up to three paths, and stays quiet for an unchanged set.

## Alternatives considered

**Raise the default limit.** The artifact already exceeded the 25 MiB default, and any fixed default can be exceeded; raising it moves the self-block later instead of removing it.

**Keep fail-closed admission and let the tool hook swallow the error.** The refused tool would run with no checkpoint for that turn, silently narrowing `/rewind` coverage instead of keeping it for every file under the limit.

**Stage the whole workspace, then unstage excluded paths.** `git add --all` reads each file before the unstage, so a 56 MB blob would enter the object store and defeat the limit's memory bound.

## Consequences

A workspace containing a file over the size limit keeps its tools, its checkpoints, and its `/rewind` reach for every eligible file; the excluded file stays outside checkpoint history until it shrinks or the limit rises. The shadow repository now depends on `--pathspec-from-file` support in `git add` and `git rm`. Preflight returns file lists instead of validating in place, and `capture()` callers read the excluded set for the notice.

## Testing

`packages/ui/tui/tests/rewind.spec.ts` covers per-file and aggregate exclusion, a workspace where every file is excluded, deletion staging, and a restore that leaves a previously tracked file above the limit untouched.
