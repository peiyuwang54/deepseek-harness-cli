# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 是 DeepSeek Harness 中用于启动 profile 的命令；profile 由多个插件组合包 patch 层按顺序叠加而成，其上再应用用户自己的覆盖配置。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh tui` | `--profile tui` 的别名；打开交互式终端 UI。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |

运行命令时所在的目录将作为默认 workspace 根目录。`web`、`tui` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.md)）。因此，启动器的 flag 必须写在最前面；启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh tui --resume <id>               # --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile` 和其中按顺序排列的 `bundles` 列表；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-tui-app`、`@deepseek-ai/dsh-headless`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI（命令行界面）行为参考](reference/README.md)为准。

## 安装

`dsh` 以单文件可执行程序的形式，为 macOS（`arm64`、`x64`）与 Linux（`arm64`、`x64`）发布。任选其一即可安装：

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-web-to-cli/master/apps/cli/install/install.sh | sh
npm install -g @peiyuwang54/deepseek-harness-cli
brew install peiyuwang54/dsh/deepseek-harness-cli
```

第一个命令运行 curl 安装器：它下载最新的 `deepseek-harness-cli-v*` 发布版本，用该发布版本的 sha256 伴随文件校验 tarball，并安装到 `$HOME/.deepseek-harness-cli/bin`（`sh -s -- --to <dir>` 可覆盖目录，`--version <ver>` 可固定版本）。npm 包是覆盖各平台可执行程序的 shim；Homebrew cask 由 `peiyuwang54/homebrew-dsh` tap 提供。完整契约与计划中的 minisign 签名升级见[安装器 README](install/README.md)。

升级只需重新运行同一命令——curl 安装器原地替换二进制、`npm update -g @peiyuwang54/deepseek-harness-cli` 拉取最新版本、`brew upgrade deepseek-harness-cli` 刷新 cask。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.md#source-execution)为准。

在 Windows 上，[`scripts/install/install.ps1`](../../scripts/install/install.ps1) 会把这份 CLI 的打包副本安装到 `%LOCALAPPDATA%\Programs\dsh`。用户不带参数时，该启动器会启动 `tui`；[`src/args.ts`](src/args.ts) 中的语法不变。
