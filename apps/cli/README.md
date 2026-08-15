# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the product launcher for profiles: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh tui` | Alias of `--profile tui`; open the interactive terminal UI. |
| `dsh web` | Alias of `--profile web`. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

The invoking directory is the default workspace root. The `web`, `tui`, and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). Launcher flags therefore come first, and the first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh tui --resume <id>               # --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer).

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-tui-app`, `@deepseek-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Install

macOS (`arm64`, `x64`) and Linux (`arm64`, `x64`) ship as single-file executables:

```sh
curl -fsSL https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.sh | sh
brew install peiyuwang54/dsh/deepseek-harness-cli
```

Windows (`arm64`, `x64`) ships as a directory runtime:

```powershell
irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/scripts/install/install.ps1 | iex
```

npm supports all six targets:

```sh
npm install -g @peiyuwang54/deepseek-harness-cli
```

The download installers select the newest `deepseek-harness-cli-v*` release including prereleases, verify its tarball or ZIP against the matching sha256 sidecar, and install without a source checkout. The npm shim selects the matching runtime, and the Homebrew cask is served from the `peiyuwang54/homebrew-dsh` tap. The Windows package contains TUI/headless libraries but not the built Web frontend. See [the installer README](install/README.md) for options, local-package installation, and the planned minisign upgrade.

Upgrading re-runs the same installer — the POSIX and Windows installers replace the runtime in place, `npm update -g @peiyuwang54/deepseek-harness-cli` pulls the newest version, and `brew upgrade deepseek-harness-cli` refreshes the cask.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.

On Windows, `pnpm run pack:windows-cli` builds the directory runtime from a checkout; pass `-PackageDir .\dist-windows\dsh` to [`scripts/install/install.ps1`](../../scripts/install/install.ps1) to install that local package. Both cmd launchers boot `tui` when the user passes no arguments; the grammar in [`src/args.ts`](src/args.ts) is unchanged.
