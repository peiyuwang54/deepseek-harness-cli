# Agent Note：Windows CLI release 分发

Status: implemented

[English](2026-08-15-windows-cli-release-distribution.md) | 中文

## 问题

[Windows 目录包](2026-08-15-windows-cli-directory-package.md)只能从本地检出生成便携运行时。其安装器要求 Node、pnpm、完整仓库与本地构建，而 GitHub Release 和 npm 通道明确排除了 Windows。这并不是可安装的 Windows 产品，也让已发布平台清单与 harness 原生的 `pwsh`、ACL sandbox 和 TUI 支持不一致。

在解决 ConPTY 与原生 addon 从嵌入文件系统加载的问题前，Windows 无法安全复用 POSIX 的 `pkg --sea` 产物。现有目录树已经把 `node.exe`、原生 addon、package asset 与生产依赖闭包保留在真实文件系统上。

## 决策

Windows 继续使用目录运行时作为产物格式，主 CLI release workflow 会为原生 x64 与 ARM64 宿主发布该产物。`build-windows` 矩阵使用 `windows-latest` 和 `windows-11-arm`，运行聚焦的分发测试，构建 `dist-windows/dsh`，执行 `deepseek-harness-cli.cmd --version`，并上传 `deepseek-harness-cli-<arch>-windows.zip` 及其 sha256 伴随文件。package job 会把两个 ZIP 复制到 GitHub Release asset，并为 npm 暂存两棵目录树。

修改 CLI 分发输入的 pull request 会运行同一套原生 Windows 矩阵，但不会进入 package 或发布 job。POSIX 构建、GitHub Release、npm 发布和 Homebrew job 都明确要求事件不是 pull request。因此，封装改动可在合并前获得原生 x64 与 ARM64 证据，同时不会创建 release，也不需要 registry 凭据。

[`scripts/install/install.ps1`](../../../../scripts/install/install.ps1) 是下载优先的安装器。它会解析显式的 `-Version` 或 `DEEPSEEK_HARNESS_CLI_VERSION`，否则选择最新的 `deepseek-harness-cli-v*` release，包括预发布版本。它检测 AMD64 或 ARM64，下载匹配的 ZIP 与 `.sha256`，校验摘要，展开 `dsh` 目录树，并拒绝 platform、architecture、version、entry 或 default profile 与请求不一致的 manifest。`-PackageDir` 无需下载即可安装本地打包的目录树，并继续作为开发／测试入口。

安装过程使用有超时的每用户 lock 与同级 staging 目录。替换前，现有安装会移至 backup；launcher 校验在删除该 backup 前执行，失败时会恢复旧安装。文件系统根目录以及 user profile、LocalAppData 和 AppData 根目录都不能作为安装目标。包内同时提供 `dsh.cmd` 与 `deepseek-harness-cli.cmd`，不带参数调用时会启动 `tui`。

npm 主包现在选择 6 个平台 alias。manifest 的 package 名仍使用 `macos`、`windows` 等分发后缀，但 `os` 字段使用 npm 实际识别的宿主标识 `darwin` 与 `win32`。Windows 平台 package 把目录运行时放在 `bin/` 下；shim 使用随包提供的 `node.exe` 启动 `bin/lib/bin.js`，因此不依赖宿主 Node 安装，也不需要处理 `cmd.exe` quoting。

release workflow 调用已有的 [`scripts/gen-dsh-cask.ts`](../../../../scripts/gen-dsh-cask.ts)。workflow spec 会解析所有引用的 packaging script，并拒绝此前不存在的生成器名称。

本说明取代了 [Windows 目录包说明](2026-08-15-windows-cli-directory-package.md)中的仅限 checkout 安装器决策，以及 [POSIX CLI 分发说明](2026-08-15-dsh-cli-exe-distribution.md)中的 Windows 非目标结论。这两份说明继续分别负责目录布局与 POSIX 单文件通道。

## 测试

Windows package 测试固定两种 launcher 名称、manifest 字段、release asset 名称、目标路径安全规则、npm `os`／`cpu` 映射、完整目录复制、release workflow 的双 runner 依赖图，以及 pull request 无法进入发布 job 的规则。在 Windows 上，installer suite 会覆盖本地 `-PackageDir` 安装，还会通过 localhost 提供动态生成的 ZIP 与伴随文件，从而无凭据验证下载、checksum 校验、展开、安装与最终 launcher 冒烟。

## 考虑过的替代方案

**从 POSIX SEA 流水线发布 `dsh.exe`。**否决，因为这会声称 SEA 路径尚未提供的 ConPTY 与原生 addon 行为。目录运行时已经按 Windows 文件系统语义进行测试。

**只发布 x64。**否决，因为打包器已经支持 ARM64，而且 GitHub 提供原生的 `windows-11-arm` hosted runner。原生构建可避免 `node.exe` 或编译 addon 混用架构。

**保留从源码构建的 PowerShell 安装器。**否决作为公开路径，因为这会把安装变成完整仓库构建，并要求用户准备打包运行时本已包含的 toolchain。`-PackageDir` 保留了有用的本地流程，而不会把它强加给用户。

## 影响

Windows x64 与 ARM64 现在加入 GitHub Release 和 npm 发布，获得一行式 PowerShell 安装器，并采用与 POSIX 安装器相同的版本选择与 sha256 完整性等级。该产物仍比单文件可执行程序大，且没有签名。它包含 TUI 与 headless 运行时，但不包含已构建的 Web frontend，因此在加入并测试该 asset 闭包前，Windows 目录包仍不支持 `web`。
