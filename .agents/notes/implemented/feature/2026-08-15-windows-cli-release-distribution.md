# Agent Note: Windows CLI release distribution

Status: implemented

English | [中文](2026-08-15-windows-cli-release-distribution.zh.md)

## Problem

The [Windows directory package](2026-08-15-windows-cli-directory-package.md) produced a portable runtime only from a local checkout. Its installer required Node, pnpm, the complete repository, and a local build, while the GitHub Release and npm channels explicitly rejected Windows. That was not an installable Windows product and left the published platform list inconsistent with the harness's native `pwsh`, ACL sandbox, and TUI support.

Windows cannot safely reuse the POSIX `pkg --sea` artifact without first solving ConPTY and native-addon loading from the embedded filesystem. The existing directory tree already keeps `node.exe`, native addons, package assets, and the production dependency closure on a real filesystem.

## Decision

The directory runtime remains the Windows artifact format, and the main CLI release workflow publishes it for native x64 and ARM64 hosts. The `build-windows` matrix uses `windows-latest` and `windows-11-arm`, runs the focused distribution tests, builds `dist-windows/dsh`, executes `deepseek-harness-cli.cmd --version`, and uploads `deepseek-harness-cli-<arch>-windows.zip` with its sha256 sidecar. The package job copies both ZIPs into the GitHub Release assets and stages both directory trees for npm.

Pull requests that change the CLI distribution inputs run the same native Windows matrix without entering the package or publication jobs. The POSIX build, GitHub Release, npm publication, and Homebrew jobs explicitly require a non-pull-request event. A packaging change therefore receives native x64 and ARM64 evidence before merge without creating a release or requiring registry credentials.

[`scripts/install/install.ps1`](../../../../scripts/install/install.ps1) is a download-first installer. It resolves an explicit `-Version` or `DEEPSEEK_HARNESS_CLI_VERSION`, otherwise selects the newest `deepseek-harness-cli-v*` release including prereleases. It detects AMD64 or ARM64, downloads the matching ZIP and `.sha256`, verifies the digest, expands the `dsh` tree, and rejects a manifest whose platform, architecture, version, entry, or default profile differs from the request. `-PackageDir` installs a locally packed tree without a download and remains the development/test entry.

Installation uses a bounded per-user lock and a sibling staging directory. An existing installation moves to a backup before replacement; launcher verification runs before that backup is deleted, and failure restores it. Filesystem roots and the user profile, LocalAppData, and AppData roots are invalid install targets. Both `dsh.cmd` and `deepseek-harness-cli.cmd` are present, and a bare invocation starts `tui`.

The npm main package now selects six platform aliases. Its manifests keep distribution suffixes such as `macos` and `windows` in package names but use npm's actual host identifiers, `darwin` and `win32`, in `os`. Windows platform packages carry the directory runtime under `bin/`; the shim starts the bundled `node.exe` with `bin/lib/bin.js`, so it does not depend on a host Node installation or `cmd.exe` quoting.

The release workflow calls the existing [`scripts/gen-dsh-cask.ts`](../../../../scripts/gen-dsh-cask.ts). A workflow spec resolves every referenced packaging script and rejects the former nonexistent generator name.

This note supersedes the checkout-only installer decision in the [Windows directory package note](2026-08-15-windows-cli-directory-package.md) and the Windows non-goal in the [POSIX CLI distribution note](2026-08-15-dsh-cli-exe-distribution.md). Those notes continue to own the directory layout and POSIX single-file channels respectively.

## Testing

The Windows package tests pin both launcher names, manifest fields, release asset names, destination safety, npm `os`/`cpu` mapping, complete directory copying, the release workflow's two-runner dependency graph, and the rule that pull requests cannot reach publication jobs. On Windows, the installer suite covers local `-PackageDir` installation and serves a generated ZIP plus sidecar from localhost to exercise download, checksum verification, expansion, installation, and the final launcher smoke without credentials.

## Alternatives considered

**Publish `dsh.exe` from the POSIX SEA pipeline.** Rejected because it would claim ConPTY and native-addon behavior that the SEA path does not provide. The directory runtime is already tested against Windows filesystem semantics.

**Publish x64 only.** Rejected because the packer already supports ARM64 and GitHub provides a native `windows-11-arm` hosted runner. Native builds avoid mixing architectures in `node.exe` or compiled addons.

**Keep the source-building PowerShell installer.** Rejected as the public path because it turns installation into a full repository build and requires toolchains that the packaged runtime already contains. `-PackageDir` preserves the useful local workflow without imposing it on users.

## Consequences

Windows x64 and ARM64 now participate in GitHub Release and npm publication, with a one-line PowerShell installer and the same version selection and sha256 integrity level as the POSIX installer. The artifact remains larger than a single executable and unsigned. It contains the TUI and headless runtime but not the built Web frontend, so `web` remains unavailable from the Windows directory package until that asset closure is added and tested.
