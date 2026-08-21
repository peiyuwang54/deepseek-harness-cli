# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

`deepseek` opens the shipped terminal profile when no explicit profile is named. The same entry remains available as `dsh` for profile composition: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid app arguments, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `deepseek` | Open the interactive terminal UI. |
| `deepseek --full-auto` | Run without prompts inside the workspace; deny wider access. |
| `deepseek --yolo` | Run without a sandbox or approval prompts. |
| `deepseek exec "job"` | Run a non-interactive task and print the final result. |
| `deepseek exec resume --last "job"` | Continue the newest persisted session in this workspace. |
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Compatibility spelling for `deepseek exec`. |
| `dsh tui` | Alias of `--profile tui`; open the interactive terminal UI. |
| `dsh web` | Alias of `--profile web`. |
| `dsh plugin --profile <name> list` / `verify` | Inspect installed dependencies and validate active bundle layers without pnpm. |
| `dsh plugin --profile <name> source <package>` | Show a plugin's resolved directory and declared source. |
| `dsh plugin --profile <name> enable/disable <package>` | Toggle a bundle layer for the next launch. |
| `dsh plugin --profile <name> install/update/remove ...` | Manage dependencies through pnpm (`install` is an alias for `add`). |
| `deepseek doctor [--json]` | Validate the installation and probe enabled managed MCP servers without booting a profile. |
| `deepseek completion <shell>` | Print completion for bash, zsh, fish, or PowerShell. |

The invoking directory is the default workspace root. The `web`, `tui`, and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). Launcher flags therefore come first, and the first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh tui --resume <id>               # --resume belongs to the terminal app
deepseek exec --json "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

The non-interactive command also supports repeatable `--image`, `--output-schema`, `--output-last-message`, `--ephemeral`, `--full-auto`, `--yolo`, and `resume`; see the [headless bundle contract](../../packages/bundle/headless/README.md).

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer).

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-tui-app`, `@deepseek-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it. Inside the shipped terminal, `/debug-config` lists only the active profile's source paths and precedence; it never prints configuration values.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Install

`dsh` ships as an application executable with a target-native ripgrep sidecar for macOS (`arm64`, `x64`), Linux (`arm64`, `x64`), and Windows (`x64`). On macOS or Linux, install it with any one of these:

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
npm install -g @peiyu_wang/deepseek-harness-cli
brew install peiyuwang54/dsh/deepseek-harness-cli
```

On Windows, run:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex"
```

The download installers select the newest `deepseek-harness-cli-v*` release, verify the tarball against its sha256 sidecar, and install `deepseek`, `dsh`, and `deepseek-harness-cli` under `$HOME/.deepseek-harness-cli/bin`. The PowerShell installer bounds and retries failed release downloads. The npm and Homebrew channels expose `deepseek` and `deepseek-harness-cli`. See [the installer README](install/README.md) for options, retry behavior, and the planned minisign signature upgrade.

Upgrading re-runs the same platform command. The download installers replace the binaries in place, `npm update -g @peiyu_wang/deepseek-harness-cli` pulls the newest version, and `brew upgrade deepseek-harness-cli` refreshes the cask.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.

For a checkout without a published release, [`scripts/install/install.ps1`](../../scripts/install/install.ps1) builds and installs a Windows directory package into `%LOCALAPPDATA%\Programs\dsh`. This source-tree path is separate from the Release download installer.
