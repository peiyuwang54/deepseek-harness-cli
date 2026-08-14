# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the DeepSeek Harness terminal coding agent and profile launcher. A bare invocation boots the built-in terminal application; named commands select terminal or Web applications and plugin management, while `--profile` selects another profile stack under the user's own overrides. [`src/args.ts`](src/args.ts) owns the launcher grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh [prompt...]` | Start an interactive terminal Session and optionally submit the first prompt. |
| `dsh exec [prompt...|-]` | Run one fresh non-interactive turn from arguments or stdin. |
| `dsh resume [session] [prompt...]` | Resume a persisted root Session in the current workspace. |
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh web` | Alias of `--profile web`. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

The invoking directory is the default workspace root. The `cli`, `web`, and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## Terminal application

```sh
dsh
dsh "inspect this repository"
printf 'review this change' | dsh exec -
dsh exec --json "run the tests"
dsh resume --last
```

Bare `dsh` and `dsh cli` open the same line-oriented interactive application. It keeps one Agent and durable Session across follow-ups, streams assistant and tool activity, dispatches registered slash commands, and supplies terminal approval and question interactions. Fresh interactive Sessions use the base composition's `workspace-write` sandbox and `ask` approval defaults unless deployment or command-line settings override them.

`dsh exec` creates a fresh Session for one unattended turn. It combines a positional prompt with piped stdin when both exist; human output reserves stdout for the final assistant text and uses stderr for progress, while `--json` emits the terminal application's JSONL event format. Exec defaults independently to `read-only` and approval policy `never`, so it never waits for a terminal answer.

`dsh resume SESSION` reopens a persisted root Session whose recorded workspace matches the current directory; omitting the id or using `--last` selects the newest eligible Session there. Preset-bearing Web and custom Sessions are excluded because the terminal profile does not mount their composition. Logged model and permission choices remain effective unless the invocation explicitly overrides them. The [`dsh-terminal-cli` package README](../../packages/bundle/terminal-cli/README.md) owns the interaction, stdin, output, resume, and limitation details.

`dsh exec` and `dsh --profile headless` are separate one-shot applications: exec provides terminal progress, stdin composition, JSONL, and fail-closed unattended permission defaults, while the headless profile preserves its final-answer-only output. `dsh web` is the direct alias for the shipped browser profile.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). Launcher flags therefore come first, and the first token the launcher does not recognize starts the app's arguments. `-C, --cd` belongs to the launcher and changes directory before environment files and profiles load:

```sh
dsh -C ../repo exec --json "inspect this repository"
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile headless "run the tests"
dsh exec --help                     # the terminal app's exec flags
dsh --help                          # the launcher's own help
```

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer).

The tree composes over an empty root:

- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-terminal-cli`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [launcher behavior reference](reference/README.md) owns exact layer precedence, launcher flags, shutdown behavior, deployment defaults, and source execution.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
