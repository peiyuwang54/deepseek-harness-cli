# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

The terminal CLI in this private repository is currently distributed from source. The public `@deepseek-ai/dsh` package is an independently published DeepSeek AI release; use the source workflow below when you need the code in this repository.

### Prerequisites

- Git and a GitHub account with access to this private repository.
- Node.js `^22.19.0` or `>=24.0.0`.
- pnpm. The repository pins `pnpm@11.7.0`; install it with Corepack or npm if `pnpm --version` does not work.
- A DeepSeek API key before submitting a model task. Help, configuration dumps, and startup without a prompt do not call the model.

One way to install the pinned pnpm version is:

```sh
npm install --global pnpm@11.7.0
```

### Run from source

Clone the repository, install its workspace dependencies, and build the packages and Web frontend:

```sh
git clone https://github.com/peiyuwang54/deepseek-harness-web-to-cli.git
cd deepseek-harness-web-to-cli
pnpm install
pnpm run build
```

Run `pnpm install` again after `pnpm-lock.yaml` changes. Run `pnpm run build` after pulling source changes that affect packages or the Web frontend.

### Configure the API key

Set the key in the shell that starts `dsh`.

On macOS or Linux:

```sh
export DEEPSEEK_API_KEY="sk-your-key-here"
```

On Windows PowerShell:

```powershell
$env:DEEPSEEK_API_KEY = "sk-your-key-here"
```

Alternatively, put the key in a `.env` file at the selected workspace root:

```dotenv
DEEPSEEK_API_KEY=sk-your-key-here
```

The repository ignores `.env`, but never commit a real credential. The launcher also supports user-level credential layers under `$DSH_HOME` (default `~/.dsh`); see the [credential provider reference](packages/credentials/credentials-local/README.md).

### Verify the installation

These commands exercise the local launcher without sending a model request:

```sh
pnpm dsh --version
pnpm dsh --help
pnpm dsh exec --help
```

The root help should list `cli`, `exec`, `resume`, `web`, and `plugin`.

### Start an interactive terminal session

Run in the current repository, select another workspace with `-C`, or include the first prompt in the command:

```sh
pnpm dsh
pnpm dsh -C /path/to/project
pnpm dsh -C /path/to/project "Inspect this repository and explain how to run its tests"
```

The first invocation initializes the built-in `cli` profile under `$DSH_HOME/profiles/cli`. The startup banner shows the Session id, workspace, model, sandbox, and approval policy; verify the workspace and permissions before submitting a task.

- `/help` lists the available slash commands.
- `/exit`, `/quit`, Ctrl-D, or Ctrl-C while idle closes the Session.
- Ctrl-C during a running turn requests cancellation; a repeated interrupt exits the process.

### Run one non-interactive task

Use `exec` for scripts, pipes, and CI:

```sh
pnpm dsh exec "Summarize this repository"
pnpm dsh exec --sandbox workspace-write "Fix the failing tests and summarize the changes"
git diff --cached | pnpm dsh exec "Review this staged diff"
pnpm dsh exec --json "Summarize package.json" > run.jsonl
```

Fresh `exec` Sessions default to `read-only` with approval policy `never`. Add `--sandbox workspace-write` only when the task should modify the selected workspace. In human-readable mode, stdout contains the final assistant answer and stderr carries progress; `--json` writes JSONL events to stdout. A missing prompt, failed turn, or rejected operation returns a nonzero exit code.

### Resume a terminal Session

Resume the newest eligible Session in the current workspace, or select the workspace before resume:

```sh
pnpm dsh resume --last
pnpm dsh -C ../another-project resume --last
```

The startup banner prints the Session id for an explicit `pnpm dsh resume <session-id>` invocation. Terminal resume accepts persisted root Sessions from the same workspace; Web and custom-preset Sessions use a different composition and are not opened by the terminal profile.

### Start the Web UI

The same checkout can start the browser application:

```sh
pnpm dsh web
pnpm dsh web --port 8080
```

Open the URL printed by the command. Press Ctrl-C in the launching terminal to stop the server. Continue with the [Web UI guide](docs/user/guide/index.md) to configure models and choose a workspace.

### Permission defaults

| Invocation | Shipped default | Effect |
|---|---|---|
| `pnpm dsh` | `workspace-write` + `ask` | The interactive agent may modify the selected workspace and can ask before an operation that requires approval. |
| `pnpm dsh exec` | `read-only` + `never` | The unattended task cannot write or wait for a terminal approval unless flags explicitly change the policy. |
| `--sandbox workspace-write` | Explicit override | Grants workspace writes for the current invocation; inspect the selected directory before using it. |

Use `pnpm dsh cli --help`, `pnpm dsh exec --help`, or `pnpm dsh resume --help` for provider, model, reasoning-effort, sandbox, and approval options. The [terminal CLI reference](packages/bundle/terminal-cli/README.md) owns the exact stdin, output, resume, permission, and interruption behavior.

### Update the checkout

Pull the latest source and rebuild:

```sh
git pull
pnpm install
pnpm run build
```

### Troubleshooting

| Symptom | Resolution |
|---|---|
| `pnpm: command not found` | Install `pnpm@11.7.0`, then confirm `pnpm --version`. |
| Node reports an engine mismatch | Use Node.js `^22.19.0` or `>=24.0.0`. |
| The model credential is missing | Export `DEEPSEEK_API_KEY` or add it to the selected workspace's `.env`. |
| `interactive mode requires a TTY` | Run `pnpm dsh` in a terminal, or use `pnpm dsh exec` for redirected input or output. |
| `a prompt is required` | Pass prompt text, pipe non-empty stdin, or use `-` to read stdin explicitly. |
| An `exec` task cannot edit files | Add `--sandbox workspace-write` after confirming the target workspace. |
| Configuration is unclear | Run `pnpm dsh --dump-config` and inspect the composed profile without booting it. |

### More documentation

- [`dsh` commands and profiles](apps/cli/README.md)
- [Terminal interaction, automation, permissions, and limitations](packages/bundle/terminal-cli/README.md)
- [Web UI guide](docs/user/guide/index.md)
- [Contributor setup and development workflow](docs/development.md)

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
