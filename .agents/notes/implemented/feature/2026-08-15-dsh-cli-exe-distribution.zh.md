# Agent Note: deepseek-harness-cli 分发（curl|sh、npm 与 Homebrew）

Status: implemented

[English](2026-08-15-dsh-cli-exe-distribution.md) | 中文

本说明负责 POSIX 单文件流水线与共享 release 通道。[Windows release 分发说明](2026-08-15-windows-cli-release-distribution.md)会用目录运行时扩展同一套 release 与 npm 界面。

## 问题

`deepseek-harness-cli` 产品（`apps/cli`，`@deepseek-ai/dsh`）此前没有任何可安装产物：唯一运行方式是从源码检出后用 `pnpm dsh …`。本 fork 希望在 macOS 与 Linux 上提供与 OpenAI Codex 相同的一行安装体验，覆盖三个通道——curl|sh 安装器、npm 全局安装、Homebrew cask——让终端用户永远不需要从源码构建。

Python SDK 已经通过 `@yao-pkg/pkg` 的 `--sea` 模式发布单文件可执行程序，但那条管线是 Python 分发专属的 532 行定制脚本，CLI 也没有部署根、没有闭包门禁、没有发布 workflow。让 CLI 复用该可执行管线，意味着先把它抽取出来。

## 决策

在 macOS 与 Linux 上，`deepseek-harness-cli` 作为单文件可执行程序分发，与 Python 运行时共用同一条 `--sea` 管线，并通过三个通道发布。一个 release workflow 构建 4 个 POSIX 目标，并与后续说明负责的 Windows 目录运行时一起发布。

### 共享 exe 管线

`scripts/build-exe-for-python-sdk.ts` 被拆分为共享管线与薄产品定义：

- [`scripts/exe-build/config.ts`](../../../../scripts/exe-build/config.ts)——`ExeProduct` / `BuildCli` 产品契约、`DEFAULT_NODE_RANGE = 'node24'` 与 `dist-exe` 输出目录。
- [`scripts/exe-build/pipeline.ts`](../../../../scripts/exe-build/pipeline.ts)——`ExeBuild` 管线：`--targets` 解析、逐目标的 `pkg --sea` 调用、`ASSET_GLOBS`、`prepareNativePty`、macOS `-spawn-helper` 打包。
- [`scripts/build-exe-for-python-sdk.ts`](../../../../scripts/build-exe-for-python-sdk.ts) 与 [`scripts/build-dsh-cli-exe.ts`](../../../../scripts/build-dsh-cli-exe.ts)——产品：Python SDK 运行时与 `deepseek-harness-cli`（`deployFilter: '@deepseek-ai/dsh'`、`entryBin: 'node_modules/@deepseek-ai/dsh/lib/bin.js'`、`outputBasename: 'deepseek-harness-cli'`）。Python 构建的行为不变。

### 闭包门禁校验两个部署根

[`scripts/verify-runtime-closure.ts`](../../../../scripts/verify-runtime-closure.ts) 现在接受可重复的 `--manifest`，逐一校验列出的每个部署根；错误信息携带 manifest 名。它同时作用于 [`python/sdk-runtime/package.json`](../../../../python/sdk-runtime/package.json) 与新的 [`apps/cli/exe/package.json`](../../../../apps/cli/exe/package.json)。

CLI 部署根是 `apps/cli/exe`（`deepseek-harness-cli-exe-pkg`，镜像 SDK 根的零代码纯依赖 pnpm 工作区成员）。两个闭包事实需要显式处理：

- **入口应用必须是直接依赖。** 闭包不动点只添加被某处依赖的包；没有东西传递依赖这个叶子应用，所以必须直接把 `@deepseek-ai/dsh` 列为依赖，否则 `lib/bin.js` 会从暂存闭包中缺失。
- **`link:` 覆盖也必须是直接依赖。** 当 `@deepseek-ai/cosmokit` 与 `@deepseek-ai/schemastery` 这两个工作区覆盖以传递方式出现时，`pnpm deploy` 不会把它们物化；直接列出它们（SDK 部署根的先例）会让 `materializeStagedLinks()` 把符号链接替换为真实拷贝。缺失 cosmokit 会在 exe 启动时报 `ERR_MODULE_NOT_FOUND`。

### 通道 1：GitHub Releases 的 curl|sh

[`apps/cli/install/install.sh`](../../../../apps/cli/install/install.sh) 是一个 POSIX `sh` 安装器：检测 `uname -s`/`-m`（macOS/Linux，arm64/x64；其余平台直接报错），解析版本（显式 `--version`/`DEEPSEEK_HARNESS_CLI_VERSION`，否则取 GitHub API `releases?per_page=100` 中最新的 `deepseek-harness-cli-v*` tag，该查询包含预发布版本），从 `releases/download/deepseek-harness-cli-v<ver>/` 下载 `deepseek-harness-cli-<arch>-<os>.tar.gz` 及其 `.sha256` 伴随文件，用 `shasum`（macOS）或 `sha256sum`（Linux）校验摘要，再以 `install -m 0755` 把 `bin/deepseek-harness-cli`（macOS 另有 `bin/deepseek-harness-cli-spawn-helper`）装进 `$HOME/.deepseek-harness-cli/bin`（或 `--to <dir>`），并幂等地把该目录追加进 shell rc。校验和不匹配会删除下载并退出非零；失败安装绝不留下半成品二进制。[`tests/test_install_sh.py`](../../../../apps/cli/install/tests/test_install_sh.py) 用 mock 发布服务器与 mock 的 `uname`/`shasum`/`sha256sum` 对它做无 key 测试。安装器从 raw `master` URL 获取，因此它随分支演进、与发布 tag 解耦；脚本本身在运行时解析最新版本。

### 通道 2：npm 全局安装

沿用 Codex 的 npm 契约，落在本 fork 的作用域下。主包 `@peiyuwang54/deepseek-harness-cli`（版本 `X.Y.Z`）是一个薄 ESM shim，`bin: { 'deepseek-harness-cli': 'bin/deepseek-harness-cli.js' }`；6 个平台 package 以 `X.Y.Z-<os>-<cpu>` 发布同名版本，带 npm 原生的 `os`／`cpu` 字段且**没有 `bin` 字段**（`bin` 字段会与 shim 的 `deepseek-harness-cli` 在 `node_modules/.bin` 里冲突）。主 manifest 通过 `optionalDependencies` alias 选择这些 package，因此 npm 只安装匹配的 macOS、Linux 或 Windows 运行时。POSIX package 携带本说明描述的可执行程序；[Windows release 分发说明](2026-08-15-windows-cli-release-distribution.md)负责目录 package 与内置 Node 的启动方式。dist-tag 使用 `macos-arm64`、`macos-x64`、`linux-arm64`、`linux-x64`、`windows-arm64` 与 `windows-x64`；主 package 在预发布时以 `next`、稳定版以 `latest` 发布。[`scripts/package-dsh-cli-npm.ts`](../../../../scripts/package-dsh-cli-npm.ts) 布局这些 package；[`scripts/dsh-npm-shim.js`](../../../../scripts/dsh-npm-shim.js) 是随包发布的 shim。

### 通道 3：Homebrew cask

[`scripts/gen-dsh-cask.ts`](../../../../scripts/gen-dsh-cask.ts) 依据发布版本与四个 tarball 的 sha256 伴随文件渲染 `deepseek-harness-cli` cask。因为四个 tarball 摘要各不相同，cask 以 `on_macos`/`on_linux` 嵌套 `on_arm`/`on_intel` 的 sha256 块，用 Homebrew 的 `arch`/`os` 宏构造各平台 URL，声明 `binary "bin/deepseek-harness-cli"`，并加入匹配 `deepseek-harness-cli-v(\d+\.\d+\.\d+(?:-rc\.\d+)?)` tag 的 `livecheck`。CI 把生成的 `Casks/d/deepseek-harness-cli.rb` 推到 `peiyuwang54/homebrew-dsh` tap，因此 `brew install peiyuwang54/dsh/deepseek-harness-cli` 即解析到该 cask。

### 发布 workflow

[`.github/workflows/deepseek-harness-cli-release.yml`](../../../../.github/workflows/deepseek-harness-cli-release.yml) 在一次运行里构建并发布全部 3 个通道，由 `deepseek-harness-cli-v*` tag push 或手动 dispatch 触发。tag 与可选的 dispatch `version` 必须匹配 `apps/cli/package.json`，后者是嵌入每个运行时的版本：

- **plan** 校验版本并计算 4 目标 POSIX 矩阵（`node24-linux-x64`→ubuntu-latest、`node24-linux-arm64`→ubuntu-24.04-arm、`node24-macos-arm64`→macos-15、`node24-macos-x64`→macos-15-intel）。
- **build** 按目标运行：不可变安装、Linux 上 node-pty manylinux 2.28 重建、`scripts/build-dsh-cli-exe.ts --targets=<target>`、Linux 上 GLIBC ≤ 2.28 检查、macOS 部署目标检查、`--version` 冒烟（须等于发布版本）、上传产物。
- **build-windows** 构建并校验 Windows 后续说明描述的 x64 与 ARM64 目录运行时。
- **package** 构建 4 个 POSIX tarball、2 个 Windows ZIP 及其 `.sha256` 伴随文件，运行 npm 布局、生成 cask，并把三组产物全部上传。
- **release** 用 `GITHUB_TOKEN` + `contents: write` 创建或刷新 GitHub release。
- **npm-publish**（`environment: npm-publish`、`NPM_TOKEN`）发布主包与平台包；其 `Release-publish` 并发组与 npm 发布 workflow 共用，因为 dist-tag 是共享的 registry 状态。
- **brew-tap** 用 `HOMEBREW_TAP_TOKEN` clone tap，替换 `Casks/d/deepseek-harness-cli.rb`，仅当文件变化时才提交并 push。

顶层并发以 `github.ref` 为 key 且 `cancel-in-progress: false`，因此同 ref 的重跑排队而非取消；`DSH_TELEMETRY_DISABLED=1` 让 CI 运行不进生产遥测。

### 完整性：当前 sha256，下一步 minisign

每次发布都为每个 tarball 或 ZIP 提供 sha256 伴随文件。POSIX installer 与 cask 校验 tarball，Windows installer 校验 ZIP。基于 minisign 的签名校验是 [`apps/cli/install/README.md`](../../../../apps/cli/install/README.md) 里写明的升级路径；在还没有外部消费者的情况下，预发布阶段使用 HTTPS + sha256 是相称的。

## 曾考虑的替代方案

**把所有运行时直接作为主 npm package 的 bin。**否决：单个 npm package 无法干净地携带 6 个平台运行时，单一 package 会把 6 个都装上。Codex 的拆分方式让 shim 主 package 通过带 `os`／`cpu` 条件的 `optionalDependencies` alias 只安装一个匹配运行时，也避免了 `.bin/deepseek-harness-cli` 冲突。

**平台包带 `bin` 字段。** 否决：npm 会把每个已安装平台包的 `deepseek-harness-cli` 链接进共享的 `node_modules/.bin`，与 shim 的 `deepseek-harness-cli` 冲突。平台包只带 `files: ['bin']`；由 shim 按包路径解析可执行程序。

**通过 GitHub 的 `releases/latest` 解析最新版本。** 否决：该端点排除预发布版本，而本仓库的发布暂时都是预发布。安装器查询 `releases?per_page=100` 并取最新的 `deepseek-harness-cli-v*` tag，因此 `--rc` 版本无需固定版本号也能解析。

**把 cask 发布为 Homebrew formula。** 否决：formula 从源码构建；分发产物是自带运行时、无构建步骤的独立二进制，这正是 cask 的契约。

**从第一天就提供 minisign 签名。** 否决，基于预发布立场：没有外部消费者，HTTPS + sha256 已相称，而密钥管理与签名管线是实打实的工作，最适合作为写明的升级路径引入。

**让 Windows 复用 SEA 流水线。**否决，因为单文件路径尚未提供经过测试的 ConPTY 与原生 addon 行为。Windows 使用后续说明描述的目录运行时。

## 后果

**买到**：一次 release 提供 3 个发布通道；Python SDK 与 CLI 共用一条 POSIX 可执行程序流水线；CLI 闭包封闭、plugin 集合即依赖 manifest；每个分发产物都能对宿主构建做无 key 的本地验证。

**付出**：每个平台产物约 200 MB；每次 release 都要运行 4 个 POSIX 与 2 个 Windows 原生构建，覆盖 3 个发布界面，fork 上还需配置 `NPM_TOKEN`、`HOMEBREW_TAP_TOKEN` 与 `npm-publish` environment；固定到分支的 installer URL 会独立于 release tag 跟随 `master`；在 minisign 落地之前完整性只有 sha256；fork 还新增了 npm scope 与一个 tap 仓库作为外部基础设施。
