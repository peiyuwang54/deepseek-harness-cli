# deepseek-harness-cli — 下载安装器

[English](README.md) | 中文

`install.sh` 与 `install.ps1` 脚本从本 fork 的 `deepseek-harness-cli-v*` GitHub Releases 下载 `deepseek-harness-cli` 应用可执行程序及其必需的 ripgrep 伴随文件，以 `deepseek`、`dsh` 和 `deepseek-harness-cli` 三个名称安装应用到 `$HOME/.deepseek-harness-cli/bin`，并把该目录追加进用户 `PATH`。

支持目标为 macOS（`arm64`、`x64`）、Linux（`arm64`、`x64`）与 Windows（`x64`）。POSIX 脚本需要 `curl`、`tar` 与一个 sha256 工具（macOS 用 `shasum`，Linux 用 `sha256sum`）。Windows 脚本运行于 Windows PowerShell 5.1 或 PowerShell 7，并使用系统 `tar.exe`。

## 安装

### macOS 与 Linux

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
```

完成后请重启 shell（或运行它打印的 `export PATH=…` 那一行），然后运行 `deepseek` 或 `dsh`。

### Windows

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex"
```

完成后请打开新终端，然后运行 `deepseek` 或 `dsh`。

## 选项

POSIX flag 通过 `--` 传入：

```sh
# Install to a custom directory instead of $HOME/.deepseek-harness-cli
curl -fsSL <install-url> | sh -s -- --to /usr/local

# Pin a specific release (default: newest deepseek-harness-cli-v* release)
curl -fsSL <install-url> | sh -s -- --version 0.1.0-rc.5
```

PowerShell 脚本接受具名参数：

```powershell
# Install to a custom directory and pin a release
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallDir C:\Tools\deepseek -Version 0.1.0-rc.11
```

两个脚本都接受 `DEEPSEEK_HARNESS_CLI_VERSION`、`DEEPSEEK_HARNESS_CLI_INSTALL_DIR`、`DEEPSEEK_HARNESS_CLI_BASE_URL` 与 `DEEPSEEK_HARNESS_CLI_RELEASES_URL`，用于自动化、镜像和固定版本。PowerShell 安装器还接受 `DownloadAttempts`、`DownloadTimeoutSeconds` 与 `DownloadRetryDelaySeconds`，或对应的 `DEEPSEEK_HARNESS_CLI_DOWNLOAD_*` 环境变量。默认值为尝试三次、每次请求 300 秒，以及每次尝试之间等待两秒。

## 下载恢复

PowerShell 安装器把超时与重试策略用于发现发布版本、下载 tarball 和下载校验和伴随文件。它会在重试前删除未完整下载的临时文件，并在最后一次失败后报告对应 URL。下载或校验失败不会替换已有安装。

## 完整性

安装器用同一发布提供的 `deepseek-harness-cli-<arch>-<os>.sha256` 伴随文件校验 tarball，不匹配即中止，且不触碰已安装的二进制。基于 minisign 的签名校验是计划中的升级路径：一旦公开密钥发布，下载步骤会在安装前额外校验 `deepseek-harness-cli-<arch>-<os>.tar.gz.minisig`。

## 开发

测试无 key，通过 localhost 上的 mock 发布服务器运行：

```sh
python3 apps/cli/install/tests/test_install_sh.py
pnpm exec vitest run scripts/dsh-cli-install-ps1.spec.ts
```
