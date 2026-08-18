# Agent Note: Explicit startup permission policy

Status: implemented

English | [中文](2026-08-18-explicit-startup-permission-policy.zh.md)

## Problem

The command line exposed named presets through `--full-auto` and `--yolo`, but it could not express an exact sandbox mode and approval policy. Automation therefore had to accept a deployment's preset bundle or modify permission after startup, after Agent publication had already begun.

## Decision

The interactive and headless front doors accept `--sandbox <mode>` and `--ask-for-approval <policy>`. Sandbox modes are `read-only`, `workspace-write`, and `danger-full-access`; approval policies are `ask` and `never`. Either option may be supplied alone. `deepseek exec resume` accepts them before or after the `resume` subcommand, with the subcommand value winning for the same knob.

Exact controls are mutually exclusive with `--full-auto`, `--yolo`, and `--dangerously-bypass-approvals-and-sandbox`. This rejects ambiguous precedence instead of silently replacing one request. Startup applies exact controls during unpublished Agent setup through `PermissionPresetService.setPolicy()`. That method uses the canonical `sandbox/mode` and `approval/policy` setters, writes only effective changes, and does not append `permission/preset`. The projection derives a matching named preset when one exists and otherwise reports `custom`. Because the knobs are Session events, resume retains the selected policy unless a later invocation explicitly changes it.

The surface follows Codex CLI's explicit [`--sandbox` and `--ask-for-approval`](https://github.com/openai/codex/blob/main/codex-rs/cli/src/main.rs) controls while retaining the smaller DeepSeek Harness approval vocabulary and durable Session-log model; no Codex source was copied.

## Alternatives considered

**Generate a temporary preset for every pair.** Rejected because a caller selecting independent knobs did not select a named deployment preset, and recording a synthetic name would make `/permissions` replay misleading.

**Let exact flags override shortcut flags.** Rejected because command-line order would become a hidden precedence rule and the recorded intent would be ambiguous.

**Apply the values after presentation mounts.** Rejected because initial tools and model context could observe the default policy before the requested policy became effective.

## Consequences

Users can start interactive or non-interactive sessions with an exact policy, and the same policy survives resume through canonical events. Focused tests cover parsing, allowed values, shortcut conflicts, parent/resume precedence, unpublished setup ordering, derived preset state, and no-op writes. Bilingual command references list the supported values and conflict rule.
