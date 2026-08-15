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

macOS（`arm64`、`x64`）、Linux（`arm64`、`x64`）与 Windows（`x64`）——任选一种方式：

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
npm install -g @peiyuwang54/deepseek-harness-cli
brew install peiyuwang54/dsh/deepseek-harness-cli
```

```powershell
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex
```

curl|sh 与 irm|iex 会用同一 release 的 sha256 sidecar 校验 tarball，并安装到 `$HOME/.deepseek-harness-cli/bin`（Windows 还会写出 `dsh.cmd` 与 `deepseek.cmd`）。npm 一行是覆盖各平台可执行文件的 shim，包括 Windows x64。brew 一行从 `peiyuwang54/homebrew-dsh` tap 提供 cask（仅 macOS 与 Linux）。

<a id="install-windows"></a>

### 从源码安装 Windows 目录包

当还没有 release，或你需要 `node.exe` 加生产闭包的目录包时，请先 clone 这份检出，再运行源码安装器：

```powershell
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
powershell -ExecutionPolicy Bypass -File .\scripts\install\install.ps1
```

当缺少 `node_modules` 时，脚本会安装 workspace 依赖，构建 Host 与 Client 库，打出一份便携目录（宿主 `node.exe` 加上 `@deepseek-ai/dsh` 的生产闭包），复制到 `%LOCALAPPDATA%\Programs\dsh`，并把该目录写入用户 PATH。打开新的终端后运行 `dsh`。不带参数的命令会打开终端 UI。

已安装的命令不指向这份 clone。更新或删除检出不会改变已安装副本，除非再次运行安装器。同一打包器还会在该目录旁写出 `dist-windows/dsh-win32-<arch>.zip`。`dsh web` 不属于此包。`pnpm run pack:windows-cli` 只写出目录和 zip，不执行安装。

<a id="run-from-source"></a>

## 从源码运行

```sh
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh tui
```

需要 Node.js `^22.19` 或 `>=24`，以及 pnpm `11.7.0`。一旦进入 `PATH`，`deepseek-harness-cli` 与源码入口接受相同的命令——`tui`、`--profile headless "task"`、`web`——并且在第一次模型请求前仍然需要一份 provider 凭据（默认 `DEEPSEEK_API_KEY`）。额外的 catalog 路由和 OpenAI 兼容网关与该默认并存，不会替换它。

<a id="other-providers"></a>

## 其他提供方

已安装 catalog 里已有的键（`openai`、`anthropic`、`openrouter`、`google` 等）只需在 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai` 下写 `apiKeyEnv`。公司网关、Ollama 一类服务，或其他 OpenAI 兼容端点，则是手工声明的路由：写上 `api`、`baseURL` 和 `models` 列表。把每个被引用的密钥存进 `$DSH_HOME/.credentials.yaml`。`/model` 会列出所有已上线路由，包括 `deepseek-official`。在 `agent-default-model` 改写之前，组合默认值仍是 `deepseek-official`。

```yaml
llm-pi-ai:
  providers:
    openai:
      apiKeyEnv: OPENAI_API_KEY
    openrouter:
      apiKeyEnv: OPENROUTER_API_KEY
    local-gateway:
      displayName: Local gateway
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: http://127.0.0.1:8000/v1
      models:
        - id: local-model

# Optional. Omit this block to keep the DeepSeek official default.
agent-default-model:
  provider: openrouter
  model: deepseek/deepseek-v4-flash
```

Web 的**设置 → 模型**写入同一组文件。字段列表、catalog 与手工声明的规则，以及需要原生认证而不是 API key 的提供方，见[模型配置指南](docs/user/guide/providers.md)和 [pi-ai 适配器 README](packages/llm/llm-pi-ai/README.md)。

## 文档

- [CLI 参考](apps/cli/reference/README.md)
- [终端 UI 详情](packages/ui/tui/README.md)
- [架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [Issues](https://github.com/peiyuwang54/deepseek-harness-cli/issues)

## 安全

- 新会话默认 `workspace-write` 并带审批提示；写入被限制在工作区内，但文件读取、网络访问与进程可见性并非完整沙箱。
- `dsh tui --yolo` 会以关闭沙箱和审批提示的方式启动会话——只能在隔离环境中使用。会话内不提供 `/yolo`；如需主动切换当前会话，请使用 `/permissions`。
- 凭据是进程可见的明文文件，不是操作系统钥匙串。
- 外部插件与 MCP 服务器命令是可执行的受信代码；加入 profile 前请先审查。

## 许可证

fork 改动采用 MIT；从早期上游历史中恢复的 TUI 源码保留其 BSD-3-Clause 声明——详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
