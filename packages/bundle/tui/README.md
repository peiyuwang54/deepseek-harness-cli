# `@deepseek-ai/dsh-tui-app`

English | [中文](README.zh.md)

The shipped interactive-terminal bundle. [`cordis.patch.yml`](cordis.patch.yml) layers over [`dsh-base`](../base/README.md), disables module HMR while the renderer owns terminal raw mode, and adds Code Mode, cross-session references, tmux context, `ask_user_question`, the TUI prompt registry, the app-owned command-line provider, and the terminal runner. It mounts no Host, HTTP server, Web runtime, or browser client.

[`src/startup.ts`](src/startup.ts) owns `dsh tui`'s `--resume` and `--help`. A successful interactive launch publishes one immutable `tuiStartup.identity`: either a fresh `main-session-<uuid>` or the requested persisted session. It also supplies the renderer's main-session identity and printable resume command. Help remains usable through a pipe; an otherwise successful launch without TTY stdin and stdout requests a failing bounded exit before the dependency-heavy runner activates.

After the Loader settles, [`src/index.ts`](src/index.ts) reads `ctx.agentDefaultModel` and calls `ctx.agents.create` or `ctx.agents.resume` for that exact identity. Its unpublished Agent setup installs the selected route with `installModelSelection`; after publication it mounts [`@deepseek-ai/dsh-tui`](../../ui/tui/README.md) onto the existing root and removes the bootstrap listener, leaving the renderer's mutable `/model` selection authoritative. Agent lifecycle remains owned by the runner fiber and the core registry/factory.

## Model Experience

Indirectly, through the composed base and TUI rows: those packages own model-facing prompt and tool content, while the runner's bootstrap model selection changes request routing without adding prompt text.

#### KV Cache effect

None; this bundle adds no stable request-prefix content of its own.

## Known Limitations and Deferred Work

- **Interactive terminal only** — normal startup requires both stdin and stdout TTYs. Use the shipped headless profile for pipes and automation.
- **In-channel `/resume` handoff is host-optional** — `dsh tui --resume <id>` resumes directly. The selector can inspect sessions through the base query service, but replacing the current process in place additionally requires a host-provided `ctx.tuiResumeHost`.
- **No renderer module HMR** — the bundle disables shared module reload while terminal state is live; the launcher still keeps profile patch layers watchable through its watch-only fallback.
