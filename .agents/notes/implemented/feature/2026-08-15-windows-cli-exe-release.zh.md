# Agent Note: Windows win-x64 CLI 可执行文件发布

Status: implemented

[English](2026-08-15-windows-cli-exe-release.md) | 中文

## 问题

本 fork 的用户在 Windows 上。[目录包](2026-08-15-windows-cli-directory-package.md)仍要求 git checkout、`pnpm` 和宿主 `node.exe`。[单文件分发](2026-08-15-dsh-cli-exe-distribution.md)把 Windows 记为非目标，因此 `install.sh`、npm shim 与发布矩阵都拒绝 `win32`。没有 `irm | iex` 路径，也没有 `node24-win-x64` 的 GitHub Release 资产。

## 决策

`win-x64` 是一等的 `deepseek-harness-cli` 可执行目标。它在 `windows-2025` 上构建（原生 addon 不做交叉编译），与四个 Unix tarball 一同发布，并由 PowerShell 下载脚本安装。

[`scripts/exe-build/config.ts`](../../../../scripts/exe-build/config.ts) 接受 pkg 标签 `win`。`Target.host()` 把 `win32` 映射为 `win`。`productFileName()` 写出 `deepseek-harness-cli-win-x64.exe`，使 Linux 与 Windows 宿主对 `--output` 一致。[`scripts/package-dsh-cli-npm.ts`](../../../../scripts/package-dsh-cli-npm.ts) 增加 `@peiyu_wang/deepseek-harness-cli-win-x64`，npm `os` 为 `['win32']`，并复制 `bin/deepseek-harness-cli.exe`。[`scripts/dsh-npm-shim.js`](../../../../scripts/dsh-npm-shim.js) 在 `win32` 上解析该文件名。

发布 tarball 名称保持 `<cpu>-<os>`，以便与 [`apps/cli/install/install.sh`](../../../../apps/cli/install/install.sh) 一致：`deepseek-harness-cli-x64-win.tar.gz`。[`scripts/gen-dsh-cask.ts`](../../../../scripts/gen-dsh-cask.ts) 读取同样的 `cpu-os` sidecar；Homebrew 仍只覆盖 macOS 与 Linux。

[`apps/cli/install/install.ps1`](../../../../apps/cli/install/install.ps1) 下载该 tarball，校验 sha256，安装到 `$HOME/.deepseek-harness-cli/bin`，写出 `dsh.cmd` 与 `deepseek.cmd`，并把该目录追加到用户 PATH。它从不 clone 仓库。[目录打包器](2026-08-15-windows-cli-directory-package.md)仍是源码树路径。

win-arm64 未发布。Authenticode 签名未发布。

## 测试

`scripts/exe-build/config.spec.ts` 解析 `node24-win-x64` 与 `.exe` 文件名。`scripts/package-dsh-cli-npm.spec.ts` 映射 `win32`/`x64` 并布局一份假的 Windows 包。`scripts/dsh-cli-install-ps1.spec.ts` 固定下载 URL、哈希校验与“不 clone”约定。`scripts/ci-workflow.spec.ts` 固定 CLI 发布 plan 任务中的 `node24-win-x64 windows-2025`。

## 考虑过的备选方案

**继续把 Windows 当作非目标，让用户去 clone。**否决，因为本 fork 的主要用户在 Windows 上，而目录打包器是一次耗时数分钟的源码构建。

**在 Linux 上交叉编译 `node24-win-x64`。**否决，因为 node-pty 等原生 addon 必须匹配 Windows 内核；发布任务在 `windows-2025` 上运行。

**用 exe 替换目录打包器。**否决，因为检出在没有 release 时仍需要安装路径，且目录树是包含宿主 `node.exe`、不经过 pkg 虚拟文件系统的布局。

**在同一矩阵中发布 win-arm64。**此次不采用：本 fork 没有已验证的托管 arm64 Windows runner，下载安装器也会拒绝非 x64 主机。

## 影响

一旦存在 `deepseek-harness-cli-v*` release，Windows x64 用户可以用 `irm …/install.ps1 | iex` 或 `npm install -g @peiyu_wang/deepseek-harness-cli` 安装。每次 CLI 发布都会占用一台 Windows 托管 runner。该二进制未经签名。Homebrew 不会获得 Windows bottle。
