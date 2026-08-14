# dsh — curl installer

The `install.sh` script downloads the single-file `dsh` executable from the
`dsh-cli-v*` GitHub Releases of this fork and installs it under `$HOME/.dsh/bin`,
then adds that directory to your shell `PATH`.

Supported targets: macOS (`arm64`, `x64`) and Linux (`arm64`, `x64`). The script
runs on plain POSIX `sh`; it needs only `curl`, `tar`, and a sha256 tool
(`shasum` on macOS, `sha256sum` on Linux).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-web-to-cli/master/apps/cli/install/install.sh | sh
```

After it finishes, restart your shell (or run the `export PATH=…` line it prints)
so the `dsh` binary is on your `PATH`.

### Options

Flags are passed after `--`:

```sh
# Install to a custom directory instead of $HOME/.dsh
curl -fsSL <install-url> | sh -s -- --to /usr/local

# Pin a specific release (default: newest dsh-cli-v* release)
curl -fsSL <install-url> | sh -s -- --version 0.1.0-rc.5
```

The same values are available as environment variables for scripting:
`DSH_VERSION`, `DSH_INSTALL_DIR`, and `DSH_BASE_URL` (the latter lets mirrors or
tests point the installer at a different download base).

## Integrity

The installer verifies the tarball against the `dsh-<arch>-<os>.sha256` sidecar
published with the same release and aborts on mismatch without touching an
already-installed binary. Signature verification (minisign) is the planned
upgrade path: once public keys are published, the download step will additionally
verify `dsh-<arch>-<os>.tar.gz.minisig` before installing.

## Development

Tests are keyless and mock the release server over localhost:

```sh
python3 apps/cli/install/tests/test_install_sh.py
```
