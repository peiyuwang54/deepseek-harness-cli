<p align="center"><strong>DeepSeek CLI</strong> 是由 DeepSeek 驱动、在本地终端运行的开源编码代理。</p>

&#8203;<div align="center">[English](README.md) | 中文</div>

<p align="center">
  <img src=".github/deepseek-cli-splash.png" alt="DeepSeek CLI 终端预览" width="80%" />
</p>

<p align="center"><strong>8 种界面语言 · 6 套主题配色 · Plan、Goal、Skills、MCP、子代理与自动上下文压缩</strong></p>

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

Windows（x64）会下载最新的 `deepseek-harness-cli-v*` 发布包：

```powershell
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex
```

<a id="install-windows"></a>

源码 checkout 仍会构建目录包，供你需要宿主 `node.exe` 树、而不是发布 exe 时使用：

```powershell
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
powershell -ExecutionPolicy Bypass -File .\scripts\install\install.ps1
```

也可以使用包管理器：

```sh
npm install -g @peiyuwang54/deepseek-harness-cli
brew install peiyuwang54/dsh/deepseek-harness-cli
```

进入项目目录，然后运行 `deepseek`：

```sh
deepseek
```

首次启动时，将 DeepSeek API Key 粘贴到掩码输入框。Key 由共享凭据服务保存，不会进入聊天记录。之后可用 `/credentials` 查看来源、更换 Key 或删除已保存的值。

自动化场景可在启动前设置 `DEEPSEEK_API_KEY`；PowerShell 使用 `$env:DEEPSEEK_API_KEY="your-key"`。从启动环境继承的值在 CLI 内只读。

### 权限模式

```sh
deepseek
deepseek --full-auto
deepseek --yolo
```

`--yolo` 风险很高，只能在隔离环境中使用。运行中请用 `/permissions` 安全切换当前会话。

## 核心能力

- 代码读取、编辑、Shell、Web 搜索、Skills、MCP 与子代理。
- 持久会话、恢复、Plan、Goal、消息排队与上下文自动压缩。
- Codex 风格终端 UI，支持 6 套主题配色，以及中文、英语、阿拉伯语、法语、俄语、西班牙语、日语和韩语。
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
