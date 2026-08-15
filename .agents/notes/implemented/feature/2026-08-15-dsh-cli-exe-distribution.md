# Agent Note: deepseek-harness-cli distribution (curl|sh, npm, and Homebrew)

Status: implemented

English | [中文](2026-08-15-dsh-cli-exe-distribution.zh.md)

This note owns the POSIX single-file pipeline and the shared release channels. [Windows release distribution](2026-08-15-windows-cli-release-distribution.md) extends the same release and npm surfaces with directory runtimes.

## Problem

The `deepseek-harness-cli` product (`apps/cli`, `@deepseek-ai/dsh`) had no installable artifact: the only way to run it was a source checkout and `pnpm dsh …`. This fork wants the same one-line install experience as OpenAI Codex on macOS and Linux, over three channels — a curl|sh installer, an npm global install, and a Homebrew cask — so an end user never builds from source.

The Python SDK already shipped a single-file executable built by `@yao-pkg/pkg`'s `--sea` mode, but that pipeline was a bespoke 532-line script owned by the Python distribution, and the CLI had no deploy root, no closure gate, and no release workflow. Reusing the executable pipeline for the CLI meant extracting it first.

## Decision

On macOS and Linux, `deepseek-harness-cli` ships as a single-file executable built by the same `--sea` pipeline as the Python runtime and distributed through three channels. A release workflow builds the four POSIX targets and publishes them with the Windows directory runtimes owned by the follow-up note.

### The shared exe pipeline

`scripts/build-exe-for-python-sdk.ts` was split into a shared pipeline and thin product definitions:

- [`scripts/exe-build/config.ts`](../../../../scripts/exe-build/config.ts) — the `ExeProduct` / `BuildCli` product contract, `DEFAULT_NODE_RANGE = 'node24'`, and the `dist-exe` output directory.
- [`scripts/exe-build/pipeline.ts`](../../../../scripts/exe-build/pipeline.ts) — the `ExeBuild` pipeline: `--targets` parsing, the per-target `pkg --sea` invocation, `ASSET_GLOBS`, `prepareNativePty`, and the macOS `-spawn-helper` packaging.
- [`scripts/build-exe-for-python-sdk.ts`](../../../../scripts/build-exe-for-python-sdk.ts) and [`scripts/build-dsh-cli-exe.ts`](../../../../scripts/build-dsh-cli-exe.ts) — products: the Python SDK runtime and the `deepseek-harness-cli` (`deployFilter: '@deepseek-ai/dsh'`, `entryBin: 'node_modules/@deepseek-ai/dsh/lib/bin.js'`, `outputBasename: 'deepseek-harness-cli'`). Behavior of the Python build is unchanged.

### The closure gate verifies both deploy roots

[`scripts/verify-runtime-closure.ts`](../../../../scripts/verify-runtime-closure.ts) now accepts a repeatable `--manifest` and verifies every listed deploy root; errors carry the manifest name. It runs for both [`python/sdk-runtime/package.json`](../../../../python/sdk-runtime/package.json) and the new [`apps/cli/exe/package.json`](../../../../apps/cli/exe/package.json).

The CLI deploy root is `apps/cli/exe` (`deepseek-harness-cli-exe-pkg`, a zero-code, dependency-only pnpm workspace member mirroring the SDK root). Two closure facts had to be handled explicitly:

- **The entry app must be a direct dependency.** The closure fixpoint only adds packages that something depends on; nothing transitively depends on the leaf app, so `@deepseek-ai/dsh` must be listed directly or `lib/bin.js` is missing from the staged closure.
- **`link:` overrides must be direct dependencies too.** The `@deepseek-ai/cosmokit` and `@deepseek-ai/schemastery` workspace overrides are not materialized by `pnpm deploy` when they are transitive; listing them directly (the SDK deploy root precedent) makes `materializeStagedLinks()` convert the symlinks to real copies. Missing cosmokit fails at exe boot with `ERR_MODULE_NOT_FOUND`.

### Channel 1: curl|sh from GitHub Releases

[`apps/cli/install/install.sh`](../../../../apps/cli/install/install.sh) is a POSIX `sh` installer: detects `uname -s`/`-m` (macOS/Linux, arm64/x64; everything else fails loudly), resolves the version (an explicit `--version`/`DEEPSEEK_HARNESS_CLI_VERSION`, else the newest `deepseek-harness-cli-v*` tag from the GitHub API `releases?per_page=100`, which includes prereleases), downloads `deepseek-harness-cli-<arch>-<os>.tar.gz` plus its `.sha256` sidecar from `releases/download/deepseek-harness-cli-v<ver>/`, verifies the digest with `shasum` (macOS) or `sha256sum` (Linux), and installs `bin/deepseek-harness-cli` (plus the macOS `bin/deepseek-harness-cli-spawn-helper`) into `$HOME/.deepseek-harness-cli/bin` (or `--to <dir>`) with `install -m 0755`, idempotently appending the directory to the shell rc. A checksum mismatch deletes the download and exits nonzero; a failed install never leaves a partial binary. [`tests/test_install_sh.py`](../../../../apps/cli/install/tests/test_install_sh.py) exercises it keylessly against a mock release server and mocked `uname`/`shasum`/`sha256sum`. The installer is fetched from the raw `master` URL, so it tracks the branch independently of release tags; the script itself resolves the newest release at run time.

### Channel 2: npm global install

Codex's npm contract, under the fork's scope. The main package `@peiyuwang54/deepseek-harness-cli` (version `X.Y.Z`) is a thin ESM shim with `bin: { 'deepseek-harness-cli': 'bin/deepseek-harness-cli.js' }`; six per-platform packages publish the same name at `X.Y.Z-<os>-<cpu>` with npm-native `os`/`cpu` fields and **no `bin` field** (a `bin` field would collide with the shim's `deepseek-harness-cli` in `node_modules/.bin`). The main manifest selects those packages through `optionalDependencies` aliases, so npm installs only the matching macOS, Linux, or Windows runtime. POSIX packages carry the executable described here; the [Windows release distribution note](2026-08-15-windows-cli-release-distribution.md) owns the directory package and bundled-Node launch. dist-tags use `macos-arm64`, `macos-x64`, `linux-arm64`, `linux-x64`, `windows-arm64`, and `windows-x64`; the main package publishes as `next` for a prerelease or `latest` for a stable version. [`scripts/package-dsh-cli-npm.ts`](../../../../scripts/package-dsh-cli-npm.ts) lays out the packages; [`scripts/dsh-npm-shim.js`](../../../../scripts/dsh-npm-shim.js) is the shipped shim.

### Channel 3: Homebrew cask

[`scripts/gen-dsh-cask.ts`](../../../../scripts/gen-dsh-cask.ts) renders the `deepseek-harness-cli` cask from the release version and the four tarball sha256 sidecars. Because the four tarballs have distinct digests, the cask nests `on_macos`/`on_linux` with `on_arm`/`on_intel` sha256 blocks, builds the per-platform URL from Homebrew's `arch`/`os` macros, declares `binary "bin/deepseek-harness-cli"`, and adds a `livecheck` matching `deepseek-harness-cli-v(\d+\.\d+\.\d+(?:-rc\.\d+)?)` tags. CI pushes the generated `Casks/d/deepseek-harness-cli.rb` to the `peiyuwang54/homebrew-dsh` tap, so `brew install peiyuwang54/dsh/deepseek-harness-cli` resolves the cask.

### The release workflow

[`.github/workflows/deepseek-harness-cli-release.yml`](../../../../.github/workflows/deepseek-harness-cli-release.yml) builds and publishes all three channels in one run, triggered by a `deepseek-harness-cli-v*` tag push or a manual dispatch. The tag and optional dispatch `version` must match `apps/cli/package.json`, which is the version embedded in every runtime:

- **plan** validates the version and computes the four-target POSIX matrix (`node24-linux-x64`→ubuntu-latest, `node24-linux-arm64`→ubuntu-24.04-arm, `node24-macos-arm64`→macos-15, `node24-macos-x64`→macos-15-intel).
- **build** runs per target: immutable install, the node-pty manylinux 2.28 rebuild on Linux, `scripts/build-dsh-cli-exe.ts --targets=<target>`, a GLIBC ≤ 2.28 check on Linux, the macOS deployment-target check, a `--version` smoke equal to the release version, and artifact upload.
- **build-windows** builds and verifies the x64 and ARM64 directory runtimes described by the Windows follow-up note.
- **package** builds the four POSIX tarballs plus two Windows ZIPs and their `.sha256` sidecars, runs the npm layout, generates the cask, and uploads all three groups.
- **release** creates or refreshes the GitHub release with `GITHUB_TOKEN` + `contents: write`.
- **npm-publish** (`environment: npm-publish`, `NPM_TOKEN`) publishes the main and platform packages; its `Release-publish` concurrency group is shared with the npm release workflow because dist-tags are shared registry state.
- **brew-tap** clones the tap with `HOMEBREW_TAP_TOKEN`, replaces `Casks/d/deepseek-harness-cli.rb`, and pushes only when the file changed.

Top-level concurrency keys on `github.ref` with `cancel-in-progress: false`, so a rerun on the same ref queues rather than cancels; `DSH_TELEMETRY_DISABLED=1` keeps CI runs out of production telemetry.

### Integrity: sha256 now, minisign next

Every release publishes a sha256 sidecar per tarball or ZIP. The POSIX installer and cask verify tarballs, and the Windows installer verifies ZIPs. Signature verification via minisign is the documented upgrade path in [`apps/cli/install/README.md`](../../../../apps/cli/install/README.md); with no external consumers, sha256 over HTTPS is proportionate for the pre-release period.

## Alternatives considered

**Install every runtime as the main npm package's own bin.** Rejected because one npm package cannot cleanly carry six platform runtimes, and a single package would install all six. The Codex split — a shim main package with `os`/`cpu`-gated `optionalDependencies` aliases — keeps the global install to one matching runtime and avoids a `.bin/deepseek-harness-cli` collision.

**Platform packages with a `bin` field.** Rejected because npm would link `deepseek-harness-cli` from every installed platform package into the shared `node_modules/.bin`, colliding with the shim's `deepseek-harness-cli`. The platform packages carry only `files: ['bin']`; the shim resolves the executable by package path.

**Resolve the newest release through GitHub's `releases/latest`.** Rejected because that endpoint excludes prereleases, and this repo's releases are prereleases for now. The installer queries `releases?per_page=100` and takes the newest `deepseek-harness-cli-v*` tag, so `--rc` releases resolve without a pinned version.

**Publish the cask as a Homebrew formula.** Rejected because a formula builds from source; the distributed artifact is a self-contained binary with no build step, which is exactly a cask's contract.

**Ship minisign signatures from day one.** Rejected for the pre-release stance: no external consumers, sha256 + HTTPS is proportionate, and key management plus a signing pipeline is real work best introduced as the documented upgrade path.

**Reuse the SEA pipeline for Windows.** Rejected because the single-exe path does not yet provide the tested ConPTY and native-addon behavior. Windows uses the directory runtime described in the follow-up note.

## Consequences

**Bought**: three publication channels from one release; one shared POSIX executable pipeline serving the Python SDK and the CLI; a closed CLI closure whose plugin set is a dependency manifest; keyless local verification of every distribution artifact against the host build.

**Paid**: each platform artifact is on the order of 200 MB; every release runs four POSIX and two Windows native builds across three publication surfaces and needs the `NPM_TOKEN`, `HOMEBREW_TAP_TOKEN`, and `npm-publish` environment configured on the fork; branch-pinned installer URLs track `master` independently of release tags; integrity is sha256-only until minisign lands; the fork owns a new npm scope and a tap repository as external infrastructure.
