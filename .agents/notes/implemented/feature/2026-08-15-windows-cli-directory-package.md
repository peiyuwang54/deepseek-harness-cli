# Agent Note: Windows CLI directory package

Status: implemented

English | [中文](2026-08-15-windows-cli-directory-package.zh.md)

## Problem

Windows users of this fork have no installer URL. The only distribution input is a git checkout, but `pnpm dsh` stays a source-run command and does not put `dsh` on PATH. Codex's `install.ps1` downloads a Rust `codex.exe`; this repository is a Node plugin tree, and the Python SDK `pkg --sea` route documents Windows as a non-goal and does not include the TUI.

## Decision

A Windows directory package is built from the checkout and installed beside other per-user programs.

[`scripts/pack-windows-cli.ts`](../../../../scripts/pack-windows-cli.ts) runs `pnpm run build:lib`, then `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` into `dist-windows/dsh`, restores transitive workspace packages that legacy deploy omitted (including `@deepseek-ai/cosmokit`), copies the host `node.exe`, writes `dsh.cmd`, and zips the tree as `dist-windows/dsh-win32-<arch>.zip`. The packer must run on Windows so native addons and `node.exe` match the target. It does not build the Web frontend. A packed `node.exe lib/bin.js --version` must succeed before the tree is installed.

[`scripts/install/install.ps1`](../../../../scripts/install/install.ps1) is the user-facing entry. It resolves the repository root from its own path, installs workspace dependencies when `node_modules` is missing, invokes the packer, copies the tree to `%LOCALAPPDATA%\Programs\dsh` through a staging directory with `robocopy` (so nested `node_modules` paths longer than MAX_PATH still copy), and appends that folder to the user PATH. It never downloads a remote payload. `DSH_INSTALL_DIR` overrides the destination.

`dsh.cmd` boots the `tui` profile when the user passes no arguments and forwards every explicit argument to `lib/bin.js`. [`apps/cli/src/args.ts`](../../../../apps/cli/src/args.ts) still requires `--profile` or a shipped alias; `pnpm dsh` is unchanged.

The [source-run decision](../simplification/2026-08-10-source-run-without-managed-installer.md) still owns checkout execution. This package does not create a managed `current` symlink, staging worktree, or source installer.

## Testing

`scripts/windows-cli-package.spec.ts` pins launcher text, manifest fields, zip names, and destination safety. `scripts/pack-windows-cli.spec.ts` covers dry-run command lines, skip flags, host refusal off Windows, and unknown-flag usage. `scripts/install/install.windows.spec.ts` pins the no-download contract and, on win32, copies a fixture tree into `-InstallDir` without mutating PATH.

## Alternatives considered

**Download a GitHub Release from `install.ps1`, as Codex does.** The download installer is now [`apps/cli/install/install.ps1`](../../../../apps/cli/install/install.ps1), owned by [the Windows exe release note](2026-08-15-windows-cli-exe-release.md). This directory packer remains the source-tree path when no release exists or the user wants the `node.exe` plus closure layout.

**Ship a single-file `dsh.exe` through `pkg --sea`.** Rejected because the existing SEA pipeline excludes Windows and the TUI, and ConPTY plus native addons inside a virtual filesystem is a separate product. The directory tree is the Windows package.

**Add the clone to PATH and launch `pnpm dsh`.** Rejected because deleting or moving the checkout would break the installed command, and the source-run note already refuses a launcher that owns the checkout.

**Require WSL and the POSIX bash tool.** Rejected because the Windows port already ships `pwsh` and ACL sandboxing; the package must run those.

**Make `npm i -g @deepseek-ai/dsh` the only install path.** Rejected as the primary Windows path because it leaves users who do not already have Node without an installer, and the public npm package is not this fork.

## Consequences

A Windows user can clone this repository, run `scripts/install/install.ps1`, and then invoke `dsh` from a new terminal. The installed copy is independent of the checkout. The package is large (it includes `node.exe` and the production closure), unsigned, and TUI/headless-oriented: `dsh web` is unsupported in this layout. A later public URL can host the same `install.ps1` plus zip without changing the packed tree.
