# Agent Note: deepseek-harness-cli distribution (curl|sh, npm, and Homebrew)

Status: implemented

English | [中文](2026-08-15-dsh-cli-exe-distribution.zh.md)

## Problem

The `deepseek-harness-cli` product (`apps/cli`, `@deepseek-ai/dsh`) had no installable artifact: the only way to run it was a source checkout and `pnpm dsh …`. This fork wants the same one-line install experience as OpenAI Codex on macOS and Linux, over three channels — a curl|sh installer, an npm global install, and a Homebrew cask — so an end user never builds from source.

The Python SDK already shipped a single-file executable built by `@yao-pkg/pkg`'s `--sea` mode, but that pipeline was a bespoke 532-line script owned by the Python distribution, and the CLI had no deploy root, no closure gate, and no release workflow. Reusing the executable pipeline for the CLI meant extracting it first.

## Decision

The `deepseek-harness-cli` ships as a single-file executable per platform, built by the same `--sea` pipeline as the Python runtime, and distributed through three channels. A release workflow builds the five targets, assembles every channel's artifact from the same bytes, and publishes them together.

### The shared exe pipeline

`scripts/build-exe-for-python-sdk.ts` was split into a shared pipeline and thin product definitions:

- [`scripts/exe-build/config.ts`](../../../../scripts/exe-build/config.ts) — the `ExeProduct` / `BuildCli` product contract, `DEFAULT_NODE_RANGE = 'node24'`, and the `dist-exe` output directory.
- [`scripts/exe-build/pipeline.ts`](../../../../scripts/exe-build/pipeline.ts) — the `ExeBuild` pipeline: `--targets` parsing, the per-target `pkg --sea` invocation, `ASSET_GLOBS`, `prepareNativePty`, and the macOS `-spawn-helper` packaging.
- [`scripts/build-exe-for-python-sdk.ts`](../../../../scripts/build-exe-for-python-sdk.ts) and [`scripts/build-dsh-cli-exe.ts`](../../../../scripts/build-dsh-cli-exe.ts) — products: the Python SDK runtime and the `deepseek-harness-cli` (`deployFilter: '@deepseek-ai/dsh'`, `entryBin: 'node_modules/@deepseek-ai/dsh/lib/bin.js'`, `outputBasename: 'deepseek-harness-cli'`). Behavior of the Python build is unchanged.

The pipeline resolves pnpm through its `.cmd` shim on Windows. Node does not execute command shims directly there, so the subprocess runner enables the host shell only for `.cmd`; every command and argument comes from fixed product configuration or validated target enums.

### The closure gate verifies both deploy roots

[`scripts/verify-runtime-closure.ts`](../../../../scripts/verify-runtime-closure.ts) now accepts a repeatable `--manifest` and verifies every listed deploy root; errors carry the manifest name. It runs for both [`python/sdk-runtime/package.json`](../../../../python/sdk-runtime/package.json) and the new [`apps/cli/exe/package.json`](../../../../apps/cli/exe/package.json).

The CLI deploy root is `apps/cli/exe` (`deepseek-harness-cli-exe-pkg`, a zero-code, dependency-only pnpm workspace member mirroring the SDK root). Two closure facts had to be handled explicitly:

- **The entry app must be a direct dependency.** The closure fixpoint only adds packages that something depends on; nothing transitively depends on the leaf app, so `@deepseek-ai/dsh` must be listed directly or `lib/bin.js` is missing from the staged closure.
- **`link:` overrides must be direct dependencies too.** The `@deepseek-ai/cosmokit` and `@deepseek-ai/schemastery` workspace overrides are not materialized by `pnpm deploy` when they are transitive; listing them directly (the SDK deploy root precedent) makes `materializeStagedLinks()` convert the symlinks to real copies. Missing cosmokit fails at exe boot with `ERR_MODULE_NOT_FOUND`.

### Channel 1: curl|sh from GitHub Releases

[`apps/cli/install/install.sh`](../../../../apps/cli/install/install.sh) is a POSIX `sh` installer: detects `uname -s`/`-m` (macOS/Linux, arm64/x64; everything else fails loudly), resolves the version (an explicit `--version`/`DEEPSEEK_HARNESS_CLI_VERSION`, else the newest `deepseek-harness-cli-v*` tag from the GitHub API `releases?per_page=100`, which includes prereleases), downloads `deepseek-harness-cli-<arch>-<os>.tar.gz` plus its `.sha256` sidecar from `releases/download/deepseek-harness-cli-v<ver>/`, verifies the digest with `shasum` (macOS) or `sha256sum` (Linux), and installs `bin/deepseek-harness-cli` (plus the macOS `bin/deepseek-harness-cli-spawn-helper`) into `$HOME/.deepseek-harness-cli/bin` (or `--to <dir>`) with `install -m 0755`, idempotently appending the directory to the shell rc. A checksum mismatch deletes the download and exits nonzero; a failed install never leaves a partial binary. [`tests/test_install_sh.py`](../../../../apps/cli/install/tests/test_install_sh.py) exercises it keylessly against a mock release server and mocked `uname`/`shasum`/`sha256sum`. The installer is fetched from the raw `master` URL, so it tracks the branch independently of release tags; the script itself resolves the newest release at run time.

### Channel 2: npm global install

Codex's npm contract, under the fork's scope. The main package `@peiyuwang54/deepseek-harness-cli` (version `X.Y.Z`) is a thin ESM shim with `bin: { 'deepseek-harness-cli': 'bin/deepseek-harness-cli.js' }`; the five per-platform packages publish the same name at `X.Y.Z-<os>-<cpu>` with `os`/`cpu` fields and **no `bin` field** (a `bin` field would collide with the shim's `deepseek-harness-cli` in `node_modules/.bin`). The shim maps `process.platform`/`process.arch` through the pure `platformTarget()` function (`darwin`→`macos`, `linux`; `arm64`, `x64`; anything else errors listing the supported targets), resolves `@peiyuwang54/deepseek-harness-cli-<os>-<cpu>/bin/deepseek-harness-cli` via `createRequire`, spawns it with inherited stdio, forwards SIGINT/SIGTERM/SIGHUP, and exits with the child's code. The main manifest selects the platform packages through `optionalDependencies` aliases (`"@peiyuwang54/deepseek-harness-cli-macos-arm64": "npm:@peiyuwang54/deepseek-harness-cli@<ver>-macos-arm64"`, and the other four), which is the only way npm conditions a dependency on the host `os`/`cpu`. dist-tags: the main package publishes as `next` for a prerelease or `latest` for a stable version; each platform package publishes under its own `macos-arm64` / `macos-x64` / `linux-arm64` / `linux-x64` tag. [`scripts/package-dsh-cli-npm.ts`](../../../../scripts/package-dsh-cli-npm.ts) lays out both package shapes from the built exes; [`scripts/dsh-npm-shim.js`](../../../../scripts/dsh-npm-shim.js) is the shipped shim. The keyless spec packs the main and host-platform packages, extracts them into a fake global install, and asserts the shim reproduces the host exe's `--version` output.

### Channel 3: Homebrew cask

[`scripts/gen-dsh-cask.ts`](../../../../scripts/gen-dsh-cask.ts) renders the `deepseek-harness-cli` cask from the release version and the four tarball sha256 sidecars. Because the four tarballs have distinct digests, the cask nests `on_macos`/`on_linux` with `on_arm`/`on_intel` sha256 blocks, builds the per-platform URL from Homebrew's `arch`/`os` macros, exposes the executable as `deepseek-harness-cli`, `deepseek`, and `dsh`, and adds a `livecheck` matching `deepseek-harness-cli-v(\d+\.\d+\.\d+(?:-rc\.\d+)?)` tags. CI pushes the generated `Casks/d/deepseek-harness-cli.rb` to the `peiyuwang54/homebrew-dsh` tap, so `brew install peiyuwang54/dsh/deepseek-harness-cli` resolves the cask.

### The release workflow

[`.github/workflows/deepseek-harness-cli-release.yml`](../../../../.github/workflows/deepseek-harness-cli-release.yml) builds and publishes all three channels in one run, triggered by a `deepseek-harness-cli-v*` tag push or a manual dispatch whose optional `version` input overrides the tag or `apps/cli/package.json`:

- **plan** resolves the version and computes the five-target matrix (`node24-linux-x64`→ubuntu-latest, `node24-linux-arm64`→ubuntu-24.04-arm, `node24-macos-arm64`→macos-15, `node24-macos-x64`→macos-15-intel, `node24-win-x64`→windows-2025).
- **build** runs per target: immutable install, the node-pty manylinux 2.28 rebuild on Linux, `scripts/build-dsh-cli-exe.ts --targets=<target>`, a GLIBC ≤ 2.28 check on Linux, the macOS deployment-target check, a `--version` smoke equal to the release version, and artifact upload. The manylinux container mounts the pnpm action directory at its absolute `$RUNNER_TEMP/setup-pnpm` path because node-gyp records that path in the generated Makefile. The macOS check accepts both `LC_BUILD_VERSION` and the legacy `LC_VERSION_MIN_MACOSX` load command emitted by Apple's toolchain across architectures.
- **package** builds the five release tarballs plus `.sha256` sidecars, runs the npm layout, generates the cask, and uploads all three groups.
- **release** creates or refreshes the GitHub release with `GITHUB_TOKEN` + `contents: write`.
- **npm-publish** (`environment: npm-publish`, `NPM_TOKEN`) publishes the main and platform packages; its `Release-publish` concurrency group is shared with the npm release workflow because dist-tags are shared registry state.
- **brew-tap** clones the tap with `HOMEBREW_TAP_TOKEN`, replaces `Casks/d/deepseek-harness-cli.rb`, and pushes only when the file changed.

Top-level concurrency keys on `github.ref` with `cancel-in-progress: false`, so a rerun on the same ref queues rather than cancels; `DSH_TELEMETRY_DISABLED=1` keeps CI runs out of production telemetry.

### Integrity: sha256 now, minisign next

Every release publishes a sha256 sidecar per tarball, and both the installer and the cask verify it. Signature verification via minisign is the documented upgrade path in [`apps/cli/install/README.md`](../../../../apps/cli/install/README.md); with no external consumers, sha256 over HTTPS is proportionate for the pre-release period.

## Alternatives considered

**Install the exe as the main npm package's own bin.** Rejected because one npm package cannot cleanly carry four platform binaries, and a single package would install all four. The Codex split — a shim main package with `os`/`cpu`-gated `optionalDependencies` aliases — is the working contract, keeps the global install to the one matching binary, and avoids a `.bin/deepseek-harness-cli` collision.

**Platform packages with a `bin` field.** Rejected because npm would link `deepseek-harness-cli` from every installed platform package into the shared `node_modules/.bin`, colliding with the shim's `deepseek-harness-cli`. The platform packages carry only `files: ['bin']`; the shim resolves the executable by package path.

**Resolve the newest release through GitHub's `releases/latest`.** Rejected because that endpoint excludes prereleases, and this repo's releases are prereleases for now. The installer queries `releases?per_page=100` and takes the newest `deepseek-harness-cli-v*` tag, so `--rc` releases resolve without a pinned version.

**Publish the cask as a Homebrew formula.** Rejected because a formula builds from source; the distributed artifact is a self-contained binary with no build step, which is exactly a cask's contract.

**Ship minisign signatures from day one.** Rejected for the pre-release stance: no external consumers, sha256 + HTTPS is proportionate, and key management plus a signing pipeline is real work best introduced as the documented upgrade path.

**Windows targets as a non-goal of this note.** The Unix three-channel contract stays here. [`win-x64` release and `install.ps1`](2026-08-15-windows-cli-exe-release.md) own the Windows executable, the fifth release matrix entry, and the PowerShell download installer.

## Consequences

**Bought**: three one-line installs from one release; one shared executable pipeline serving the Python SDK and the CLI, so a single build path is maintained; a closed CLI closure whose plugin set is a dependency manifest; keyless local verification of every distribution artifact (installer, npm shim, cask) against the host build.

**Paid**: each platform artifact is on the order of 200 MB (the embedded Node runtime and the source closure); every release runs a five-target build plus three publication surfaces and needs the `NPM_TOKEN`, `HOMEBREW_TAP_TOKEN`, and `npm-publish` environment configured on the fork; the branch-pinned installer URL means the installer on `master` is fetched before a release tag exists (harmless for a script that resolves the version at run time, but a new channel; `releases/latest/download/install.sh` cannot serve prereleases); integrity is sha256-only until minisign lands; the fork owns a new npm scope and a tap repository as external infrastructure.
