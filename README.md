# deepseek-harness-cli

English | [中文](README.zh.md)

deepseek-harness-cli is a lightweight, plugin-based coding agent that lives in your terminal. One single-file binary packages the interactive terminal UI, one-shot headless automation, and the Web UI on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> This is an unofficial community fork. It is not maintained, sponsored, or endorsed by DeepSeek AI. The upstream project and the `@deepseek-ai` packages originate from DeepSeek AI; the distributed `deepseek-harness-cli` binary is this fork's build.

<a id="run"></a>

## Quick start

```sh
export DEEPSEEK_API_KEY="your-key"

deepseek-harness-cli tui
deepseek-harness-cli --profile headless "inspect the repository and summarize the test failures"
deepseek-harness-cli web
```

The directory you run the command from is the workspace. Profiles, credentials, and sessions live under `$DSH_HOME` (default `~/.dsh`). Never commit provider keys.

## Install

macOS (`arm64`, `x64`), Linux (`arm64`, `x64`), and Windows (`x64`) — pick one channel:

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
npm install -g @peiyuwang54/deepseek-harness-cli
brew install peiyuwang54/dsh/deepseek-harness-cli
```

```powershell
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex
```

The curl|sh and irm|iex lines verify the tarball against the release's sha256 sidecar and install to `$HOME/.deepseek-harness-cli/bin` (Windows also writes `dsh.cmd` and `deepseek.cmd`). The npm line is a shim over the per-platform executable, including Windows x64. The brew line serves the cask from the `peiyuwang54/homebrew-dsh` tap (macOS and Linux only).

<a id="install-windows"></a>

### Windows from source

When no release exists, or you want the `node.exe` plus production-closure directory package, clone the checkout and run the source installer:

```powershell
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
powershell -ExecutionPolicy Bypass -File .\scripts\install\install.ps1
```

The script installs workspace dependencies when `node_modules` is missing, builds the host and client libraries, packs a portable folder (the host `node.exe` plus the `@deepseek-ai/dsh` production closure), copies it to `%LOCALAPPDATA%\Programs\dsh`, and adds that folder to the user PATH. Open a new terminal and run `dsh`. A command with no arguments opens the terminal UI.

The installed command does not point at the clone. Updating or deleting the checkout leaves the installed copy unchanged until you run the installer again. The same packer writes `dist-windows/dsh-win32-<arch>.zip` beside the folder. `dsh web` is not part of this package. `pnpm run pack:windows-cli` writes the folder and zip without installing.

<a id="run-from-source"></a>

## Run from source

```sh
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh tui
```

Requires Node.js `^22.19` or `>=24` and pnpm `11.7.0`. Once on `PATH`, `deepseek-harness-cli` takes the same commands as the source entry — `tui`, `--profile headless "task"`, and `web` — and still needs a provider credential before the first model request (`DEEPSEEK_API_KEY` by default). Extra catalog routes and OpenAI-compatible gateways sit beside that default; they do not replace it.

<a id="other-providers"></a>

## Other providers

A key the installed catalog already ships (`openai`, `anthropic`, `openrouter`, `google`, …) needs only `apiKeyEnv` under `llm-pi-ai` in `$DSH_HOME/settings.yaml`. A company gateway, Ollama-style server, or other OpenAI-compatible endpoint is a hand-declared route: give it `api`, `baseURL`, and a `models` list. Store each referenced key in `$DSH_HOME/.credentials.yaml`. `/model` lists every live route, including `deepseek-official`. The composition default stays `deepseek-official` until `agent-default-model` names another pair.

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

Web **Settings → Models** writes the same files. The [model configuration guide](docs/user/guide/providers.md) and the [pi-ai adapter README](packages/llm/llm-pi-ai/README.md) own the field list, catalog vs hand-declared rules, and providers that need native auth instead of an API key.

## Documentation

- [CLI reference](apps/cli/reference/README.md)
- [Terminal UI details](packages/ui/tui/README.md)
- [Architecture](docs/architecture.md)
- [Development guide](docs/development.md)
- [Issues](https://github.com/peiyuwang54/deepseek-harness-cli/issues)

## Security

- New sessions default to `workspace-write` with approval prompts; writes are confined to the workspace, but file reads, network access, and process visibility are not a full sandbox.
- `dsh tui --yolo` starts a session with the sandbox and approval prompts disabled — run it only in an isolated environment. There is no in-session `/yolo` command; use `/permissions` for deliberate live changes.
- Credentials are process-visible plain files, not an OS keychain.
- External plugins and MCP server commands are trusted executable code; review them before adding them to a profile.

## License

MIT for fork changes; the TUI source recovered from earlier upstream history keeps its BSD-3-Clause notice — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
