# Agent Note: Windows CLI directory package

Status: implemented

[English](2026-08-15-windows-cli-directory-package.md) | 中文

## 问题

本 fork 的 Windows 用户没有安装器 URL。唯一的分发输入是 git checkout，但 `pnpm dsh` 仍是源码运行命令，不会把 `dsh` 写入 PATH。Codex 的 `install.ps1` 会下载 Rust 版 `codex.exe`；本仓库是 Node 插件树，而 Python SDK 的 `pkg --sea` 路径把 Windows 记为非目标，也不包含 TUI。

## 决策

Windows 目录包从这份检出构建，并安装到其他按用户隔离的程序旁边。

[`scripts/pack-windows-cli.ts`](../../../../scripts/pack-windows-cli.ts) 运行 `pnpm run build:lib`，再把 `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` 写入 `dist-windows/dsh`，补回 legacy deploy 漏掉的传递 workspace 包（包括 `@deepseek-ai/cosmokit`），复制宿主 `node.exe`，写出 `dsh.cmd`，并把该目录压缩为 `dist-windows/dsh-win32-<arch>.zip`。打包器必须在 Windows 上运行，使原生 addon 和 `node.exe` 与目标机一致。它不构建 Web 前端。打好的树在安装前必须能成功执行 `node.exe lib/bin.js --version`。

[`scripts/install/install.ps1`](../../../../scripts/install/install.ps1) 是面向用户的入口。它从自身路径解析仓库根目录，在缺少 `node_modules` 时安装 workspace 依赖，调用打包器，用 `robocopy` 经暂存目录把该树复制到 `%LOCALAPPDATA%\Programs\dsh`（因此超过 MAX_PATH 的嵌套 `node_modules` 路径仍能复制），并把该文件夹追加到用户 PATH。它从不下载远程载荷。`DSH_INSTALL_DIR` 可覆盖安装位置。

`dsh.cmd` 在用户未传参数时启动 `tui` profile，并把每一条显式参数转发给 `lib/bin.js`。[`apps/cli/src/args.ts`](../../../../apps/cli/src/args.ts) 仍要求 `--profile` 或随附别名；`pnpm dsh` 保持不变。

[源码运行决策](../simplification/2026-08-10-source-run-without-managed-installer.md) 仍拥有检出内的执行路径。此包不创建受管理的 `current` 符号链接、staging worktree 或源码安装器。

## 测试

`scripts/windows-cli-package.spec.ts` 固定启动器文本、manifest 字段、zip 名称和目标路径安全性。`scripts/pack-windows-cli.spec.ts` 覆盖 dry-run 命令行、跳过标志、非 Windows 上的宿主拒绝，以及未知标志的用法说明。`scripts/install/install.windows.spec.ts` 固定“不下载”约定，并在 win32 上把 fixture 树复制到 `-InstallDir`，且不修改 PATH。

## 考虑过的备选方案

**像 Codex 那样，让 `install.ps1` 从 GitHub Release 下载。**否决，因为本 fork 没有 release 资产，也没有公开的安装器宿主。检出本身就是载荷。

**通过 `pkg --sea` 发布单文件 `dsh.exe`。**否决，因为现有 SEA 流水线排除 Windows 和 TUI，而且把 ConPTY 与原生 addon 放进虚拟文件系统是另一项产品。目录树才是 Windows 封装包。

**把 clone 加入 PATH 并启动 `pnpm dsh`。**否决，因为删除或移动检出就会让已安装命令失效，而且源码运行笔记已经拒绝由启动器接管检出。

**只要求 WSL 和 POSIX bash 工具。**否决，因为 Windows 移植已经提供 `pwsh` 和 ACL 沙箱；封装包必须运行这些能力。

**把 `npm i -g @deepseek-ai/dsh` 当作唯一安装路径。**否决作为 Windows 主路径，因为它让尚未安装 Node 的用户没有安装器，而且公开 npm 包并不是本 fork。

## 影响

Windows 用户可以 clone 本仓库，运行 `scripts/install/install.ps1`，然后在新终端中调用 `dsh`。已安装副本独立于这份检出。该包体积较大（包含 `node.exe` 和生产闭包）、未经签名，并且面向 TUI / headless：在此布局中不支持 `dsh web`。之后的公开 URL 可以托管同一份 `install.ps1` 和 zip，而不必改动打好的目录树。
