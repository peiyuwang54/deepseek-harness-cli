# deepseek-harness-cli — download installers

English | [中文](README.zh.md)

The `install.sh` and `install.ps1` scripts download the `deepseek-harness-cli` application executable and its required ripgrep sidecar from this fork's `deepseek-harness-cli-v*` GitHub Releases, install the application as `deepseek`, `dsh`, and `deepseek-harness-cli` under `$HOME/.deepseek-harness-cli/bin`, then add that directory to your user `PATH`.

Supported targets are macOS (`arm64`, `x64`), Linux (`arm64`, `x64`), and Windows (`x64`). The POSIX script needs `curl`, `tar`, and a sha256 tool (`shasum` on macOS, `sha256sum` on Linux). The Windows script runs on Windows PowerShell 5.1 or PowerShell 7 and uses the system `tar.exe`.

## Install

### macOS and Linux

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
```

After it finishes, restart your shell (or run the printed `export PATH=…` line), then run `deepseek` or `dsh`.

For fish, the installer writes a dedicated file under `${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d` and prints a fish-compatible PATH command. For macOS Bash, it updates `.bashrc` and the first existing login profile (`.bash_profile`, `.bash_login`, or `.profile`), creating `.bash_profile` if none exists.

### Windows

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex"
```

After it finishes, open a new terminal, then run `deepseek` or `dsh`.

## Options

POSIX flags are passed after `--`:

```sh
# Install to a custom directory instead of $HOME/.deepseek-harness-cli
curl -fsSL <install-url> | sh -s -- --to /usr/local

# Pin a specific release (default: newest deepseek-harness-cli-v* release)
curl -fsSL <install-url> | sh -s -- --version 0.1.0-rc.5
```

The PowerShell script accepts named parameters:

```powershell
# Install to a custom directory and pin a release
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallDir C:\Tools\deepseek -Version 0.1.0-rc.11
```

Both scripts accept `DEEPSEEK_HARNESS_CLI_VERSION`, `DEEPSEEK_HARNESS_CLI_INSTALL_DIR`, `DEEPSEEK_HARNESS_CLI_BASE_URL`, and `DEEPSEEK_HARNESS_CLI_RELEASES_URL` for automation, mirrors, and version pinning. The PowerShell installer also accepts `DownloadAttempts`, `DownloadTimeoutSeconds`, and `DownloadRetryDelaySeconds`, or the corresponding `DEEPSEEK_HARNESS_CLI_DOWNLOAD_*` environment variables. Defaults are three attempts, 300 seconds per request, and two seconds between attempts.

## Download recovery

The PowerShell installer applies the timeout and retry policy to release discovery, the tarball, and its checksum sidecar. It deletes an incomplete temporary file before retrying and reports the failing URL after the final attempt. A failed download or checksum check does not replace an existing installation.

## Integrity

The installer verifies the tarball against the `deepseek-harness-cli-<arch>-<os>.sha256` sidecar published with the same release and aborts on mismatch without touching an already-installed binary. This detects corruption; replacing both files can bypass it.

The release workflow signs GitHub build provenance for each tarball. To verify a downloaded tarball before installation, use GitHub CLI and require this repository's release workflow identity:

```sh
gh attestation verify deepseek-harness-cli-x64-linux.tar.gz \
  --repo peiyuwang54/deepseek-harness-cli \
  --signer-workflow peiyuwang54/deepseek-harness-cli/.github/workflows/deepseek-harness-cli-release.yml
```

This explicit verification requires an attestation produced by the release workflow; older releases without one fail verification. The installers and Homebrew cask automatically check checksums only. npm publications also request provenance; switching registry authentication to Trusted Publishing requires the package owner to configure the npm trusted publisher first.

## Development

Tests are keyless and mock the release server over localhost:

```sh
python3 apps/cli/install/tests/test_install_sh.py
pnpm exec vitest run scripts/dsh-cli-install-ps1.spec.ts
```
