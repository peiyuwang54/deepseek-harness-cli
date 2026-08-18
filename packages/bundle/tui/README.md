# `@deepseek-ai/dsh-tui-app`

English | [中文](README.zh.md)

The shipped interactive-terminal bundle. [`cordis.patch.yml`](cordis.patch.yml) layers over [`dsh-base`](../base/README.md), disables module HMR while the renderer owns terminal raw mode, and adds Code Mode, the shared agent-preset roster, `ui-theme` settings registration, the read-only Loader plugin inventory, durable JSON-backed workspace storage/registry, cross-session references, tmux context, the default standard preset's `ask_user_question`, the TUI prompt registry, the app-owned command-line provider, and the terminal runner. It mounts no HTTP server, Web runtime, or browser client; the settings, storage, workspace, plugin-inventory, and preset services are shared Host-plane facilities rather than Web-only UI code.

[`src/startup.ts`](src/startup.ts) owns the direct `deepseek` command's `--resume`, repeatable `--add-dir`, `--sandbox`, `--ask-for-approval`, `--full-auto`, `--yolo`, `--dangerously-bypass-approvals-and-sandbox`, and `--help` flags; `dsh tui` remains the compatibility spelling. A successful interactive launch publishes one immutable `tuiStartup.identity`: either a fresh `main-session-<uuid>` or the requested persisted session. Each `--add-dir` resolves against the session cwd, validates as an existing directory, and appends to the session's durable additional writable-root set before the Agent is published; resumed sessions retain earlier roots and may add more. The independent permission flags write the selected sandbox mode and approval policy through their canonical Session events before publication. `--full-auto` pins the configured `workspace-write` + `never` preset, while both unrestricted spellings pin `danger-full-access` + `never`. Independent flags cannot be combined with shortcuts; missing presets and invalid roots fail before presentation mounts. The command registry intentionally contains no session-level startup shortcuts; live permission changes continue through `/permissions`. Startup also supplies the renderer's main-session identity and printable `deepseek --resume` command. Help remains usable through a pipe; an otherwise successful launch without TTY stdin and stdout requests a failing bounded exit before the dependency-heavy runner activates.

After the Loader settles, [`src/index.ts`](src/index.ts) reads `ctx.agentDefaultModel` and `ctx.agentPresets`, then calls `ctx.agents.create` or `ctx.agents.resume` for that exact identity. Fresh creation resolves the effective default, records it in `SessionHeader.agentPreset`, and mounts that preset in unpublished Agent setup. Resume instead calls `resolveSessionPreset(session)`, so a later durable `agent-preset/selected` event wins over the header and the historical Web-created session regains the composition that produced it rather than today's default. Every base model-facing row owned by the preset roster is disabled at bundle scope, so only the selected preset mounts those capabilities and `minimal` cannot inherit the standard/code tool stack. The same setup installs the selected model route with `installModelSelection`; after publication it mounts [`@deepseek-ai/dsh-tui`](../../ui/tui/README.md) onto the existing root and removes the bootstrap listener, leaving the renderer's mutable `/model` selection authoritative. Agent lifecycle remains owned by the runner fiber and the core registry/factory.

The shipped CLI provides one process-handoff Host for both `/resume` and `/workspace`: after renderer-side validation and current-session flush, it re-executes the same profile and patch stack in the selected directory (or supervises a replacement child where process replacement is unavailable). A workspace selection starts without `--resume`; a resume selection replaces that flag with the chosen persisted id. Validation happens before the old tree is committed to shutdown, and terminal ownership returns to the renderer when a pre-commit failure rejects.

## Model Experience

Indirectly, through the composed base and TUI rows: those packages own model-facing prompt and tool content, while the runner's bootstrap model selection changes request routing without adding prompt text.

#### KV Cache effect

None; this bundle adds no stable request-prefix content of its own.

## Known Limitations and Deferred Work

- **Interactive terminal only** — normal startup requires both stdin and stdout TTYs. Use the shipped headless profile for pipes and automation.
- **Custom embeddings may omit handoff** — the shipped CLI provides both resume and fresh-workspace replacement, while a direct renderer embedding may provide resume only or neither. Missing capabilities warn and leave the current TUI/session unchanged.
- **No renderer module HMR** — the bundle disables shared module reload while terminal state is live; the launcher still keeps profile patch layers watchable through its watch-only fallback.
