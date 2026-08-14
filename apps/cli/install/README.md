# deepseek-harness-cli — curl installer

English | [中文](README.zh.md)

The `install.sh` script downloads the single-file `deepseek-harness-cli`
executable from the `deepseek-harness-cli-v*` GitHub Releases of this fork and
installs it under `$HOME/.deepseek-harness-cli/bin`, then adds that directory to
your shell `PATH`.

Supported targets: macOS (`arm64`, `x64`) and Linux (`arm64`, `x64`). The script
runs on plain POSIX `sh`; it needs only `curl`, `tar`, and a sha256 tool
(`shasum` on macOS, `sha256sum` on Linux).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
```

After it finishes, restart your shell (or run the `export PATH=…` line it prints)
so the `deepseek-harness-cli` binary is on your `PATH`.

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
