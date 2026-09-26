# Agent Note: TUI conversation and workspace rewind

Status: implemented

English | [中文](2026-08-18-tui-workspace-rewind.zh.md)

## Problem

The terminal could fork the current conversation but could not return to an earlier human message or undo workspace mutations from an agent turn. Using the project's Git index or creating real commits would alter user-owned repository state, while deleting every untracked path during recovery could remove ignored or independently created data.

## Decision

The TUI captures the workspace before the current human turn's first top-level tool dispatch and before each direct `!command`. One checkpoint per human turn covers subsequent nested and parallel tool work before any tool body runs. A checkpoint failure other than a size-limit exclusion prevents the tool or shell body from starting.

Each canonical workspace has a shadow Git repository below `$DSH_HOME/workspace-checkpoints/v1/<workspace-hash>`. Its refs, index, config, hooks directory, and object store are isolated from the project's `.git`; process arguments set the workspace only as its work tree. System and global Git configuration, inherited repository environment variables, hooks, signing, automatic line-ending conversion, and global attributes are disabled. The shadow tree includes regular files, symbolic links, and non-ignored untracked files. Configurable per-file and aggregate-size limits skip a regular file before `git add` and leave it out of the tree ([size-limit skip](../bug-fix/2026-09-26-workspace-checkpoint-size-skip.md)); child-process limits, special files, and embedded repositories still reject.

`/rewind` selects a prior direct user message and then chooses conversation, files, or both. Conversation rewind forks through the completed turn before that message and switches to the durable child, leaving the original Session unchanged. File restore captures the current workspace first, verifies every tracked path stays below the canonical root with no symbolic-link parent, restores the selected tree, deletes only paths present in the safety tree but absent from the target, and never rewrites a file excluded by a size limit. Ignored paths never enter the shadow index and are not deleted. `/restore` opens the same picker with files-only preselected.

The Session records only the shadow commit id, checkpoint kind, and associated human-message sequence. File contents remain outside the append-only log and never enter model context.

## Alternatives considered

**Commit in the project repository.** Rejected because even temporary refs and index writes mutate user-owned Git state and can trigger repository configuration.

**Run `git clean -fd` during restore.** Rejected because broad cleanup can delete untracked data that no Harness checkpoint owns.

**Copy the complete workspace directory for each checkpoint.** Rejected because it duplicates unchanged content, follows more filesystem cases, and lacks Git's content-addressed tree restore.

## Verification

Filesystem tests use a real project repository and a separate shadow repository. They prove tracked and untracked restoration, ignored-file retention, removal of checkpoint-owned later paths, real HEAD and index preservation, symbolic-link storage without target traversal, and per-file plus aggregate size-limit exclusion that leaves an over-limit file untouched by restore. A TUI integration test selects a historical message, chooses conversation-only rewind, flushes the child, and exercises failed host handoff recovery. A keyless terminal snapshot pins the message selector.

## Consequences

Workspace rewind requires the `git` executable and enough local space under `$DSH_HOME`. A workspace over a size limit still checkpoints and stays usable; an unsupported special file, an embedded repository, or a Git failure still blocks a top-level tool until the workspace is fixed or the deployment changes. Restored file state is recoverable through the safety commit even when process handoff later fails.
