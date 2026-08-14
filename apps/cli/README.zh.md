# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 是 DeepSeek Harness 的终端 coding agent（编程智能体）与 profile 启动器。裸调用会启动内置终端应用；具名命令用于选择终端应用、Web 应用或插件管理，`--profile` 则选择叠加在用户覆盖配置之下的其他 profile 栈。[`src/args.ts`](src/args.ts) 负责启动器语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh [prompt...]` | 启动交互终端 Session，并可选择提交第一条提示词。 |
| `dsh exec [prompt...|-]` | 根据参数或 stdin 运行一个全新非交互轮次。 |
| `dsh resume [session] [prompt...]` | 恢复当前工作区中的持久化 root Session。 |
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |

运行命令时所在的目录将作为默认 workspace 根目录。`cli`、`web` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## 终端应用

```sh
dsh
dsh "inspect this repository"
printf 'review this change' | dsh exec -
dsh exec --json "run the tests"
dsh resume --last
```

裸 `dsh` 与 `dsh cli` 打开同一个面向行的交互应用。它在多次后续输入之间保持同一个 Agent 与持久化 Session，流式显示 assistant 和工具活动，分派已注册的斜杠命令，并提供终端审批与提问交互。除非部署设置或命令行设置进行覆盖，全新交互 Session 会采用 base 组合的 `workspace-write` 沙箱与 `ask` 审批默认值。

`dsh exec` 为一次无人值守轮次创建全新 Session。如果同时存在位置提示词与管道 stdin，它会将两者组合；人类可读输出只将最终 assistant 文本写入 stdout，并将进度写入 stderr，而 `--json` 会发出终端应用的 JSONL 事件格式。exec 独立默认为 `read-only` 与审批策略 `never`，因此绝不会等待终端回答。

`dsh resume SESSION` 会重新打开记录工作区与当前目录相符的持久化 root Session；省略 id 或使用 `--last` 时，会选择该目录中最新的合格 Session。带 preset 的 Web 与自定义 Session 会被排除，因为终端 profile 不挂载它们的组合。除非本次调用显式覆盖，已记录的模型与权限选择会继续有效。交互、stdin、输出、恢复和限制细节由 [`dsh-terminal-cli` 包 README](../../packages/bundle/terminal-cli/README.md)负责。

`dsh exec` 与 `dsh --profile headless` 是两个独立的一次性应用：exec 提供终端进度、stdin 组合、JSONL 和故障安全的无人值守权限默认值，headless profile 则只输出最终答案。`dsh web` 是随附浏览器 profile 的直接别名。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.md)）。因此，启动器的 flag 必须写在最前面；启动器无法识别的第一个 token 标志着应用参数的开始。`-C, --cd` 属于启动器，会在加载环境文件与 profile 前切换目录：

```sh
dsh -C ../repo exec --json "inspect this repository"
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile headless "run the tests"
dsh exec --help                     # the terminal app's exec flags
dsh --help                          # the launcher's own help
```

## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile` 和其中按顺序排列的 `bundles` 列表；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。

配置树以空根为起点，依次叠加以下配置层：

- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-terminal-cli`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

层的确切优先级、启动器 flag、关闭行为、部署默认值和源码执行方式，以[启动器行为参考](reference/README.md)为准。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.md#source-execution)为准。
