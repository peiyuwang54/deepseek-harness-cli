# Agent Note: Ship a line-oriented terminal CLI

Status: implemented

English | [中文](2026-08-14-shipped-terminal-cli.zh.md)

## Problem

The `@deepseek-ai/dsh` launcher owns profile selection, profile plugins, the Web application, and one-shot headless execution. The headless profile is intentionally non-interactive, so it does not provide a multi-turn terminal application with live progress, approvals, model questions, cancellation, or persisted resume. Adding that product without another launcher or execution engine requires a terminal-specific presentation and interaction layer over the existing Agent and Session services.

The repository removed the unshipped, product-sized `@deepseek-ai/dsh-tui` package because it had no maintained deployment. That decision remains the authority for the deleted implementation and its maintenance cost. This decision replaces only [the no-terminal-frontend consequence](../simplification/2026-08-04-remove-tui-package.md), not the rationale for deleting the old full-screen package.

## Decision

DeepSeek Harness ships the line-oriented `@deepseek-ai/dsh-terminal-cli` frontend through a built-in `cli` profile layered over `@deepseek-ai/dsh-base`. The existing `@deepseek-ai/dsh` launcher remains the sole binary, and the existing Agent, Session, tool, persistence, sandbox, and model services remain the execution engine. The terminal package owns command parsing, terminal interaction, Session-event projection, and process-facing output.

The default command contract is:

```text
dsh [PROMPT]             start an interactive REPL; submit PROMPT first when present
dsh exec [PROMPT|-]      run one unattended turn and exit
dsh resume [SESSION]     resume a persisted Session, or select the latest eligible Session
```

The explicit `dsh cli` alias reaches the same interactive profile. `dsh web`, `dsh plugin`, explicit `--profile`, and `dsh --profile headless` remain supported. `-C`/`--cd`, provider, model, reasoning-effort, sandbox, and approval options are resolved after profile and personal configuration. Resume considers only root Sessions from the selected working directory that do not carry an Agent preset. An explicit preset-bearing Session is rejected, while implicit latest-Session selection skips it. A resumed Session keeps its logged model and permission choices unless the invocation explicitly overrides them.

## Interaction and output contract

Interactive mode uses one Agent and Session for every follow-up. It subscribes to the durable `session/event` stream, renders assistant text as it arrives, reports tool calls and bounded results, dispatches registered slash commands, and supplies the single active user-question provider and approval answerer. The first Ctrl-C during a running turn calls `Agent.cancel()` and keeps the REPL alive; a second Ctrl-C escalates through the launcher to exit `130`. Idle Ctrl-C, Ctrl-D, or `/exit` flushes and exits cleanly.

`dsh exec` never opens terminal questions. Fresh exec Sessions start with read-only sandboxing and approval policy `never` unless explicitly overridden, so an unattended process fails closed instead of waiting for input. In human mode, stdout contains only the final assistant text while progress and diagnostics use stderr. With `--json`, stdout is JSONL made from a stable CLI event vocabulary rather than a dump of internal Session events. Positional text and piped stdin follow the Codex-style rule: `-` reads stdin, omitted text reads a non-TTY stdin, and a pipe is appended to positional text when both exist.

Argument and usage errors exit `1`; a completed turn exits `0`; configuration, model, tool, durability, interrupted, and failed turns exit `1`. A JSON terminal record is committed only after the Session flush and owned Agent disposal settle: success emits one `turn.completed`, while a turn or lifecycle failure emits one `turn.failed` with the real Session identity. Every owned Agent is flushed and disposed through the application's bounded shutdown path.

## Package boundary

The terminal package is a profile bundle, not another launcher and not a reusable full-screen widget library. It provides:

- a startup provider that parses the terminal application's arguments before any Agent is created;
- a Session adapter that creates or resumes through `ctx.agents`, preserves logged model state, and refuses Session compositions the `cli` profile cannot reconstruct;
- human, JSONL, and interactive event renderers over the same Session-event source; and
- readline-backed command, approval, and user-question interaction.

It does not copy the Codex Rust core, app-server, Ratatui UI, authentication product, or model/tool loop. Full-screen rendering remains outside this decision and would require its own product and lifecycle evidence.

## Verification

- The [terminal startup parser tests](../../../../packages/bundle/terminal-cli/tests/startup.spec.ts) reject an invalid sandbox, a simultaneous `resume --last` and Session id, and an empty model option without publishing startup state; every case records exit `1`.
- The [runner tests](../../../../packages/bundle/terminal-cli/tests/runner.spec.ts) commit `turn.completed` only after `runTurn` and `close()` succeed. Injected failures in either persistence flush produce exactly one real-Session `turn.failed`, dispose the Agent, and exit `1` instead of publishing a pending success.
- The [Session adapter tests](../../../../packages/bundle/terminal-cli/tests/session.spec.ts) skip preset-bearing Sessions during latest-Session selection and reject explicit Sessions whose preset appears either in the header or in an `agent-preset/selected` event.
- The runner tests assert that a first Ctrl-C cancels the active turn and a second calls `appInterrupt.escalate(130)`, while launcher-delivered repetition delegates to launcher shutdown. The [real PTY snapshot](../../../../apps/cli/tests/terminal-cli.snapshot.ts) confirms two Ctrl-C bytes during a running turn exit the process with `130`.
- The real PTY snapshot drives two prompts, clean exit, persistence, and same-Session resume through the composed `cli` profile. The [built-binary acceptance test](../../../../apps/cli/tests/built-bin.e2e.ts) covers argv, stdin, combined prompt input, human stdout, and terminal JSONL through the published entry path. With successful Sessions already stored in the same `DSH_HOME`, it also confirms that empty `dsh exec -` exits `1` with `a prompt is required` instead of hanging on profile watchers.

## Alternatives considered

**Document `dsh --profile headless` as sufficient.** Rejected because it solves shell automation but not the multi-turn terminal product, live output, human interaction, cancellation, or resume.

**Restore the deleted TUI package.** Rejected because its product-sized full-screen implementation predates the current profile, Agent, permission, and persistence contracts. Restoring it would inherit stale ownership and lifecycle assumptions instead of proving the new deployment against current services.

**Put the REPL directly in `apps/cli`.** Rejected because the launcher owns profile selection and composition while application arguments and interaction belong to the booted profile. Keeping the terminal frontend in a bundle preserves the same external-plugin and personal-patch model as the Web and headless surfaces.

## Consequences

DeepSeek Harness gains one terminal product without adding a second binary or model/tool loop. Interactive, unattended, and resumed work share the same durable Session services, and scripts receive a stable stdout, JSONL, permission-default, and exit-code contract.

The line renderer deliberately omits multiline editing, file completion, mouse interaction, and rich Markdown or diff layout. One input owner, bounded tool summaries, explicit teardown, and transcript snapshots constrain prompt interleaving and terminal residue, but they do not provide full-screen behavior.

Preset-bearing Sessions remain outside terminal resume because the `cli` profile cannot reconstruct their composition. Delaying the JSON terminal record until persistence and disposal settle adds shutdown latency, but prevents a script from observing success before the durable Session and owned Agent have closed successfully.
