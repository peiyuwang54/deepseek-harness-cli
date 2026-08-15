# deepseek-harness-cli — curl and PowerShell installers

English | [中文](README.zh.md)

The `install.sh` and `install.ps1` scripts download the single-file `deepseek-harness-cli` executable from this fork's `deepseek-harness-cli-v*` GitHub Releases, install it under `$HOME/.deepseek-harness-cli/bin`, then add that directory to `PATH`.

Supported targets: macOS (`arm64`, `x64`), Linux (`arm64`, `x64`), and Windows (`x64`). `install.sh` runs on plain POSIX `sh` and needs `curl`, `tar`, and a sha256 tool (`shasum` on macOS, `sha256sum` on Linux). `install.ps1` runs in Windows PowerShell, verifies with `Get-FileHash`, and writes `dsh.cmd` plus `deepseek.cmd`.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex
```

After it finishes, restart your shell (or run the printed `export PATH=…` line), then run `deepseek`.

### Options

Flags are passed after `--`:

```sh
# Install to a custom directory instead of $HOME/.deepseek-harness-cli
curl -fsSL <install-url> | sh -s -- --to /usr/local

# Pin a specific release (default: newest deepseek-harness-cli-v* release)
curl -fsSL <install-url> | sh -s -- --version 0.1.0-rc.5
```

The same values are available as environment variables for scripting:
`DEEPSEEK_HARNESS_CLI_VERSION`, `DEEPSEEK_HARNESS_CLI_INSTALL_DIR`, and
`DEEPSEEK_HARNESS_CLI_BASE_URL` (the latter lets mirrors or tests point the
installer at a different download base).

## Integrity

The installer verifies the tarball against the
`deepseek-harness-cli-<arch>-<os>.sha256` sidecar published with the same
release and aborts on mismatch without touching an already-installed binary.
Signature verification (minisign) is the planned upgrade path: once public keys
are published, the download step will additionally verify
`deepseek-harness-cli-<arch>-<os>.tar.gz.minisig` before installing.

## Development

Tests are keyless and mock the release server over localhost:

```sh
python3 apps/cli/install/tests/test_install_sh.py
```
