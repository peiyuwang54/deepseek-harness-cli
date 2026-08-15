# deepseek-harness-cli installers

English | [中文](README.zh.md)

The repository provides download installers for macOS/Linux and Windows. Both select `deepseek-harness-cli-v*` GitHub Releases, include prereleases when no version is pinned, verify a sha256 sidecar before replacement, and install a runtime that does not need a source checkout.

Supported targets are macOS (`arm64`, `x64`), Linux (`arm64`, `x64`), and Windows (`arm64`, `x64`). POSIX releases are single-file executables; Windows releases are directory runtimes because the TUI, ConPTY, and native addons need real filesystem paths.

## Install

macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/scripts/install/install.ps1 | iex
```

Restart the shell after installation if the command is not immediately visible. The POSIX installer writes to `$HOME/.deepseek-harness-cli/bin`; the Windows installer writes to `%LOCALAPPDATA%\Programs\dsh`. Windows installs both `deepseek-harness-cli` and `dsh` launchers. The Windows package includes TUI and headless libraries but not the built Web frontend.

## Options

POSIX flags follow `sh -s --`. `--to` changes the install directory and `--version` pins a release:

```sh
curl -fsSL <install-url> | sh -s -- --to /usr/local --version 0.1.0-rc.5
```

The corresponding environment variables are `DEEPSEEK_HARNESS_CLI_VERSION`, `DEEPSEEK_HARNESS_CLI_INSTALL_DIR`, and `DEEPSEEK_HARNESS_CLI_BASE_URL`. The base URL lets a mirror or test server replace `https://github.com/peiyuwang54/deepseek-harness-cli/releases/download`.

Set those variables before the piped PowerShell command because `iex` invokes the script without arguments:

```powershell
$env:DEEPSEEK_HARNESS_CLI_VERSION = "0.1.0-rc.5"
$env:DEEPSEEK_HARNESS_CLI_INSTALL_DIR = "D:\Tools\dsh"
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/scripts/install/install.ps1 | iex
```

When running `install.ps1` from a file, `-Version`, `-InstallDir`, and `-BaseUrl` provide the same values. `-SkipPath` leaves the user PATH unchanged, and `-SkipVerify` skips only the installed launcher's final `--version` smoke; release downloads always verify sha256 and the package manifest.

## Local Windows package

Developers can build and install the same directory layout without downloading a release:

```powershell
pnpm run pack:windows-cli
powershell -ExecutionPolicy Bypass -File .\scripts\install\install.ps1 -PackageDir .\dist-windows\dsh
```

The packer must run on the target Windows architecture so `node.exe` and native addons match. It runs `build:lib`; use the repository's normal `pnpm run build` when a Web frontend is also required.

## Integrity and replacement

Each installer downloads the artifact and matching `.sha256` from the same release. A digest mismatch aborts before the installed runtime changes. The Windows installer also verifies `dsh-install.json` against the requested platform, architecture, version, entry, and default profile; installs through a sibling staging directory; and restores the previous installation if launcher verification fails. Release artifacts are not signed yet. Minisign verification is the planned upgrade after public keys and signing infrastructure are available.

## Development

The POSIX installer suite uses a localhost release server. The Windows suite performs the equivalent download test on native Windows and also covers `-PackageDir`:

```sh
python3 apps/cli/install/tests/test_install_sh.py
pnpm exec vitest run scripts/install/install.windows.spec.ts
```
