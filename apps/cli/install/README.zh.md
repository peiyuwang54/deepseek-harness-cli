# deepseek-harness-cli installer

[English](README.md) | 中文

仓库为 macOS／Linux 与 Windows 提供下载 installer。两者都会选择 `deepseek-harness-cli-v*` GitHub Release，未固定版本时也会包含预发布版本；替换前会校验 sha256 伴随文件，并安装无需源码 checkout 的运行时。

支持的目标包括 macOS（`arm64`、`x64`）、Linux（`arm64`、`x64`）与 Windows（`arm64`、`x64`）。POSIX release 是单文件可执行程序；Windows release 是目录运行时，因为 TUI、ConPTY 与原生 addon 需要真实文件系统路径。

## 安装

macOS 或 Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/scripts/install/install.ps1 | iex
```

如果安装后无法立即找到命令，请重启 shell。POSIX installer 会写入 `$HOME/.deepseek-harness-cli/bin`；Windows installer 会写入 `%LOCALAPPDATA%\Programs\dsh`。Windows 会同时安装 `deepseek-harness-cli` 与 `dsh` launcher。Windows package 包含 TUI 与 headless 库，但不包含构建后的 Web frontend。

## 选项

POSIX flag 放在 `sh -s --` 后面。`--to` 可更改安装目录，`--version` 可固定 release：

```sh
curl -fsSL <install-url> | sh -s -- --to /usr/local --version 0.1.0-rc.5
```

对应的环境变量是 `DEEPSEEK_HARNESS_CLI_VERSION`、`DEEPSEEK_HARNESS_CLI_INSTALL_DIR` 与 `DEEPSEEK_HARNESS_CLI_BASE_URL`。base URL 可让镜像或测试服务器替换 `https://github.com/peiyuwang54/deepseek-harness-cli/releases/download`。

由于 `iex` 调用脚本时不传参数，请在管道式 PowerShell 命令前设置这些变量：

```powershell
$env:DEEPSEEK_HARNESS_CLI_VERSION = "0.1.0-rc.5"
$env:DEEPSEEK_HARNESS_CLI_INSTALL_DIR = "D:\Tools\dsh"
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/scripts/install/install.ps1 | iex
```

从文件运行 `install.ps1` 时，`-Version`、`-InstallDir` 与 `-BaseUrl` 提供相同的值。`-SkipPath` 不修改用户 PATH，`-SkipVerify` 只跳过已安装 launcher 的最终 `--version` 冒烟；release 下载始终校验 sha256 与 package manifest。

## 本地 Windows package

开发者可以构建并安装相同的目录布局，而无需下载 release：

```powershell
pnpm run pack:windows-cli
powershell -ExecutionPolicy Bypass -File .\scripts\install\install.ps1 -PackageDir .\dist-windows\dsh
```

打包器必须在目标 Windows 架构上运行，确保 `node.exe` 与原生 addon 匹配。它运行 `build:lib`；如果还需要 Web frontend，请使用仓库常规的 `pnpm run build`。

## 完整性与替换

每个 installer 都从同一 release 下载产物与匹配的 `.sha256`。摘要不匹配时，安装器会在更改已安装运行时前中止。Windows installer 还会根据请求校验 `dsh-install.json` 的 platform、architecture、version、entry 与 default profile，通过同级 staging 目录安装，并在 launcher 校验失败时恢复先前安装。release 产物目前还没有签名；公开密钥与签名基础设施就绪后，计划升级为 minisign 校验。

## 开发

POSIX installer suite 使用 localhost release server。Windows suite 会在原生 Windows 上执行等价下载测试，并覆盖 `-PackageDir`：

```sh
python3 apps/cli/install/tests/test_install_sh.py
pnpm exec vitest run scripts/install/install.windows.spec.ts
```
