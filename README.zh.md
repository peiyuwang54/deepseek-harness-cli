<p align="center"><strong>DeepSeek CLI</strong> 是由 DeepSeek 驱动、在本地终端运行的开源编码代理。</p>

&#8203;<div align="center">[English](README.md) | 中文</div>

<p align="center">
  <img src=".github/deepseek-cli-splash.png" alt="DeepSeek CLI 终端预览" width="80%" />
</p>

<p align="center"><strong>9 种界面语言 · 6 套主题配色 · 从规划到执行的智能体编程</strong></p>

<p align="center">
  <img src=".github/deepseek-cli-theme-swatches.svg" alt="DeepSeek CLI 主题色：DeepSeek、宇宙橙、雾蓝、鼠尾草绿、薰衣草紫和深蓝" width="280" />
</p>

---

**说明：** 这是 DeepSeek Harness CLI。我们会与官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 同步迭代，期待你的 fork 和 star。

<a id="run"></a>

## 快速开始

### 安装

macOS 或 Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
```

<a id="install-windows"></a>

Windows：

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex"
```

也可以使用以下包管理器安装 DeepSeek CLI：

```sh
# Install using npm
npm install -g @peiyu_wang/deepseek-harness-cli
```

```sh
# Install using Homebrew
brew install --cask peiyuwang54/dsh/deepseek-harness-cli
```

然后进入项目目录并运行 `deepseek` 开始使用，也可以使用较短的 `dsh` 别名：

```sh
deepseek
# or
dsh
```

脚本与 CI 可用 `deepseek exec` 运行非交互任务：

```sh
deepseek exec "run the tests"
deepseek exec --json "review this repository"
deepseek exec resume --last "continue"
```

首次启动时，将 DeepSeek API Key 粘贴到掩码输入框。Key 由共享凭据服务保存，不会进入聊天记录。之后可用 `/credentials` 查看来源、更换 Key 或删除已保存的值。

自动化场景可在启动前设置 `DEEPSEEK_API_KEY`；PowerShell 使用 `$env:DEEPSEEK_API_KEY="your-key"`。从启动环境继承的值在 CLI 内只读。

### 权限模式

```sh
deepseek
deepseek --full-auto
deepseek --yolo
deepseek --sandbox read-only --ask-for-approval ask
deepseek exec --sandbox workspace-write --ask-for-approval never "review this repository"
```

`--sandbox` 可选择 `read-only`、`workspace-write` 或 `danger-full-access`，`--ask-for-approval` 可选择 `ask` 或 `never`。显式控制会随 Session 持久化，且不能与 `--full-auto` 或 `--yolo` 组合。`--yolo` 风险很高，只能在隔离环境中使用。运行中可用 `/permissions` 切换到具名 preset。

在保持 `workspace-write` 限制的同时，可添加其他可写项目目录：

```sh
deepseek --add-dir ../shared
deepseek exec --add-dir ../shared "update both projects"
```

多个目录可重复传入 `--add-dir`。相对路径以启动时的项目目录为基准解析，恢复会话时仍然有效。该选项不会让 `read-only` 会话获得写权限。

### MCP 服务器

```sh
deepseek mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem .
deepseek mcp add remote --url https://example.com/mcp --header Authorization=MCP_TOKEN
deepseek mcp list
deepseek mcp remove filesystem
```

`--env KEY[=SOURCE]` 与 `--header NAME=SOURCE` 保存环境变量引用，而不是密钥值。对于 HTTP server，`deepseek mcp auth <name>` 会通过 loopback 浏览器回调完成 OAuth，并把 token 保存在 catalog 之外。添加、删除、启用或停用服务器后请重启 CLI。在运行中的会话里，可用 `/mcp`、`/mcp tools`、`/mcp desc`、`/mcp schema`、`/mcp auth <server>`、`/mcp resources` 或 `/mcp prompts` 检查实时 MCP 能力，并用 `/mcp reload [server]` 重连当前配置。

可以在不启动 profile 的情况下诊断安装，也可以为两个命令名安装 Shell 补全：

```sh
deepseek doctor
deepseek doctor --json
deepseek completion zsh > ~/.zsh/completions/_deepseek
```

`doctor` 还会检查随附的 profile overlay 与预置目录、可选 Web 前端资产、安装渠道、沙箱执行器、真彩色、鼠标输入和剪贴板支持。主机能力检查是警告；缺少运行时资产或 Node 版本不受支持会阻断启动。

可以在不启动 profile 的情况下查看并验证已安装的插件组合包：

```sh
deepseek plugin --profile tui list
deepseek plugin --profile tui verify --json
deepseek plugin --profile tui source <package>
deepseek plugin --profile tui disable <package>
deepseek plugin --profile tui enable <package>
deepseek plugin --profile tui install <package>
deepseek plugin --profile tui update
```

`source` 会显示包目录和声明的仓库。`enable` 与 `disable` 会修改生效的 Cordis 组合包列表，并在下次启动时生效；`install`、`update` 和 `remove` 使用 pnpm 解析依赖。

## 核心能力

- 代码读取、编辑、Shell、Web 搜索、Skills、MCP 与子代理。
- 持久会话、恢复、Plan、Goal、消息排队与上下文自动压缩。
- Codex 风格终端 UI，支持 6 套主题配色，以及英语、简体中文、繁体中文、阿拉伯语、法语、俄语、西班牙语、日语和韩语。
- 基于插件的终端、Headless 自动化与 Web UI profile。

<a id="run-from-source"></a>

## 从源码运行

```sh
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh
```

源码构建需要 Node.js `^22.19` 或 `>=24`，以及 pnpm `11.7.0`。

## 文档

- [CLI 命令与 profile](apps/cli/reference/README.md)
- [终端 UI 与斜杠命令](packages/ui/tui/README.md)
- [配置参考](docs/config-catalog.md)
- [架构](docs/architecture.md)
- [开发](docs/development.md)

请在 [GitHub Issues](https://github.com/peiyuwang54/deepseek-harness-cli/issues) 报告问题。

## 许可证

本项目采用 MIT 协议。恢复的 TUI 代码保留 BSD-3-Clause 声明；详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 社区友链

- LinuxDo — <https://linux.do>
