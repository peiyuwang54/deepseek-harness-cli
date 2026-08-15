<p align="center"><strong>DeepSeek CLI</strong> is an open-source coding agent powered by DeepSeek that runs locally in your terminal.</p>

&#8203;<div align="center">English | [中文](README.zh.md)</div>

<p align="center">
  <img src=".github/deepseek-cli-splash.png" alt="DeepSeek CLI terminal preview" width="80%" />
</p>

<p align="center"><strong>8 interface languages · 6 theme palettes · Agentic coding from plan to execution</strong></p>

<p align="center">
  <img src=".github/deepseek-cli-theme-swatches.svg" alt="DeepSeek CLI theme colors: DeepSeek, Cosmic Orange, Mist Blue, Sage, Lavender, and Deep Blue" width="280" />
</p>

---

**Note:** This is DeepSeek Harness CLI. We keep iterating in sync with the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), and we look forward to your forks and stars.

<a id="run"></a>

## Quickstart

### Install

macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
```

Windows currently installs from a source checkout:

<a id="install-windows"></a>

```powershell
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
powershell -ExecutionPolicy Bypass -File .\scripts\install\install.ps1
```

Package managers are also supported:

```sh
npm install -g @peiyu_wang/deepseek-harness-cli
brew install peiyuwang54/dsh/deepseek-harness-cli
```

Open a project directory and start the CLI with `deepseek` or its shorter `dsh` alias:

```sh
deepseek
# or
dsh
```

On first launch, paste your DeepSeek API key into the masked prompt. The key is stored by the shared credential provider and never added to chat history. Use `/credentials` to inspect its source, replace it, or remove the saved value.

For automation, set `DEEPSEEK_API_KEY` before launch (`$env:DEEPSEEK_API_KEY="your-key"` in PowerShell). An inherited environment value is read-only inside the CLI.

### Permission modes

```sh
deepseek
deepseek --full-auto
deepseek --yolo
```

`--yolo` is dangerous. Use it only in an isolated environment. Use `/permissions` to change the current session safely.

## What it includes

- Code reading, editing, shell tools, web search, skills, MCP, and subagents.
- Persistent sessions with resume, plan, goal, queued messages, and automatic context compaction.
- A Codex-style terminal UI with six theme palettes and English, Chinese, Arabic, French, Russian, Spanish, Japanese, and Korean.
- Plugin-based profiles for terminal, headless automation, and the Web UI.

<a id="run-from-source"></a>

## Run from source

```sh
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh
```

Source builds require Node.js `^22.19` or `>=24` and pnpm `11.7.0`.

## Docs

- [CLI commands and profiles](apps/cli/reference/README.md)
- [Terminal UI and slash commands](packages/ui/tui/README.md)
- [Configuration reference](docs/config-catalog.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)

Report bugs in [GitHub Issues](https://github.com/peiyuwang54/deepseek-harness-cli/issues).

## License

This project is licensed under MIT. Restored TUI code retains its BSD-3-Clause notice; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
