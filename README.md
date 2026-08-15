# deepseek-harness-cli

English | [中文](README.zh.md)

deepseek-harness-cli is a lightweight, plugin-based coding agent that lives in your terminal. macOS and Linux use one single-file binary for the terminal UI, headless automation, and Web UI; Windows uses a native directory runtime for the terminal UI and headless automation. Both build on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

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

macOS (`arm64`, `x64`) and Linux (`arm64`, `x64`):

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
brew install peiyuwang54/dsh/deepseek-harness-cli
```

Windows (`arm64`, `x64`):

```powershell
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/scripts/install/install.ps1 | iex
```

Any supported platform with npm:

```sh
npm install -g @peiyuwang54/deepseek-harness-cli
```

Both download installers verify the release artifact against its sha256 sidecar. The POSIX installer writes to `$HOME/.deepseek-harness-cli/bin`; PowerShell writes to `%LOCALAPPDATA%\Programs\dsh`; npm selects one of six platform runtimes; Homebrew serves the cask from `peiyuwang54/homebrew-dsh`. The Windows package does not contain the built Web frontend, so use `tui` or a headless profile there. See [installer details](apps/cli/install/README.md).

<a id="run-from-source"></a>

## Run from source

```sh
git clone https://github.com/peiyuwang54/deepseek-harness-cli.git
cd deepseek-harness-cli
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh tui
```

Requires Node.js `^22.19` or `>=24` and pnpm `11.7.0`. Once on `PATH`, `deepseek-harness-cli` takes the same commands as the source entry — `tui`, `--profile headless "task"`, and `web` — and still needs a provider credential before the first model request (`DEEPSEEK_API_KEY` by default).

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
