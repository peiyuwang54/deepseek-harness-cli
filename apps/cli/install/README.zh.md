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

对于 fish，安装器在 `${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d` 下写入专用文件，并打印兼容 fish 的 PATH 命令。对于 macOS Bash，安装器更新 `.bashrc` 和首个已存在的登录配置文件（`.bash_profile`、`.bash_login` 或 `.profile`）；没有这些文件时创建 `.bash_profile`。

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

安装器用同一发布提供的 `deepseek-harness-cli-<arch>-<os>.sha256` 伴随文件校验 tarball，不匹配即中止，且不触碰已安装的二进制。这能检测损坏，但同时替换两个文件可以绕过检查。

发布工作流为每个 tarball 签署 GitHub 构建来源证明。安装前如需验证下载的 tarball，可使用 GitHub CLI 并要求本仓库的发布工作流身份：

```sh
gh attestation verify deepseek-harness-cli-x64-linux.tar.gz \
  --repo peiyuwang54/deepseek-harness-cli \
  --signer-workflow peiyuwang54/deepseek-harness-cli/.github/workflows/deepseek-harness-cli-release.yml
```

显式验证要求存在由发布工作流生成的证明；没有证明的旧发布会验证失败。安装器和 Homebrew cask 只自动检查校验和。npm 发布也会请求来源证明；将 registry 认证切换到 Trusted Publishing，需要包所有者先配置 npm 受信任发布者。

## 开发

测试无 key，通过 localhost 上的 mock 发布服务器运行：

```sh
python3 apps/cli/install/tests/test_install_sh.py
pnpm exec vitest run scripts/dsh-cli-install-ps1.spec.ts
```
