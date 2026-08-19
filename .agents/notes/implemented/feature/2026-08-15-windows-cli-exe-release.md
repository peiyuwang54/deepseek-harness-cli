# Agent Note: Windows win-x64 CLI executable release

Status: implemented

English | [中文](2026-08-15-windows-cli-exe-release.zh.md)

## Problem

This fork's users are on Windows. The [directory package](2026-08-15-windows-cli-directory-package.md) still requires a git checkout, `pnpm`, and a host `node.exe`. The [single-file distribution](2026-08-15-dsh-cli-exe-distribution.md) treated Windows as a non-goal, so `install.sh`, the npm shim, and the release matrix all refused `win32`. There was no `irm | iex` path and no `node24-win-x64` GitHub Release asset.

## Decision

`win-x64` is a first-class `deepseek-harness-cli` executable target. It is built on `windows-2025` (native addons are not cross-compiled), published beside the four Unix tarballs, and installed by a PowerShell download script.

[`scripts/exe-build/config.ts`](../../../../scripts/exe-build/config.ts) accepts the pkg tag `win`. `Target.host()` maps `win32` to `win`. `productFileName()` writes `deepseek-harness-cli-win-x64.exe` so Linux and Windows hosts agree on `--output`. [`scripts/package-dsh-cli-npm.ts`](../../../../scripts/package-dsh-cli-npm.ts) adds `@peiyu_wang/deepseek-harness-cli-win-x64` with npm `os: ['win32']` and copies `bin/deepseek-harness-cli.exe`. [`scripts/dsh-npm-shim.js`](../../../../scripts/dsh-npm-shim.js) resolves that basename on `win32`.

Release tarball names stay `<cpu>-<os>` so they match [`apps/cli/install/install.sh`](../../../../apps/cli/install/install.sh): `deepseek-harness-cli-x64-win.tar.gz`. [`scripts/gen-dsh-cask.ts`](../../../../scripts/gen-dsh-cask.ts) reads the same `cpu-os` sidecars; Homebrew still covers only macOS and Linux.

[`apps/cli/install/install.ps1`](../../../../apps/cli/install/install.ps1) downloads that tarball, verifies sha256, installs into `$HOME/.deepseek-harness-cli/bin`, writes `dsh.cmd` and `deepseek.cmd`, and appends the directory to the user PATH. Every metadata and asset request has a bounded timeout and retry count; an incomplete temporary file is removed before retry, and no download or checksum failure replaces the installed executable. Parameters and environment variables configure the attempt count, per-request timeout, and retry delay. The installer never clones the repository. The [directory packer](2026-08-15-windows-cli-directory-package.md) remains the source-tree path.

win-arm64 is unpublished. Authenticode signing is unpublished.

## Testing

`scripts/exe-build/config.spec.ts` parses `node24-win-x64` and the `.exe` filename. `scripts/package-dsh-cli-npm.spec.ts` maps `win32`/`x64` and layouts a fake Windows package. `scripts/dsh-cli-install-ps1.spec.ts` pins the URL, hash check, no-clone rule, and bounded policy, then runs the PowerShell installer against a local Atom feed and a tarball endpoint that returns two transient failures before succeeding; a second case exhausts the retry budget and preserves an installed executable. Built-package verification installs the generated tarball twice under a Unicode path with spaces, compares the built and installed hashes, runs all three command names, requires a healthy `doctor --json` asset result, serves the Web profile, and completes a headless turn through the real adapter against the keyless mock server. `scripts/ci-workflow.spec.ts` pins `node24-win-x64 windows-2025` on the CLI release plan job.

## Alternatives considered

**Keep Windows as a non-goal and tell users to clone.** Rejected because this fork's primary users are on Windows and the directory packer is a multi-minute source build.

**Cross-compile `node24-win-x64` on Linux.** Rejected because node-pty and other native addons must match the Windows kernel; the release job runs on `windows-2025`.

**Replace the directory packer with the exe.** Rejected because a checkout still needs a no-release install path, and the directory tree is the layout that includes a host `node.exe` without pkg's virtual filesystem.

**Publish win-arm64 in the same matrix.** Rejected for this change: there is no proven hosted arm64 Windows runner in this fork, and the download installer refuses non-x64 hosts.

**Use PowerShell's built-in web retry parameter.** Rejected because Windows PowerShell 5.1 is supported and does not provide that PowerShell 7 parameter.

**Retry until the network recovers.** Rejected because unattended installation needs a bounded failure time and an actionable final URL.

## Consequences

Windows x64 users can install with `irm …/install.ps1 | iex` or `npm install -g @peiyu_wang/deepseek-harness-cli` once a `deepseek-harness-cli-v*` release exists. The PowerShell installer tolerates short release-service outages, while the default three attempts and 300-second per-request timeout can delay a final failure; deployments may tune both values and the retry delay. Every CLI release spends a Windows hosted runner. The binary is unsigned. Homebrew does not gain a Windows bottle.
