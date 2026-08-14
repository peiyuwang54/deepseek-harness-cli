# deepseek-harness-cli

[English](README.md) | 中文

deepseek-harness-cli 是一个轻量、基于插件机制的终端编码代理。单个单文件二进制即在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 之上集成了交互式终端 UI、一次性 headless 自动化与 Web UI。

> 这是一个非官方的社区 fork，不由 DeepSeek AI 维护、赞助或背书。上游项目与 `@deepseek-ai` 系列包源自 DeepSeek AI；对外分发的 `deepseek-harness-cli` 二进制是本 fork 的构建产物。

<a id="run"></a>

## 快速开始

```sh
export DEEPSEEK_API_KEY="your-key"

deepseek-harness-cli tui
deepseek-harness-cli --profile headless "inspect the repository and summarize the test failures"
deepseek-harness-cli web
```

运行命令时所在的目录即为工作区。配置文件、凭据与会话存放在 `$DSH_HOME`（默认 `~/.dsh`）。切勿提交密钥。

## 安装

macOS（`arm64`、`x64`）与 Linux（`arm64`、`x64`）——任选一种方式：

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
npm install -g @peiyuwang54/deepseek-harness-cli
brew install peiyuwang54/dsh/deepseek-harness-cli
```

curl|sh 一行会用同一 release 的 sha256 sidecar 校验 tarball，并安装到 `$HOME/.deepseek-harness-cli/bin`；npm 一行是覆盖各平台可执行文件的 shim；brew 一行从 `peiyuwang54/homebrew-dsh` tap 提供 cask。Windows 不是分发目标；请从源码构建，或使用 [`scripts/install/install.ps1`](scripts/install/install.ps1)。

<a id="run-from-source"></a>

## 从源码运行

```sh
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh tui
```

需要 Node.js `^22.19` 或 `>=24`，以及 pnpm `11.7.0`。一旦进入 `PATH`，`deepseek-harness-cli` 与源码入口接受相同的命令——`tui`、`--profile headless "task"`、`web`——并且在第一次模型请求前仍然需要一份 provider 凭据（默认 `DEEPSEEK_API_KEY`）。

## 文档

- [CLI 参考](apps/cli/reference/README.md)
- [终端 UI 详情](packages/ui/tui/README.md)
- [架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [Issues](https://github.com/peiyuwang54/deepseek-harness-cli/issues)

## 安全

- 新会话默认 `workspace-write` 并带审批提示；写入被限制在工作区内，但文件读取、网络访问与进程可见性并非完整沙箱。
- `/yolo` 会故意关闭沙箱与审批提示——只能在隔离环境中使用。
- 凭据是进程可见的明文文件，不是操作系统钥匙串。
- 外部插件与 MCP 服务器命令是可执行的受信代码；加入 profile 前请先审查。

## 许可证

fork 改动采用 MIT；从早期上游历史中恢复的 TUI 源码保留其 BSD-3-Clause 声明——详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
