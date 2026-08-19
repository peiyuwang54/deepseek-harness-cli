# `@deepseek-ai/dsh`

[English](README.md) | 中文

没有指定 profile 时，`deepseek` 会打开随附的终端 profile。同一入口保留 `dsh` 兼容写法，用于组合按顺序叠加插件组合包 patch 层并应用用户覆盖配置的 profile。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效应用参数、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `deepseek` | 打开交互式终端 UI。 |
| `deepseek --full-auto` | 在工作区内不询问地运行，并拒绝更广访问。 |
| `deepseek --yolo` | 关闭沙箱与审批提示。 |
| `deepseek exec "job"` | 运行非交互任务并打印最终结果。 |
| `deepseek exec resume --last "job"` | 继续当前工作区中最新的持久化会话。 |
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | `deepseek exec` 的兼容写法。 |
| `dsh tui` | `--profile tui` 的别名；打开交互式终端 UI。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh plugin --profile <name> list` / `verify` | 不调用 pnpm，检查已安装依赖并验证生效的组合包层。 |
| `dsh plugin --profile <name> source <package>` | 显示插件的解析目录和声明的来源。 |
| `dsh plugin --profile <name> enable/disable <package>` | 切换下次启动时生效的组合包层。 |
| `dsh plugin --profile <name> install/update/remove ...` | 通过 pnpm 管理依赖（`install` 是 `add` 的别名）。 |
| `deepseek doctor [--json]` | 不启动 profile，验证安装并探测已启用的受管 MCP 服务器。 |
| `deepseek completion <shell>` | 输出 bash、zsh、fish 或 PowerShell 补全。 |

运行命令时所在的目录将作为默认 workspace 根目录。`web`、`tui` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.md)）。因此，启动器的 flag 必须写在最前面；启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh tui --resume <id>               # --resume belongs to the terminal app
deepseek exec --json "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

非交互命令还支持可重复的 `--image`、`--output-schema`、`--output-last-message`、`--ephemeral`、`--full-auto`、`--yolo` 与 `resume`；完整约定见 [headless 组合包](../../packages/bundle/headless/README.md)。

## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile` 和其中按顺序排列的 `bundles` 列表；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-tui-app`、`@deepseek-ai/dsh-headless`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。在随附终端中，`/debug-config` 只列出当前 profile 的来源路径与优先级，绝不打印配置值。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI（命令行界面）行为参考](reference/README.md)为准。

## 安装

`dsh` 以单文件可执行程序的形式，为 macOS（`arm64`、`x64`）、Linux（`arm64`、`x64`）与 Windows（`x64`）发布。在 macOS 或 Linux 上可任选以下一种方式安装：

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
npm install -g @peiyu_wang/deepseek-harness-cli
brew install peiyuwang54/dsh/deepseek-harness-cli
```

在 Windows 上运行：

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex"
```

下载安装器会选择最新的 `deepseek-harness-cli-v*` 发布版本，用其 sha256 伴随文件校验 tarball，并在 `$HOME/.deepseek-harness-cli/bin` 下安装 `deepseek`、`dsh` 与 `deepseek-harness-cli`。PowerShell 安装器会限制失败的发布下载并自动重试。npm 与 Homebrew 渠道提供 `deepseek` 和 `deepseek-harness-cli`。选项、重试行为与计划中的 minisign 签名升级见[安装器 README](install/README.md)。

升级时重新运行对应平台的同一命令即可。下载安装器会原地替换二进制，`npm update -g @peiyu_wang/deepseek-harness-cli` 会拉取最新版本，`brew upgrade deepseek-harness-cli` 会刷新 cask。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.md#source-execution)为准。

对于没有已发布版本的 checkout，[`scripts/install/install.ps1`](../../scripts/install/install.ps1) 会构建 Windows 目录包并安装到 `%LOCALAPPDATA%\Programs\dsh`。这条源码树路径与 Release 下载安装器彼此独立。
