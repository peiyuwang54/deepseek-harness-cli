# Agent Note: Ship the interactive TUI as a first-class CLI profile

Status: implemented

English | [中文](2026-08-14-shipped-tui-cli-front-door.zh.md)

## Problem

DeepSeek Harness retained a shipped Web application and one-shot/headless entry points, but no longer shipped an interactive terminal application. The earlier `@deepseek-ai/dsh-tui` implementation had been removed because it had no product composition, so keeping its renderer alone would again create an unsupported frontend. A terminal command must therefore prove the entire product boundary: CLI selection, Loader composition, exact Agent ownership, session restore, model routing, approvals and questions, terminal lifecycle, and package publication.

The restored frontend also had to target the current Harness APIs. Since its deletion, Cordis imports moved to the DeepSeek fork, model selection became a captured `ModelSelection`, user interaction split into `userQuestions` and `approval`, compaction and session-reference services changed names, Agent events adopted payload objects, and prompt-admission/inbox event shapes changed. Treating the historical source as current would compile only partially and would violate newer lifecycle and audit contracts.

## Decision

The CLI ships `dsh tui` as an alias of the app-owned `tui` profile. That profile composes `base + @deepseek-ai/dsh-tui-app`; it does not replace or alter the Web and headless profiles. `@deepseek-ai/dsh-tui-app` owns command-line startup and one exact root Agent identity, while `@deepseek-ai/dsh-tui` remains a presentation/input package that mounts onto an already created or resumed Agent.

Startup publishes either a fresh `main-session-<uuid>` identity or the requested `--resume` identity before the dependency-heavy runner activates. The runner waits for Loader settlement, installs the configured model selection during unpublished Agent setup, creates or resumes that exact identity, mounts the renderer, then removes the bootstrap selection so the TUI's `/model` controller is authoritative. The prompt registry is a separately addressable `@deepseek-ai/dsh-tui/prompt` Loader row mounted before the runner. Normal startup requires TTY stdin and stdout and fails early otherwise; `--help` remains pipe-safe. Pipes and automation use the existing headless profile.

The renderer is recovered from DeepSeek Harness's own pre-deletion history and ported to current APIs. Canonical `Session` events remain the sole durable conversation source: replay folds those events into committed terminal output, while live chunks, tool progress, questions, and approvals are transient projections. The TUI does not add another chat log or tool scheduler. It consumes the existing scoped command registry, Agent inbox operations, session query/reference services, skill registry, tool presenters, token meter, and model-selection seam.

Approval policy and execution remain owned by `ctx.approval`. The TUI registers only an exact-agent, FIFO answerer for `approval/request`, returning `allowed-once`, `rejected`, `cancelled`, or `unavailable`; the Approval service owns the durable `approval/asked` and `approval/decided` audit pair. `ctx.userQuestions` remains the independent structured-question provider. Both share the renderer's modal queue without becoming lifecycle or policy authorities.

Terminal rendering keeps stable history separate from live projection, preserves pre-first-token and per-phase timing, reorders an empty Assistant row behind claimed user/context messages, renders tool-owned presentation intents, supports session resume and scoped skills, and restores raw mode on disposal. Width-keyed card caches avoid re-wrapping settled output on every frame, while one forward timing cursor serves every step footer without rescanning the complete log. Color-scheme or reasoning rebuilds retain the current streaming component and invalidate its timing cache, so a mid-turn redraw cannot lose accumulated response time.

## Reference and provenance boundary

Gemini CLI and OpenAI Codex were studied for process-mode separation, terminal input routing, committed-versus-live rendering, approvals, resume, headless output discipline, and PTY testing. Their Apache-2.0 licensing would permit attributed reuse, but this implementation copies no source from either repository. Official Claude Code and the inspected third-party source reconstruction are all-rights-reserved; only high-level observable behavior was considered and no code or nontrivial expression was copied. `@earendil-works/pi-tui` remains an explicit dependency with its local compatibility patch and generated third-party notice.

The restored TUI snapshot is first-party DeepSeek Harness source from commit `7248b5ec8f8769f882f12fd521504fa48e97bcf3`, immediately before deletion commit `10bb9cbf4a22b5095bb9ff04d1425907af8f08af`. At that point both the repository and `@deepseek-ai/dsh-tui` declared BSD 3-Clause. The repository-wide MIT adoption in `c905c4694e317eff1f529f0fed047c2ce202d11a` happened after the package had been deleted and therefore did not carry that historical snapshot through the mechanical package-manifest relicensing. The restored implementation retains its BSD 3-Clause terms; the current adaptations and additions are MIT-licensed. The combined package consequently declares the exact SPDX expression `(MIT AND BSD-3-Clause)`, and its package-local `LICENSE` preserves both notices and explains the boundary.

## Verification

The renderer is covered by pure utility tests, Agent/session integration tests, real approval-service tests, ANSI-aware headless-terminal component tests, and keyless terminal-state snapshots. The app bundle has startup, identity, non-TTY, Agent creation/resume, and patch-shape tests. CLI tests cover the alias, profile selection, help, non-TTY failure, and shipped config. Package typecheck, host typecheck, Loader/config constraints, package publication constraints, generated catalogs, documentation links, licenses, and third-party notices are required gates.

## Alternatives considered

**Keep Web as the only interactive product.** Rejected because the requested deployment is an interactive CLI and Web cannot satisfy terminal-native workflows, piping boundaries, or SSH/tmux usage.

**Put Agent creation inside the renderer.** Rejected because it makes a UI package a lifecycle authority, races Loader listeners, and prevents the bundle from proving exact create/resume identity before presentation mounts.

**Copy a complete external CLI frontend.** Rejected because those frontends couple to different runtimes and data models; Claude-family source also cannot be copied under its license. Reusing the Harness-owned renderer preserves native Session, Tool, Command, Approval, and Cordis contracts.

**Make TTY detection silently fall back to headless.** Rejected because redirecting an interactive command would change its protocol and approval semantics. The explicit profile is the boundary: `tui` requires a terminal, `headless` is for automation.

## Consequences

DeepSeek Harness once again has a supported interactive terminal product, invoked with `dsh tui`, while `dsh web`, `--profile headless`, ACP, and other front doors remain independent. The product adds a renderer package, a shipped bundle, a pi-tui patch, terminal snapshots, and platform lifecycle obligations. A new Cordis service/catalog and package-publication surface must therefore remain generated and tested. The TUI is intentionally text-terminal only, has no cross-process session lock, and requires a host callback for in-process `/resume` handoff; direct `dsh tui --resume <id>` remains available without that callback.
