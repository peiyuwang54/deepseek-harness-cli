# `dsh` CLI behavior reference

English | [中文](README.zh.md)

This reference defines the profile, shipped-alias, MCP-management, plugin-management, and config-dump command modes. Argv is parsed once through [`src/args.ts`](../src/args.ts), and [`src/bin.ts`](../src/bin.ts) dynamically imports only the selected runner.

## Profile boot

`dsh --profile <name>` boots the profile at `$DSH_HOME/profiles/<name>`. The effective tree is composed over an empty root by applying, in order: each bundle patch named in the profile manifest's `dsh.profile.bundles` list; MCP server rows projected from `$DSH_HOME/mcp.json` for the shipped `web`, `tui`, and `headless` profiles; the profile's own `cordis.patch.yml`; the home-level `$DSH_HOME/cordis.patch.yml` (machine-local preferences shared by every profile, so it outranks the per-profile layer); and each `--patch <path>` overlay in argv order. Later layers win per row; a patch replaces the targeted row's complete `config` value rather than deep-merging keys, and may insert new rows. A parse, schema, resolution, or plugin boot failure is reported and exits nonzero. SIGINT and SIGTERM dispose the mounted root before exit.

Bundle names resolve from the dsh installation first, then from the profile directory. In-box bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-tui-app`, `@deepseek-ai/dsh-headless`) therefore always come from the same installation as the running `dsh`; out-of-tree bundles come from the profile's pnpm-managed `node_modules`. A bare plugin `name` in any patch row resolves through the profile directory's Node parent-walk, which reaches the maintained installation fallback `$DSH_HOME/profiles/node_modules` (one symlink per package the installation's app and bundles depend on, healed on every launch).

The `web`, `tui`, and `headless` profiles auto-initialize from shipped templates on first use (`web`: base + web-app; `tui`: base + tui-app; `headless`: base + headless). Any other missing profile fails loud with a hint to run `dsh plugin --profile <name> add <package>`.

### App arguments

The launcher's flags come first and end at the first token it does not recognize; everything from there on is handed to the booted profile verbatim through `ctx.cmdlineArgs`, where any injected app plugin may parse it ([`dsh-cmdline`](../../../packages/boot/cmdline/README.md)). With no explicit profile, the launcher selects `tui`, so bare `deepseek` opens the terminal and `deepseek --full-auto` reaches its startup provider. `dsh --profile web --port 8080` reaches the web app's `--port`, while bare `dsh --help` remains the launcher's own help. `-V`/`--version` prints the launcher's version when it appears before the app-argument boundary.

A composition mounts once. An ordinary plugin injects `cmdlineArgs`, parses this app's arguments, and provides what it resolved as a service; each row configured from flags injects that service, and Loader waits for it before evaluating the row's config (`port: !!js ctx.webStartup.port ?? 3080`). A flag therefore beats the value written beside it. This precedence requires the row to retain that expression; a user patch that replaces the whole `config` with literals removes the runtime read. Help and rejected arguments request exit — nonzero for a rejection, 0 for help — without activating rows that depend on the provider's service. A live `cordis.patch.yml` edit re-evaluates expressions against services that are still up, so it cannot reset a served port.

Launcher flags must come before app arguments, and the launcher's parser consumes one `--`: an app argument that must arrive as a literal `--` needs `-- --`. A first app argument equal to `web`, `tui`, `mcp`, or `plugin` selects that subcommand instead. `ctx.cmdlineArgs.get()` is a shared immutable read: multiple plugins may parse the same snapshot, while a profile with no reader ignores its app arguments.

The shipped apps own these command lines:

| Profile | Arguments |
|---|---|
| `web` | `--host`, `--port`, repeatable `--trusted-host` |
| `tui` | `--resume <session>`, repeatable `--add-dir`, `--sandbox`, `--ask-for-approval`, and permission shortcuts |
| `headless` | task text; `--json`, `--ephemeral`, repeatable `--image`/`--add-dir`, output controls, exact permission controls, shortcuts, and `resume` |

The `deepseek exec "run the tests"` alias creates one persisted Agent and prints its final result; `dsh --profile headless` remains the profile-level spelling. `--json` emits JSONL lifecycle events. Repeatable `--image` admits local PNG, JPEG, WebP, or GIF inputs, `--output-schema` requires schema-valid structured output, and `--output-last-message` saves the result. `resume <id>` continues an exact Session, while `resume --last` selects the newest Session in the current workspace unless `--all` is present. `--ephemeral` applies only to fresh runs. Permission controls and shortcuts match the terminal command. The runner waits for quiescence and flushes before output, exits 0 only for completed valid results, mounts no ApiProxy, Host, HTTP server, Web runtime, or browser client, and opens no listening port. The [headless bundle README](../../../packages/bundle/headless/README.md) owns the output and failure contracts.

Inspect the composed tree without booting it:

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` prints only the bundle layers; `--dump-config` adds managed MCP rows, the profile's `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml`, and `--patch` overlays. Both print comments naming the file that supplied each row and every overlay that changed it; `!!js` expressions remain unevaluated, managed MCP environment references remain redacted as source names, and unmatched patch targets are reported on stderr. A dump never runs app command-line providers, so it shows the composed tree before any app argument is resolved and rejects an invocation that carries app arguments.

## MCP server management

`deepseek mcp` manages the version-0 user catalog at `$DSH_HOME/mcp.json`; the same commands are available through `dsh mcp`. `list` is the default, `get <name>` shows one server without resolving secrets, `enable <name>` and `disable <name>` change whether the entry is projected into shipped profiles, `add` accepts either a stdio command after `--` or one `--url`, and `remove <name>` deletes it. Writes use a cross-process lock plus atomic replacement and set the file mode to `0600` where the platform supports POSIX permissions.

```sh
deepseek mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem .
deepseek mcp add github --env GITHUB_TOKEN -- npx -y @modelcontextprotocol/server-github
deepseek mcp add remote --url https://example.com/mcp --header Authorization=MCP_TOKEN
deepseek mcp list
deepseek mcp get remote
deepseek mcp remove filesystem
```

`--env KEY` forwards the same-named launch environment variable; `--env KEY=SOURCE` maps another source variable into the server process. HTTP `--header NAME=SOURCE` follows the same reference model. The catalog stores only source names and resolves them when a shipped profile starts; an unset source fails startup before the server connects. Embedded URL credentials are rejected. Config dumps print `<environment:SOURCE>` rather than the resolved value.

Managed servers load only into the three shipped app profiles and require a restart after add, remove, enable, or disable. Custom profiles retain full ownership of their composition and can insert `@deepseek-ai/dsh-mcp-client` through ordinary patches. A stdio server command executes as trusted local code outside the agent sandbox; install and review it before enabling it. Inside the TUI, `/mcp`, `/mcp desc`, and `/mcp schema` combine live connection state with the scoped tools that each server published; `/mcp resources [server] [uri]` and `/mcp prompts [server] [prompt]` inspect MCP Resources and Prompts. `/mcp reload [server]` reconnects one current instance or all of them while every live Agent is idle; it does not reread the managed catalog.

## Doctor and shell completion

`deepseek doctor` checks the Node version, platform, workspace, `$DSH_HOME`, credentials, MCP catalog, shipped runtime assets, and interactive terminal capabilities without booting a profile. It returns zero when there are no blocking errors; warnings such as a missing API key or non-interactive output remain visible but do not block diagnosis. Use `--json` for automation.

```sh
deepseek doctor
deepseek doctor --json
```

`deepseek completion <shell>` prints a completion script for `bash`, `zsh`, `fish`, or `powershell`. Source the output in the shell's normal completion configuration; the script covers both `deepseek` and `dsh`.

```sh
deepseek completion zsh > ~/.zsh/completions/_deepseek
deepseek completion bash >> ~/.bash_completion
```

## Plugin management

`dsh plugin --profile <name> <args...>` initializes the profile when missing (shipped template, or `@deepseek-ai/dsh-base` alone for other names), then forwards `<args...>` to `pnpm` with the profile directory as working directory — `add`, `remove`, `why`, `update`, and every other pnpm verb work unchanged; pnpm must be on PATH. Relative path specs (`.`, `../plugin`, and their `file:`/`link:` forms) are anchored to the invoking directory first, so `add .` from a plugin checkout installs that checkout, not the profile. After every successful run, `dsh.profile.bundles` is reconciled against the installed state: each dependency resolving to a package whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` joins the layer stack (so an `update` that gains the declaration activates it), a bundle-less dependency stays plain with a one-time warning, and a removed dependency leaves the stack.

`dsh plugin --profile <name> list` inspects installed dependencies without invoking pnpm. `dsh plugin --profile <name> verify` resolves every active bundle, parses its patch file, and checks that bundle declarations and the active layer list agree. Both commands accept `--json` for automation and return nonzero when the profile is missing or invalid.

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui list
dsh plugin --profile tui verify --json
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

Git-hosted plugins that ship sources build during install through their `prepare` script, which pnpm ≥10 blocks until the consumer allows it: the first `add` fails with pnpm's `allowBuilds` hint (and a dsh pointer at the profile's `pnpm-workspace.yaml`); copy the printed key there and re-run. Installing a built tarball or a local checkout needs no allowance.

## Terminal front door

Bare `deepseek` selects the shipped `tui` profile; `dsh tui` remains the compatibility spelling. Its startup provider owns `--resume <session>`, repeatable `--add-dir`, `--sandbox`, `--ask-for-approval`, the permission shortcuts, and app help. `--sandbox` accepts `read-only`, `workspace-write`, or `danger-full-access`; `--ask-for-approval` accepts `ask` or `never`. `--full-auto` selects workspace confinement with approval prompts disabled; both unrestricted spellings disable confinement and approval prompts. Exact controls cannot be combined with shortcuts. Help is available without a TTY; a successful run requires interactive stdin and stdout and fails before the terminal runner activates when either side is a pipe. After Loader settlement, the runner creates a fresh persisted root Agent or resumes the requested identity through `ctx.agents`, writes requested permission controls during unpublished setup, installs the default model selection, and mounts the process TUI onto that root. The profile mounts no Host, HTTP server, Web runtime, or browser client.

```sh
deepseek
deepseek --resume <session>
deepseek --sandbox read-only --ask-for-approval ask
deepseek --full-auto
deepseek --yolo
deepseek --dangerously-bypass-approvals-and-sandbox
dsh tui --patch ./extra.cordis.yml
dsh tui --dump-default-config
dsh tui --help
```

## Web alias

`dsh web` is a hardcoded alias for `--profile web`; the flags after it belong to the web app, whose ordinary bundle provider parses them. `--host` and `--port` override the composed values of the rows that carry them, and repeatable `--trusted-host` contributes invocation authorities through `ctx.webRuntime.trustedHosts` (a deployment expression concatenates its own authorities). The client-plugin HMR receiver is always mounted and stays idle until a separate `pnpm run dev:web` watcher rebuilds client bundles.

```sh
dsh web
dsh web --patch ./extra.cordis.yml
dsh web --dump-config
dsh web --help
```

The production Web runner needs built package and frontend artifacts (`pnpm run build`). It serves `http://127.0.0.1:3080` by default. The CLI intentionally does not support `--host 0.0.0.0` yet and exits with a usage error; `--trusted-host` adds named authorities accepted by the `/api` browser-trust fence.

Process shutdown gives the plugin tree up to five seconds to dispose. The first `SIGINT`/`SIGTERM` starts that graceful drain — `SIGTERM` is a supervisor's ordinary stop request and exits 0 on every surface, `SIGINT` reports 130; a second signal forces immediate exit. If one-shot normal completion is already stuck in disposal, the first `Ctrl+C` is the escalation and exits immediately instead of being swallowed.

All modes treat the invoking directory as the default workspace root, load applicable `AGENTS.md` or `CLAUDE.md` instructions with a 65,536-byte render budget, and use an in-memory SQLite session content index. Every profile boot watches valid edits of both `cordis.patch.yml` layers (profile and home) and reapplies them transactionally; a one-shot surface exits through its bounded shutdown, which disposes the watchers.

New sessions default to the `workspace-write` permission preset. Bash and filesystem mutations are restricted to the session workspace and platform temporary roots; reads, network access, and process visibility are not confined. `--sandbox` and `--ask-for-approval` write independent durable knobs; if their pair matches no named preset, `/permissions` reports `custom`. `deepseek --full-auto` pins `workspace-write` + `never`; `deepseek --yolo` and its long alias pin the configured full-access/no-approval preset before publication. No session-level startup shortcut is registered; use `/permissions` for live changes. `DSH_PERMISSION_MODE` changes the process fallback. Stored General-settings permissions affect later Web sessions, not an already-open one.

`DSH_TOOLS_MODE` selects `native`, `code`, or `both` for the process; another value fails at boot. The shipped `minimal` agent preset keeps that deployment presentation, fixes the complete system prompt to `You are a helpful software engineer assistant.`, and composes only persistent `bash` plus `str_replace_editor`. Select 极简模式 when creating a Web session; every other prompt section and model-facing plugin remains absent from that agent while the shared browser, workspace, persistence, sandbox, and permission host stays in place.

## Shared deployment behavior

The base bundle mounts the native DeepSeek adapter, the dormant pi-ai multi-provider adapter, settings and credential providers, stable `web_search`, and disabled session telemetry. Provider credentials resolve from the inherited environment, `$DSH_HOME/.credentials.yaml`, the invoking directory's `.env`, then `$DSH_HOME/.env`; the managed document is never materialized into `process.env`, while both `.env` files are ordinary launch environment layers. Search uses `DEEPSEEK_API_KEY` and accepts `DEEPSEEK_SEARCH_BASE_URL`; `web_fetch` is disabled unless a patch layer inserts a provider and enables it. An `llm-pi-ai:` settings section that names `openrouter` with `apiKeyEnv: OPENROUTER_API_KEY` registers that catalog route live.

Session telemetry stays local by default. `DSH_TELEMETRY_MODE=FULL` streams every projected session event as OTLP/HTTP logs, while `DSH_TELEMETRY_MODE=FEEDBACK_ONLY` uploads a session-log suffix only when feedback is recorded. `DSH_TELEMETRY_OTLP_URL` selects another collector, and any non-empty `DSH_TELEMETRY_DISABLED` remains an authoritative hard opt-out. The shipped base has no telemetry redaction rule, so explicitly enabled exports can contain message text, tool arguments and results, and workspace paths; the [default-off Agent Note](../../../.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md) owns that deployment decision.

Install external plugin bundles through `dsh plugin --profile <name> add <package-or-git-spec>`. The installed package owns its dependencies and contributes its declared `cordis.patch.yml` layer. The CLI ships `@deepseek-ai/dsh-mcp-client` for both the managed catalog and explicit patch layers; no server is enabled by default.

## Source execution

From the repository root, run `pnpm run build` separately after a fresh checkout and whenever artifacts need updating, then use `pnpm dsh <args...>`. The `package.json` script launches `apps/cli/src/bin.ts` with `node --import tsx/esm` without building and forwards every argument. Missing Typert host artifacts fail profile boot through module-resolution errors without a build instruction. Once those host artifacts exist, missing frontend or client-plugin bundles fail at startup with an instruction to run `pnpm run build`. The launcher does not check freshness, so existing stale bundles can run older browser code until rebuilt. The process inherits the launch environment; set `NODE_USE_ENV_PROXY=1` when a supporting Node version must honor `HTTP_PROXY` and `HTTPS_PROXY`. Published installations launch the platform executable without rebuilding the repository; on Windows, [`apps/cli/install/install.ps1`](../install/install.ps1) downloads the x64 Release asset, verifies its SHA-256 sidecar, and installs all three command names. The checkout-only [`scripts/install/install.ps1`](../../../scripts/install/install.ps1) remains available for building and testing the directory package from source. See the [root Windows install section](../../../README.md#install-windows).
