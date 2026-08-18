# Agent Note: Boot-free plugin inventory and validation

Status: implemented

English | [中文](2026-08-18-plugin-inventory-validator.zh.md)

## Problem

Profile plugins are installed through pnpm, but users need a profile-local inventory and a deterministic check that bundle declarations, active layers, and patch files agree.

## Decision

`dsh plugin --profile <name> list` reads the profile manifest and resolved package manifests without starting pnpm. `dsh plugin --profile <name> verify` resolves each active bundle through the same installation-first lookup used by profile boot, parses every declared patch, and reports inactive or stale bundle rows. Both commands support `--json` and never mutate the profile.

## Alternatives considered

- **Use `pnpm list` as the inventory API** — rejected because it adds a package-manager dependency to diagnostics and does not validate the loader patch layer.
- **Let profile boot be the only validator** — rejected because a broken profile would fail before users could inspect which package or layer was invalid.

## Consequences

The inspection commands report package metadata and paths but never install, update, enable, or disable a plugin. A successful `pnpm` mutation still reconciles bundle layers as before; `verify` detects a manually edited manifest or missing patch before a normal profile boot.
