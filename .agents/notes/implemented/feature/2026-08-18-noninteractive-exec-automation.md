# Agent Note: non-interactive exec automation

Status: implemented

English | [中文](2026-08-18-noninteractive-exec-automation.zh.md)

## Problem

The headless profile returned only final assistant text from a fresh persisted Session. Scripts could not consume lifecycle events, require schema-valid data, attach images, save a result independently of stdout, continue prior work, or choose an unattended permission preset. Automation therefore needed custom profile code for capabilities already present in the Agent, Session, attachment, permission, and structured-output services.

## Decision

`deepseek exec` is the product alias for the shipped headless profile; `dsh --profile headless` remains compatible. Both parse the same app-owned grammar. A task is required for fresh and resumed invocations.

Text mode writes the final result and one newline to stdout. `--json` instead writes JSONL using top-level `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.started`, `item.updated`, `item.completed`, and `error` records. The projection exposes assistant text and reasoning, generic tool lifecycle, todo state, and accumulated token usage without publishing raw provider chunks or making every Session event part of the automation protocol.

`--output-schema <file>` validates an object-rooted JSON Schema through the existing `dsh-tools` subset and installs the shared scoped structured-output runtime during unpublished Agent setup. A schema-valid committed capture replaces plain assistant text as the result. Completion without a capture fails. `--output-last-message <file>` writes the selected result without adding a newline.

Repeatable `--image <file>` reads PNG, JPEG, WebP, and GIF inputs, admits them through the attachment service as one ordered batch, and appends durable image references beside task text. `resume <session-id>` uses the existing Agent resume path. `resume --last` selects the newest persisted header in the current working directory; `--all` removes that directory filter. `--ephemeral` marks only fresh Sessions and conflicts with resume.

`--full-auto`, `--yolo`, and `--dangerously-bypass-approvals-and-sandbox` resolve the same configured permission presets as the terminal front door and apply them during unpublished setup. `--full-auto` and unrestricted mode are mutually exclusive.

OpenAI Codex commit [`f5e9d66`](https://github.com/openai/codex/tree/f5e9d66851a20311b8385204686990c6c5960014/codex-rs/exec) was inspected for its user-facing exec command organization and lifecycle naming. DeepSeek Harness implements the behavior over its own durable Session events and Cordis services; no source expression is copied.

## Verification

Command tests pin direct alias routing, option parsing before and after `resume`, help, missing tasks, and contradictory options. Runner tests use the real Session, tool, system-prompt, and Agent registries to pin JSONL and usage projection, structured capture, image order, output files, ephemeral metadata, explicit and newest-session resume, permission selection, flush ordering, and failure framing. The assembled headless snapshot and built-bin smoke remain the keyless product paths.

## Alternatives considered

**Keep automation in custom profiles.** Rejected because every caller would need to reconstruct the same lifecycle, persistence, attachment, and structured-output behavior, while the shipped headless entry already owns one-task process execution.

**Restore the removed `dsh-cli-demo` package.** Rejected because it would recreate a second application owner and a second composition. The existing headless bundle can own the automation protocol without another binary or package.

**Emit raw Session events.** Rejected because internal event growth would become a public CLI compatibility promise and would expose provider-specific chunks. The smaller lifecycle projection keeps durable internals independent from the automation protocol.

**Treat plain assistant JSON as structured output.** Rejected because parsing text cannot prove the model followed the Schema and bypasses the existing authoritative tool-result commit semantics.

## Consequences

Scripts gain a single supported command for fresh and resumed work, human-readable output, machine-readable lifecycle events, images, and structured results. The headless bundle now depends on the preset, persistence, attachment, permission, tool, and structured-runtime services already composed by the shipped base.

JSONL lifecycle categories are public behavior and require focused compatibility tests when their fields change. One invocation still submits one task; multi-turn automation starts another process with `exec resume`, while interactive work remains in the terminal UI.
