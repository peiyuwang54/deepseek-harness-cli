# `@deepseek-ai/dsh-terminal-cli`

English | [中文](README.zh.md)

The line-oriented terminal CLI bundle behind the built-in `cli` profile. The launcher auto-initializes that profile for bare `dsh`; [`cordis.patch.yml`](cordis.patch.yml) layers the coding persona, tool mode, Code Mode worker, argument provider, and terminal runner over [`dsh-base`](../base/README.md). It mounts no Host, HTTP server, Web runtime, or browser plugin.

The package adapts process input and output to the existing Harness runtime. It creates or resumes through `ctx.agents`, keeps one live `Agent` and its durable `Session` for an interactive invocation, and renders only events from that Session. The existing Agent loop, model adapters, tools, persistence, sandbox policy, and approval service remain their owning packages' responsibilities. The runner flushes the Session, disposes the Agent handle, and requests bounded shutdown through the launcher-provided `ctx.appExit` hook.

## Commands

```text
dsh [PROMPT...]
dsh cli [PROMPT...]
dsh exec [PROMPT...|-]
dsh resume [SESSION] [PROMPT...]
dsh resume --last
```

Bare `dsh` and the explicit `dsh cli` alias open the same interactive application. An initial `PROMPT` is submitted before the first input prompt. `dsh cli --help`, `dsh exec --help`, and `dsh resume --help` describe the application-owned provider, model, reasoning-effort, sandbox, and approval options; the launcher owns `-C, --cd` and changes directory before loading environment files or composing the profile.

## Interactive sessions

Interactive mode requires TTY stdin and stdout; a pipe or redirected stdout fails with a direction to use `dsh exec`. The startup banner identifies the Session, workspace, model selection, and effective permissions. Assistant text streams from `assistant/chunk` events, tool calls and bounded results use each tool's pure presenter when available, and terminal control bytes from model or tool text are removed before display.

One serialized readline owner serves prompts, approvals, and [`ask_user_question`](../../interaction/user-questions/README.md) requests. `/help` lists `/exit` plus the commands registered through [`ctx.commands`](../../interaction/commands/README.md); `/exit`, `/quit`, Ctrl-D, or an idle Ctrl-C flushes and closes the Session. Ctrl-C during a running turn requests `Agent.cancel()` and leaves the prompt available after cancellation; a repeated interrupt delegates to the launcher's bounded process exit.

## Non-interactive exec

`dsh exec` creates a fresh Session, submits one turn, waits for the Agent to become idle, and exits. A positional prompt is joined with spaces. `-` reads UTF-8 stdin explicitly, an omitted prompt reads non-TTY stdin, and piped input is appended to a positional prompt after one blank line when both exist. Stdin is limited to 1 MiB; empty input and larger streams fail before Agent creation.

In human mode, tool progress and diagnostics go to stderr and stdout contains only the final assistant text followed by a newline. A completed turn exits 0; an invalid invocation or a turn that ends without `completed` exits 1. Exec never installs the terminal question or approval answerers, so unattended work cannot consume stdin as a hidden interaction channel.

`dsh exec --json` replaces human output with schema-versioned JSONL on stdout. It emits `thread.started`, `turn.started`, assistant `item.updated` and `item.completed` records, tool `item.started` and `item.completed` records, and a terminal `turn.completed` or `turn.failed` record. These records use a public terminal event format with stable ids and Session sequence numbers, not serialized internal Session events; renderer diagnostics remain on stderr.

The terminal record is committed only after the durable Session flush and owned Agent disposal succeed. A persistence or teardown failure therefore produces one `turn.failed` for the real Session and turn, never an earlier `turn.completed` followed by a contradictory synthetic failure.

## Resume

`dsh resume SESSION` reopens an eligible persisted root Session in its recorded workspace. Omitting `SESSION` or passing `--last` selects the newest eligible Session whose `cwd` equals the current working directory; subagent Sessions, Sessions from another workspace, and Sessions carrying a Web or custom Agent preset are rejected. The terminal profile does not mount the preset roster, so silently replaying preset history against its base tool composition would be unsafe. Use the launcher-owned `-C` option to enter another recorded workspace before profile composition. An optional prompt after an explicit Session id is submitted immediately after resume.

Resume derives model selection from the Session's last request header before falling back to [`ctx.agentDefaultModel`](../../core/agent-default-model/README.md). Explicit provider, model, or reasoning-effort flags override that selection for subsequent requests. Changing provider or model without an explicit reasoning effort clears the old adapter-owned effort instead of sending it to an incompatible route. Logged sandbox and approval choices also survive resume; explicit permission flags append the corresponding per-Session changes instead of mutating a process-wide default.

## Permissions

With the shipped base composition, a fresh interactive Session starts in `workspace-write` with approval policy `ask`; deployment configuration or explicit `--sandbox` and `--approval` flags may select another value. Interactive approval is one-shot, accepts only an explicit `y` or `yes`, and treats every other answer or EOF as rejection.

Fresh exec Sessions independently default to `read-only` and `never`, regardless of the interactive defaults. `--sandbox workspace-write` permits the composed sandbox providers to write within their configured file-effect policy, while `danger-full-access` removes that file restriction; sandbox modes do not describe network or process policy. `--approval never` rejects operations that require approval before interactive dispatch. The owning references define the durable [`sandbox/mode`](../../sandbox/sandbox-policy/README.md) and [`approval/policy`](../../interaction/user-approval/README.md) behavior.

## Extension points

Registered slash commands appear without terminal-package changes, and tool definitions may supply `presentCall` and `presentResult` functions for terminal titles and summaries. The terminal interaction providers are scoped to the root Agent: delegated agents do not acquire the root terminal's questions or approvals.

## Model Experience

None, as the terminal adapter submits ordinary user messages and renders Session events; model prompts and tools belong to the composed base bundle.

#### KV Cache effect

None directly; this package adds no request-prefix content.

## Known Limitations and Deferred Work

- **Line-oriented rendering only** — there is no multiline editor, file completion, mouse support, full-screen layout, or rich Markdown and diff rendering.
- **Interactive resume only** — `dsh exec` always creates a fresh Session; there is no unattended `exec resume` command.
- **Same-workspace root resume only** — the selector excludes subagent Sessions and refuses a Session whose recorded `cwd` differs from the process working directory.
- **No Agent-preset resume** — the terminal profile has no preset roster, so it rejects preset-bearing Web and custom Sessions instead of replaying them under a different tool and prompt composition.
- **No unattended interaction provider** — `dsh exec --approval ask` still cannot prompt; without another composed answerer, an operation that needs an answer fails closed as unavailable.
- **Displayed tool results are bounded summaries** — terminal and generic results are truncated for display while the durable Session event remains the source for replay and other projections.
- **Launcher host hooks are required** — mounting the runner outside the `dsh` launcher fails at activation unless the host provides `ctx.appExit` and command-line services.
