# Agent Note: Windows CLI directory package

Status: implemented

English | [中文](2026-08-15-windows-cli-directory-package.zh.md)

This note owns the portable directory layout and local packer. The [Windows release distribution note](2026-08-15-windows-cli-release-distribution.md) supersedes its checkout-only installer decision.

## Problem

Windows users of this fork have no installer URL. The only distribution input is a git checkout, but `pnpm dsh` stays a source-run command and does not put `dsh` on PATH. Codex's `install.ps1` downloads a Rust `codex.exe`; this repository is a Node plugin tree, and the Python SDK `pkg --sea` route documents Windows as a non-goal and does not include the TUI.

## Decision

A Windows directory package is built from the checkout and installed beside other per-user programs.

[`scripts/pack-windows-cli.ts`](../../../../scripts/pack-windows-cli.ts) runs `pnpm run build:lib`, then `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` into `dist-windows/dsh`, restores transitive workspace packages that legacy deploy omitted (including `@deepseek-ai/cosmokit`), copies the host `node.exe`, writes `dsh.cmd` and `deepseek-harness-cli.cmd`, and zips the tree as `dist-windows/deepseek-harness-cli-<arch>-windows.zip`. The packer must run on Windows so native addons and `node.exe` match the target. It does not build the Web frontend. A packed `node.exe lib/bin.js --version` must succeed before the tree is installed.

[`scripts/install/install.ps1`](../../../../scripts/install/install.ps1) installs this layout from a release download or a local `-PackageDir`; the [release distribution note](2026-08-15-windows-cli-release-distribution.md) owns its network, integrity, replacement, and PATH behavior.

Both cmd launchers boot the `tui` profile when the user passes no arguments and forward every explicit argument to `lib/bin.js`. [`apps/cli/src/args.ts`](../../../../apps/cli/src/args.ts) still requires `--profile` or a shipped alias; `pnpm dsh` is unchanged.

The [source-run decision](../simplification/2026-08-10-source-run-without-managed-installer.md) still owns checkout execution. This package does not create a managed `current` symlink, staging worktree, or source installer.

## Testing

`scripts/windows-cli-package.spec.ts` pins launcher text, manifest fields, release asset names, and destination safety. `scripts/pack-windows-cli.spec.ts` covers dry-run command lines, skip flags, host refusal off Windows, and unknown-flag usage. `scripts/install/install.windows.spec.ts` installs a fixture tree through `-PackageDir`; release download coverage belongs to the follow-up note.

## Alternatives considered

**Ship a single-file `dsh.exe` through `pkg --sea`.** Rejected because the existing SEA pipeline excludes Windows and the TUI, and ConPTY plus native addons inside a virtual filesystem is a separate product. The directory tree is the Windows package.

**Add the clone to PATH and launch `pnpm dsh`.** Rejected because deleting or moving the checkout would break the installed command, and the source-run note already refuses a launcher that owns the checkout.

**Require WSL and the POSIX bash tool.** Rejected because the Windows port already ships `pwsh` and ACL sandboxing; the package must run those.

**Make `npm i -g @deepseek-ai/dsh` the only install path.** Rejected as the primary Windows path because it leaves users who do not already have Node without an installer, and the public npm package is not this fork.

## Consequences

The package is a self-contained Windows runtime independent of its build checkout. It is large (it includes `node.exe` and the production closure), unsigned, and TUI/headless-oriented: `dsh web` is unsupported in this layout. GitHub Release, npm, and remote installation are layered over this same directory tree by the follow-up note.
