# Agent Note: Profile plugin lifecycle management

Status: implemented

English | [中文](2026-08-18-plugin-lifecycle-management.zh.md)

## Problem

The profile plugin command could install and update packages through pnpm and inspect them, but it had no first-class way to show a package's origin or toggle a Cordis bundle without editing `package.json` by hand.

## Decision

`deepseek plugin --profile <name>` keeps pnpm as the dependency resolver and adds boot-free `source`, `enable`, and `disable` operations. `install` is an explicit alias for pnpm `add`. Enablement changes only `dsh.profile.bundles`; dependency files and the user's real workspace are untouched. Source output reports the resolved package directory plus `repository` or `homepage` when declared.

## Consequences

Plugin installation, provenance, verification, and activation are now separate operations. A disabled package remains installed for quick reactivation, while its patch layer is absent from the next profile composition. Changes take effect after restarting the profile.

## Verification

`pnpm exec vitest run apps/cli/tests/plugin-inspection.spec.ts packages/ui/tui/tests/plugins-command.spec.ts`, `pnpm exec tsc -p apps/cli/tsconfig.json --noEmit`, and the bilingual documentation pairing gate pass.
