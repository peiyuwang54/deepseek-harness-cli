# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

The interactive terminal front door for DeepSeek Harness agents, built on [`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui). It requires stdin and stdout TTYs; scripts and Loader pipes should use the one-shot [`@deepseek-ai/dsh-headless`](../../bundle/headless/README.md) profile instead.

The implemented [shipped TUI CLI Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-shipped-tui-cli-front-door.md) owns the front-door, composition, compatibility, provenance, and verification decisions.

Interactive terminals on macOS, Linux, and Windows are supported. Windows uses pi-tui's native console VT-input handling and ConPTY process verification.

The renderer uses inline terminal scrollback by default. The terminal owns mouse-wheel scrolling and drag selection over the growing conversation, while keyboard Up/Down remains editor history navigation. Ordinary built-in selectors are composer-attached: the shared-surface composer remains visible, the selected command's panel opens immediately below it, and the status lines remain below the panel instead of a modal covering the middle of the conversation. Slash-command, skill, workspace-file, and session-reference autocomplete use that same flow: composer content ends first, then the candidate list renders on the following rows instead of inside the input surface. The root `/` catalog remains command-only; concrete skill rows are nested under the explicit `/skill:` prefix or the `/skills` browser. Approval requests and structured user questions remain modal because they interrupt execution and require an explicit answer; `/resume` retains its purpose-built full-viewport browser. The focused editor retains pi-tui's hardware cursor marker as the terminal IME anchor and alternates a one-cell software caret every 530 ms, so focus stays visible even when the terminal profile disables or ignores cursor blinking. A keystroke restarts the visible phase. Shift/Alt+Enter inserts a newline, bracketed paste retains multiline content, and `@` completion remains available at every cursor position. Setting `fullscreen: true` enables a bounded alternate-screen transcript where Page Up/Down scrolls and Ctrl+End resumes following the tail. Adding `mouse: true` in that mode captures clicks and the wheel for model/footer targets, selectors, autocomplete, and transcript scrolling; text selection then uses the terminal's selection modifier, normally Shift.

A fresh, empty session opens on an adaptive, Claude Code-inspired split welcome card without copying Claude product text or assets. Its title includes the base package version, while its left column says welcome, renders the repository's first-party DeepSeek SVG whale as a Braille-cell raster, and projects the composed agent preset, selected model, effective permission preset or approval policy, and workspace. The whale inherits the terminal foreground, so it is black on a light terminal and remains legible on a dark one. The right column lists real Harness entry points and up to two newest sessions from the optional session-query service. Short terminals use a reduced whale, compact status line, and action row. Two quiet rows separate the card from the composer instead of stretching an empty transcript to the bottom of the screen. The card contracts to the ordinary transcript header as soon as the first turn starts. Recent-session rows are informative rather than clickable; `/resume` owns searching and validation.

The prompt is a borderless multiline composer whose horizontal padding and background match every submitted human-message card. Submitted prompts remain visible in the transcript without a `You:` or prompt-glyph label, as well as remaining in the durable Session and editor history. Its guidance changes between idle send hints and running steer/cancel hints, while the first bottom status bar keeps compact token usage, model, and context pressure separate from editable text. A second, centered statistics strip reuses Web's whole-log `sessionStats` projection and token accounting to show turns/steps, summed LLM and tool time, average TTFT, decode throughput, cache hit rate, and billed input/output tokens. Missing facts drop out instead of becoming invented zeros, and a narrow terminal elides the single line rather than wrapping it into the editor. These labels are projections of current services and session events, not independent UI settings.

Codex-shaped developer commands are terminal-native adapters over Harness services. `/skills` browses the current Agent-scoped user-invocable catalog; `/keymap` and `/vim` switch the composer between default editing and Vim Insert/Normal modes; `/fast` selects an actually advertised route whose metadata identifies it as flash, fast, turbo, or lite, and refuses to claim acceleration when none exists. `/experimental` launches the existing fast, Vim, reasoning-visibility, and Loader-reload actions. `/ide` reports the detected terminal host and offers `@` file references or workspace handoff; open-file and selection capture remain unavailable without an IDE bridge. `/approve` grants an active request once or arms exactly one next request matching the latest interactive rejection's tool and reason; a different next request consumes the grant without receiving it, and the command never changes the permission preset.

This package owns interactive terminal presentation and input only. It injects `agents`, [`commands`](../../interaction/commands/README.md), `approval`, `llm`, `systemPrompt`, `tokenMeter`, `tools`, and `userQuestions`, optionally reads `credentials`, `settings`, `skills`, and `workspaceRegistry` services when composed, then drives an agent created or resumed by app or developer code. Agent lifecycle, persistence, approval policy, and the model-facing [`ask_user_question`](../../interaction/tool-ask-user/README.md) tool remain separate composition entries.

After terminal startup succeeds, the package provides the terminal-local `ctx.tui` extension service. A plugin that injects it can call `openOverlay()` with a component factory and constrained layout options; the host exposes the viewport, semantic theme (including terminal-safe DeepSeek `brand` treatment), display-text escaping, redraw, close, and a lifetime signal, but not the pi-tui tree, terminal, focus controller, or overlay handle. Plugin overlays, composer-attached selectors, user questions, and approval requests share one FIFO focus queue even though their placements differ. Each request is an effect of the calling plugin fiber, so unload removes queued work or closes visible work before cleanup settles; terminal shutdown unloads dependents before stopping pi-tui. Overlay state is not logged or replayed. Component code is trusted and may render ANSI styling, but must pass untrusted text through `host.display()`.

The TUI rebuilds resumed history from append-origin session events, renders Markdown responses and reasoning, applies each tool's `presentCall` / `presentResult` intent to terminal, diff, or generic cards, keeps the standing `todo/write` plan above the editor until the next `turn/start`, and presents `ctx.userQuestions` inline. Agent-scoped approval requests use the same modal queue while `ctx.approval` retains policy and the durable audit events. Logged titles, retries, token usage, context pressure, model selection, and compaction markers remain projections of their owning services and session events; a surface replacement never erases already-rendered conversation.

While a turn runs, an animated `Deep diving (<elapsed> • esc to interrupt)` row stays at the live conversation tail and uses the durable `turn/start` time. It is removed when the turn settles; completed steps retain their per-phase timing summary. The right footer continues to show Goal, model, token, context, and queued-session state instead of duplicating the running label.

Markdown responses support headings, emphasis, links, nested and task lists, blockquotes, GFM tables, and fenced code. `diff` and `patch` fences color additions, removals, hunk headers, and file metadata with the same semantic palette as tool diff cards; diff cards group adjacent hunks for one file under a single path with `⋯` separators.

An embedding may provide `TuiRuntime.formatCwd` when its logical workspace label differs from the session's host directory. The override changes only the footer label; tools continue to use the session `cwd`.

Before model output, session events, tool presenters, questions, configuration, or diagnostics reach pi-tui's ANSI-aware renderers or the terminal title, the TUI renders C0 and C1 controls other than line feeds as visible `\xNN` text. Those sources cannot add terminal control sequences; the TUI and pi-tui retain ownership of terminal rendering and styling.

Typing `@` at a token boundary searches files and directories under the session working directory. A bare fuzzy query uses a reusable bounded workspace index; a query containing `/` lists that directory directly, and selecting a folder keeps completion open for descent. Whitespace-bearing paths are inserted as `@"path with spaces"`. Selecting a file inserts only its path and a trailing space: the TUI does not read it, attach hidden context, or replace it with a reference object. When a model-facing `read` tool is registered, the TUI adds one fixed system-prompt instruction telling the model to read an explicit path when its contents are needed.

When optional `ctx.sessionReferenceResolver` is mounted, the same `@` menu also offers metadata-only session candidates, inserts `@[label](dsh-session:<payload>)`, and prepares the selected snapshots before dispatch. Session references remain structured because the model has no filesystem-like tool for retrieving session snapshots later. Preparation disables duplicate submission and restores the editor input on failure. Once preparation finishes, the TUI injects the resolved context and chooses `agent.steer()` or `agent.followup()` from the current status; there is no separate prompt-admission hook.

While the agent is running, ordinary editor submissions call `agent.steer()`; otherwise they call `agent.followup()`. A slash at the start of the submitted line enters `ctx.commands` instead: known commands execute directly, unknown commands produce a warning, and neither path automatically reaches the model. A command producer may explicitly schedule agent work; [`dsh-plan-mode`](../../plan/plan-mode/README.md#model-and-human-interactions) uses that contract for `/plan [message]`. The TUI registers `/help`, `/model`, `/fast`, `/skills`, `/agent`, `/subagents`, `/keymap`, `/vim`, `/experimental`, `/ide`, `/mention`, `/approve`, `/init`, `/review`, `/new`, `/clear`, `/copy`, `/export`, `/diff`, `/details`, `/raw`, `/palette`, `/reload`, `/resume`, `/fork`, `/rename`, `/archive`, `/delete`, `/language`, `/personality`, `/settings`, `/credentials`, `/theme`, `/workspace`, `/status`, `/usage`, `/exit`, and `/quit` as agent-scoped definitions; every other effective command joins autocomplete and `/help` dynamically, as do `/skill:` completions. The shared permission service contributes `/permissions [preset]`. Bare `/permissions` opens a composer-attached selector over the service's current preset table; selecting a row submits the same argued command the Web picker uses, while `/permissions <preset>` remains the direct path. Unattended startup belongs to the shipped app's `deepseek --full-auto` and `deepseek --yolo` flags, so the session command catalog intentionally contains no matching shortcut. The welcome card and footer render the configured display name rather than the storage key. The composer guidance reads `Enter steer · Esc interrupt` while running. Every submitted steering message appears immediately in an ordered preview above the composer and contributes to the footer count until its inbox identity is claimed or discarded; the durable `user/message` then replaces that transient preview with the normal chat card. Escape with pending steering preserves the batch, interrupts the active call, and wakes it for immediate delivery; Escape without pending steering and Ctrl+C retain ordinary cancellation behavior. During a live standalone compaction bracket, a fixed `Context being compacted <elapsed>` row appears above the composer and terminal progress stays active until close. This live state is never reconstructed from the log; a failed close adds `Compaction failed: <error>` to the transcript, while a resumed orphaned start never activates the indicator. Tool cards retain their configurable collapsed head/tail preview, while injected-context cards render zero compact rows. Ctrl+O cycles collapsed, expanded, and hidden detail states: only the expanded state displays injected context, with the source label and full prose after stripping the producer reminder frame. The hidden phase also folds each turn's assistant steps into one message: the first step with visible text or reasoning uses the turn's leading `•`, later steps render as aligned continuations, and a step without a visible body renders nothing; leaving the hidden phase restores per-step bullets. Ctrl+R toggles reasoning, Ctrl+L redraws, and Ctrl+D exits while idle. `/details` names the same state those two shortcuts cycle: bare it opens a composer-attached keyboard toggle with one entry per dimension — `Tool cards` and `Reasoning` — showing the live values, where Tab cycles the highlighted entry and applies the change immediately (the transcript above the editor is the preview), and Enter, Esc, or Ctrl+C closes; `/details collapsed|expanded|hidden` jumps tool cards to that phase directly, and `/details reasoning [on|off]` sets — or bare `reasoning` toggles — reasoning-block display; arguments combine in one invocation, an unknown argument fails with the usage line, and a combined invocation applies reasoning first so its transcript rebuild never drops the card notice.

`/copy` writes the newest transcript-visible assistant response as raw Markdown through OSC 52, including tmux passthrough, and rejects a response larger than 100,000 UTF-8 bytes before encoding. Bare `/export` opens a choice between copying the complete Markdown conversation and preparing an editable default filename; `/export <path>` writes directly relative to the workspace, expands a leading home marker, and never replaces an existing destination. The export preserves direct human and assistant Markdown, paired tool activity, visible reasoning, images, and an open model stream while excluding injected context and model-only replacement events; clipboard export uses the same OSC 52 bound as `/copy`. `/diff` appends the current unstaged Git diff plus a no-index diff for every untracked, non-ignored file. It is read-only: external diff helpers, text conversion, hooks, filesystem monitors, and configured clean/process executables are disabled; `gitDiffTimeoutMs` bounds every Git child. `/mention` inserts `@` and opens workspace completion; `/mention <path>` inserts that path directly. `/rename` restores `/rename ` in the composer for title entry, while `/rename <title>` records the normalized user title through the optional session-title service and immediately updates the terminal title.

`/raw` toggles the conversation between rich cards and copy-friendly unstyled source text; `/raw on`, `/raw off`, and `/raw status` are explicit forms. Raw mode preserves literal human and assistant Markdown, visible reasoning, paired tool activity, and the open model stream while omitting role labels, card backgrounds, bullets, and Markdown styling. It is process-local and does not alter the Session log or exported transcript.

`/new` and `/clear` require an idle agent, flush the current durable session, release the terminal, and ask the shipped process host to start a fresh chat in the same immutable workspace. A missing custom-host handoff or a rejected replacement leaves the current session and terminal usable.

`/fork` is an agent-scoped command that requires an idle agent and durable session persistence. After its command lifecycle settles, it copies the complete current log into a child session with a fresh id and parent link, flushes both sessions, and asks the same process host to switch to the child in the current workspace. If that switch fails, the original terminal remains usable and reports the retained child id for a later `/resume`.

`/agent` and its `/subagents` alias open a composer-attached picker over the live primary Agent and every live descendant returned by `ctx.subagents`. Rows show the durable label, mode, runtime status, current marker, and session id; inactive or unreadable children stay out of the switchable list and can be opened through `/resume`. Selecting another row remounts the same terminal channel on that Agent without stopping either Agent or changing Session logs. The current Agent must be idle before its interaction provider is detached; a selected target may already be running. If the visible child is later disposed, the channel returns to the live primary Agent automatically. Custom renderer embeddings without the navigation host or subagent service report the missing capability instead of displaying synthetic rows.

`/archive` is available only on the idle primary Agent. It opens a confirmation card, flushes the Session, adds its id to the durable workspace archive set, and exits only after the archive write succeeds. Archiving hides the Session from active workspace lists but retains its complete log. `/delete` uses a separate destructive confirmation, permanently removes the current Session log through the persistence service, and exits only after deletion succeeds. Both commands reject child-Agent views and keep the current TUI open when their required storage is unavailable, a write fails, or a turn starts during confirmation.

`/debug-config` reports the active profile, Loader root, and launcher-owned source layers from lowest to highest precedence. It lists paths and environment-switch names but never configuration values; use the printed `deepseek --profile <name> --dump-config` command when the complete boot-free composed tree is required. Custom embeddings that do not provide launcher provenance report that the diagnostic is unavailable.

`/title` configures the terminal window or tab title; it does not rename the durable Session. Bare `/title` opens a multi-select dialog over app name, Session title, workspace, run status, model, reasoning effort, and Session id. Space toggles a field with a live terminal-title preview, Enter persists the catalog-ordered selection in `ui-terminal.titleItems`, and Escape restores the previous title. `/title status`, `/title reset`, and `/title set <item> ...` provide non-interactive inspection, defaults, and explicit ordering. `/rename` remains the command for changing the durable Session title.

`/statusline` configures the compact footer. Bare invocation opens an ordered multi-select dialog: Up/Down selects a row, Left/Right reorders it, Space toggles it with a live preview, Enter persists `ui-terminal.statusLineItems`, and Escape restores the prior footer. Available fields cover Goal, details, run state, model, reasoning effort, token and context use, queued work, preset, permissions, workspace, Git branch, Session title, and Session id; unavailable values are omitted. `/statusline status`, `/statusline off`, `/statusline reset`, and `/statusline set <item> ...` support scripts. Reset restores the active profile's `theme.rightPrompt` rather than manufacturing a second default.

`/init` schedules an ordinary user turn that inspects the repository and creates a concise, fact-based `AGENTS.md` only when the current directory does not already have one. `/review [instructions]` schedules a non-mutating review of tracked and untracked workspace changes, ordered by finding severity. Both commands require an idle agent, and their prompts follow the normal durable user-message path rather than bypassing the agent loop.

The shared [`dsh-command-jobs`](../../jobs/command-jobs/README.md) plugin contributes `/ps`, `/stop`, and the `/clean` alias. `/ps` lists this session's running or stopping generic background jobs without consuming output; `/stop` and `/clean` request cancellation of every running job and leave an already stopping job alone.

`/model`, Alt+M, or a left click on the model badge beside the editor opens the advisory `ctx.llm` catalog immediately below the composer rather than in the center of the terminal. A filter box above the list narrows rows by a case-insensitive substring over each row's `provider/model` label, model name, and description, keeping the highlighted row selected when it survives the filter. Up/Down or the mouse wheel moves between models. A dedicated `Reasoning effort` row always renders the exact levels advertised for the highlighted model—including `Off` when present—and brackets the selected level; Tab or Right moves forward and Shift+Tab or Left moves backward. Enter selects the visible model-and-effort pair, while Escape clears a non-empty filter before a second Escape closes the selector. When an adapter does not advertise a default effort, the row also includes `Default`, which clears an explicit selection and preserves provider behavior; a model without reasoning metadata reports `Not available`. The selector does not synthesize, clamp, or transfer an effort between models. `/model <model>` still selects an unambiguous model id directly, while `/model <provider>/<model>` selects an exact target and uses its adapter default when one exists. The configured target or latest logged request header initializes the selector, and an unlisted current model remains visible because catalogs are advisory. Selection is local to this TUI session. Prompt assembly snapshots the target for one step, replaces `{{provider}}` and `{{model}}`, and applies the same provider/model/reasoning-effort target through `agent/request`; a switch during assembly therefore starts with a later step. The request header durably records targets that reach the model, while an unused selection remains process-local.

`/model off`, `/model high`, and `/model max` directly select that advertised effort for the current route. An unavailable level reports the catalog limitation without changing the selection.

`/mcp [verbose]` lists the MCP-qualified tools visible through the current Agent's scoped tool registry. The default view prints stable public tool names; `verbose` also prints their normalized descriptions. It does not expose unrelated tools or infer server connection state that the tool registry does not own.

`/reload` (EXPERIMENTAL, dev-only) re-reads every file-backed loader config tree and applies the diff to the running app — the HMR watcher's config path, invoked manually; it needs the cordis Loader in the context and degrades to a warning without one, runs only while the agent is idle, and refuses re-entry while a reload is in flight. Module-source hot reload remains watcher-owned. When a `skills` service is mounted, `/skill:<name> [instructions]` loads that skill's instructions into the conversation as a user turn; autocomplete lists user-invocable skills, and exact invocation rejects a skill whose user policy disables it.

The default compact footer shows Goal/details state, current model, `↑<uncached input> ↓<output>`, known token-meter context pressure, and queued work on the right. Its left side is empty, so the working directory and branch do not consume chat width until selected through `/statusline` or configured through `theme.leftPrompt`. The default also omits idle state and cache rate: live work is shown by the animated conversation-tail status, while cache hit rate remains in the detailed session-statistics row.

`/status` adds a point-in-time diagnostics card to the transcript and remains available while the agent runs. It reports the session id, title, working directory, selected provider/model, selected reasoning effort or default behavior, reasoning-block visibility, agent state, event/turn/step/tool-call counts, exact input/output/cache token buckets, KV-cache hit rate, token-meter context use and capacity, creation time, and latest event time. Missing titles, models, cache input, or context capacity are labeled instead of inferred. The card is terminal-only, does not duplicate the compact footer, and does not print the system prompt or registered-tool catalog.

`/usage` records a point-in-time copy of the same whole-session statistics line shared with the Web composer: completed turns and steps, LLM and tool time, average TTFT, decode throughput, cache-hit rate, and disjoint input/output token totals. DeepSeek Harness does not expose a provider account-quota service, so this command reports measured session usage rather than inventing account limits or reset dates.

When the selected DeepSeek route has no `DEEPSEEK_API_KEY`, first use opens a masked composer-attached prompt. The raw key never enters the editor, command arguments, Session log, transcript, or input history; Enter sends it directly to the shared `ctx.credentials` provider and Escape skips the prompt for that launch. `/credentials [status|set|unset]` reports only configured state, source, and writability, accepts new values only through the same masked prompt, and removes only the provider-managed saved value. An inherited environment value remains read-only inside the TUI.

`/settings` is a terminal hub over the shared optional `ctx.settings` provider. Bare `/settings` shows the file-backed document plus every registered namespace as redacted metadata (live/restart scope, inherited/user override, and hidden-secret count); `/settings list` prints the same namespace summary and `/settings document` prepares and reports the editable document path. It deliberately does not clone the Web React forms or write a complete redacted section back, because replacing such a section could erase stored secrets. `/theme [deepseek|light|dark|system] [id]` is the terminal-safe live action: it field-mutates the same `ui-theme.preference` namespace the Web client uses, follows external settings updates, and resolves `system` through the terminal color-scheme report. Bare `/theme` opens one combined selector instead of separate Appearance and Accent menus.

`/personality` opens the Friendly and Pragmatic communication-style selector adapted from Codex. Friendly is warm and collaborative; Pragmatic is concise and task-focused. The selection persists as `agent-personality.preference`, applies to the next model request through the scoped system-prompt registry, and follows external settings updates. `/personality friendly`, `/personality pragmatic`, and `/personality status` provide direct forms.

The unified picker presents one `DeepSeek` system-default row, then `Light ·` and `Dark ·` cards for every shipped hue. Selecting a card commits its appearance and hue together; each background still remembers its inactive choice in the TUI-owned `ui-accent` section. The active theme repaints the prompt, borders, role headers, selection, zero-state welcome dashboard, composer, and submitted user cards even when the terminal does not answer a background-color query. Only the composer and submitted user cards receive a background fill; the welcome dashboard keeps the terminal background. Card surfaces use exact 24-bit backgrounds when supported and xterm 256-color backgrounds otherwise. On truecolor terminals the startup banner and brand ink also use a per-background ink — bright stops for dark terminals, deep stops for light terminals — while foreground roles retain their theme-adaptive ANSI fallback.

`/language [en|zh|ar|fr|ru|es|ja|ko]` writes the shared `locale.preference` setting and offers English, Chinese, Arabic, French, Russian, Spanish, Japanese, and Korean terminal copy. Bare `/language` opens the composer-attached selector; TUI changes refresh the welcome dashboard, default composer placeholder, editor footer, live-turn row, and Settings surfaces immediately. The browser applies shared English or Chinese selections and follows its browser-derived language when the stored preference is terminal-only. Model output, tool payloads, custom placeholders, and third-party command copy remain source-authored rather than being machine-translated.

`/workspace` opens a searchable selector over the shared durable `ctx.workspaceRegistry`; `/workspace <directory>` canonicalizes and registers that directory first. Choosing a row starts a **fresh** session in that workspace through the optional host-owned `TuiRuntime.handoffWorkspace`. The controller requires an idle agent, checks the directory, flushes the current session, drains input, and releases the UI plus full-screen/mouse terminal modes before handoff. A missing host leaves the current TUI running with a warning; a rejected host restores the terminal and forces a complete frame. It never rewrites the current session's immutable `SessionHeader.cwd` — changing workspace is a process/session handoff, not an in-place metadata mutation.

Bare `/resume` opens a full-viewport keyboard selector instead of a centered dialog, while `/resume <session>` runs the same liveness, log, model-route, and workspace preflight against that exact persisted id without opening the selector. The selector opens as soon as the command runs and takes input focus while the session scan is still pending, showing a loading placeholder until the rows arrive; Escape cancels an in-flight scan the same way it cancels the loaded list. Two scopes cover the same candidate set: the current workspace, which it opens on, and all workspaces, which Tab toggles to. The scope line under the search field names the active scope and the count the other holds, and each row in the all-workspaces scope also reports its own workspace. Toggling clears the search and selection so the highlighted row always belongs to the visible list.

Its focused search field starts immediately after the search glyph and emits pi-tui's cursor marker, so terminal IME composition remains anchored inside the field. Rows read no whole logs: when the optional projection cache is mounted, titles come from the live projection registry or the durable checkpoint row, with a cold read folding only the log tail since the checkpoint (written back so the next scan is zero-I/O, bounded by `resumeScanConcurrency`); a composition without the cache falls back to one bounded batch title read over the logs. Candidates are sorted by metadata activity — a live session's last in-memory event time, otherwise the persisted artifact's mtime, falling back to creation time — and searchable by title or session id, and by workspace label in the all-workspaces scope; each row reports that timestamp plus current/live/persisted state and the id. Up/Down and Page Up/Page Down navigate, Enter resumes, Escape clears a non-empty search before a second Escape cancels, and Ctrl+C cancels directly. The current session, a session already live in this runtime, an unreadable log, or a session with no recorded workspace to run in remains visible but disabled; a workspace other than the current one is a scope rather than a disabled reason, because resume enters that directory.

Selection repeats those checks, fully reads and replay-validates the one chosen log, rejects it when its logged provider has no current adapter, and requires the current agent to be idle. Without the optional host-owned `TuiRuntime.handoffResume`, the selector closes and warns without stopping the current TUI. The shipped `dsh tui` host supplies both resume and fresh-workspace handoffs; custom embeddings may remain resume-only or supply neither. A host receives the selected id and workspace after the current session is flushed and the terminal UI stops; process cwd, not the restored session header, is what filesystem and shell tools resolve against, so the host must enter that directory before replacing the process. A completed handoff restores the same `SessionId`, transcript, title, todos, durable goal, and recorded agent preset; goal activation remains disarmed and the TUI asks for human confirmation or `/goal resume`.

The exit line is launcher-owned, not configurable. A launcher provides `TUI_GOODBYE_MESSAGE_KEY` on the boot context — for the shipped `dsh`, the command that resumes this session — and exiting prints it verbatim after the terminal is released; absent, exiting prints nothing. Only the launcher knows how it was invoked, so only it can name a command that works. The TUI escapes terminal controls before rendering and never executes the text. A launcher that also supplies `MAIN_SESSION_ID_KEY` fixes which session the mounted app binds to, so resume survives any config-level patch.

An embedding can seed a session by setting the direct renderer's `initialSkill` config or providing `INITIAL_SKILL_KEY` on the boot context. Once the chat is live, the TUI auto-invokes that skill exactly as a typed `/skill:<name>`; the embedding must omit it on resumed sessions when it wants fresh-session-only behavior. The shipped `dsh tui` launcher sets no initial skill, and an unknown name is reported as a notice.

Reasoning is visible on first render under the `Think` label. Submitted human cards stay in the compact transcript, while injected context and session metadata occupy no rows. Expanding details renders the injected-context source and full prose after removing its producer reminder frame. With `mouse: true`, the footer's clickable `▸` glyph expands context and tool cards together and changes to `▾`; Ctrl+O, Ctrl+R, and `/details` remain the keyboard and command equivalents.

## Config

`TuiConfig` is the presentation schema accepted by the shipped bundle's `tui-runner` row and by the direct renderer. The direct `@deepseek-ai/dsh-tui` plugin's full `Config` adds `sessionId` and `initialSkill`; the bundle runner deliberately exposes only `TuiConfig`, while `tuiStartup` owns its session identity and the shipped launcher supplies no initial skill.

| Key | Scope | Default | Meaning |
|---|---|---|---|
| `sessionId` | direct renderer only | `main` | Exact shared agent/session identity driven by the terminal |
| `initialSkill` | direct renderer only | — | Skill auto-invoked once the chat is live |
| `fullscreen` | `TuiConfig` | `false` | Use a bounded alternate screen instead of terminal-native scrollback |
| `mouse` | `TuiConfig` | `false` | Capture wheel and click input in full-screen mode; disabled leaves drag selection to the terminal |
| `showReasoning` | `TuiConfig` | `true` | Render reasoning blocks initially under the `Think` label; toggle through details |
| `maxToolOutputLines` | `TuiConfig` | `6` | Output lines retained across a collapsed tool card's head/tail preview |
| `maxDiffEditLength` | `TuiConfig` | `1000` | Maximum added and removed lines explored for an exact diff before whole-side fallback |
| `gitDiffTimeoutMs` | `TuiConfig` | `30000` | Maximum lifetime of each read-only Git child used by `/diff` |
| `maxQuestionOptions` | `TuiConfig` | `8` | Maximum option blocks visible at once; the row bound may reduce this further |
| `maxModelOptions` | `TuiConfig` | `8` | Visible models in the model selector |
| `maxResumeOptions` | `TuiConfig` | `8` | Visible sessions in the resume selector |
| `resumeScanConcurrency` | `TuiConfig` | `4` | Maximum concurrent cold projection reads during one resume scan |
| `questionDialogWidth` | `TuiConfig` | `200` | Question-panel width in columns, clamped to the terminal |
| `questionDialogMaxHeight` | `TuiConfig` | `20` | Maximum question-panel rows, further bounded to retain the editor |
| `modelDialogWidth` | `TuiConfig` | `76` | Model-selector width in columns |
| `modelDialogMaxHeight` | `TuiConfig` | `20` | Model-selector maximum rows |
| `detailsDialogWidth` | `TuiConfig` | `72` | Transcript-details selector width in columns |
| `fileSearchMaxResults` | `TuiConfig` | `20` | Maximum file and directory candidates shown for one `@` query |
| `fileSearchMaxEntries` | `TuiConfig` | `10000` | Maximum paths retained in the bounded workspace index used by bare fuzzy queries |
| `fileSearchExcludedDirectories` | `TuiConfig` | `['.git', 'node_modules']` | Directory basenames omitted from traversal and direct completion |
| `showHardwareCursor` | `TuiConfig` | `true` | Show the focused editor's software-blinking caret while retaining pi-tui's IME marker |
| `theme.color` | `TuiConfig` | `true` | Apply the built-in ANSI palette (see [Color](#color)) |
| `theme.truecolor` | `TuiConfig` | process entry detects `COLORTERM`; direct runtime calls use `false` | Enable the 24-bit startup gradient and DeepSeek brand ink |
| `theme.leftPrompt` | `TuiConfig` | empty | Optional left-aligned bottom status template; workspace and branch stay hidden by default |
| `theme.rightPrompt` | `TuiConfig` | `${goal}${details}${model}${token_meter/usage}${context}${queued}` | Right-aligned bottom status template used until `/statusline` stores an override |
| `theme.inputPrompt` | `TuiConfig` | `${indicator}` | Editor first-line prefix template |
| `theme.inputPlaceholder` | `TuiConfig` | `Describe a task, @ a file, or / for commands` | Empty-editor placeholder |
| `title` | `TuiConfig` | `DeepSeek Harness` | Product suffix for the terminal window title |

Patch the shipped profile's existing runner row for presentation settings:

```yaml
# Shipped tui profile: presentation-only TuiConfig.
- id: tui-runner
  config:
    showReasoning: true
    theme:
      color: false
```

A direct renderer composition may additionally choose its session identity and startup skill:

```yaml
# Direct renderer: full Config extends TuiConfig.
- id: terminal
  name: '@deepseek-ai/dsh-tui'
  config:
    sessionId: main-session-123
    initialSkill: onboarding
    theme:
      color: true
```

Both process entries reject a non-TTY stdin or stdout before claiming the terminal. The shipped runner creates or resumes its exact Agent after Loader settlement and then mounts the renderer onto that existing root. A direct composition can mount before a config-created Agent to observe `agent-loop/config-start-failed`; `mountTui` also checks for an already-existing matching root after installing its listeners. Disposal stops extension admission, unloads the `ctx.tui` provider and its dependent plugins, aborts running commands, removes the TUI definitions, stops loaders, rejects pending questions, drains terminal input, restores terminal state, unregisters event listeners and the user-interaction provider, and never exits a replacement process during HMR. A user exit disposes the application root so sibling resources close, then exits; a five-second fallback prevents one stuck disposer from trapping the process.

## Color

Every general-purpose SGR code the TUI emits lives in one table, `paletteSpec` in `components/theme.ts`, which `createPalette` derives its wrappers from and `/palette` prints. The table holds only standard 16-color ANSI foregrounds and SGR attributes, which terminals remap to their active color scheme. The startup banner gradient, the exact accent ink, and the official Web composer surfaces are deliberate truecolor exceptions. Body text keeps the terminal's default foreground rather than a fixed shade.

There is one role per visual meaning: `dim` is the single recessed tone, `accent` is the active accent hue's ANSI fallback (bright blue for the default `deepseek` accent), and `brand` is that hue's standard-ANSI fallback, while `success` and `error` double as a diff's added and removed lines. Colors and attributes are separately typed, so `bold(accent(x))` compiles and `accent(error(x))` does not — SGR has no color stack, so nesting one color inside another silently drops the outer color at the inner one's close. Attributes occupy independent SGR groups and compose with any color in either order. Run `/palette` to see every role as your terminal renders it, with its SGR pair.

The theme hue is selectable through `/theme`: `deepseek` (default), `cosmic-orange`, `mist-blue`, `sage`, `lavender`, and `deep-blue`, with the iPhone finishes sampled from Apple's published CSS. Each hue pairs a truecolor 24-bit ink for the accent role and banner gradient with an ANSI 16-color fallback for non-truecolor terminals; the truecolor ink splits per background, so the chrome stays theme-adaptive either way.

Human prompts render as padded, label-free cards. The default DeepSeek theme keeps the Web theme's exact `deepseek-50` (`#EDF3FE`) user-bubble token in light mode and `neutral-bluish-850` (`#2C2C2E`) in dark mode; other theme hues softly tint both the card and active composer from their matching ink. Assistant replies omit a role header and use a dim `•` with aligned continuation lines; visible reasoning starts with `Think`. Tool status remains in the colored, underlined title glyph and title, while the whole tool body and expanded injected context use one dim tone. Diff cards color and count exact added `+` and removed `-` lines while leaving unchanged context dim and uncounted; comparisons beyond `maxDiffEditLength` use the documented whole-side fallback. The question panel uses bold accent text for its active row and selectors use reverse video. Apart from the human-card and composer surfaces, these treatments are foreground-only. Set `theme.color: false` to strip styling and background surfaces.

## Model Experience

### Interactive prompt input

#### What the model sees

Each non-empty ordinary editor submission becomes one text block, sent with `agent.followup()` while the target agent is idle and `agent.steer()` while it is running. A session mention becomes readable `@label` text plus the durable untrusted context defined by [`dsh-session-reference`](../../context/session-reference/README.md); its full JSON is hidden behind a compact reference card. Slash commands and keybindings are TUI-only; command results remain terminal notices. A command producer may schedule a separate agent input, such as the optional message accepted by `/plan [message]`.

#### Token effect

Submitted text is retained under the agent loop's normal session-history and compaction rules. Headers, the logged title, cards, Markdown rendering, status lines, plans, and help text add no tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### File-reference autocomplete

#### What the model sees

A selected file remains ordinary user text such as `@src/index.ts` or `@"docs/design notes.md"`; autocomplete adds no content block, durable context, or special reference payload. When `read` is registered, every request from this TUI agent also contains the following fixed system-prompt section. The model decides whether the task requires the file contents and calls `read` through the normal tool loop when it does; a path alone is not evidence that the file was inspected.

##### Exact system-prompt text

```markdown
Paths prefixed with @ are files explicitly referenced by the user. Use the read tool when their contents are needed; do not claim to have inspected a file before reading it.
```

#### Token effect

Autocomplete itself adds no tokens. The selected path contributes only its ordinary user-text tokens; the fixed instruction contributes system-prompt tokens whenever `read` is available. File contents consume context only after a model-selected `read` call returns them.

#### KV Cache effect

The fixed instruction is part of the stable system-prompt prefix and is reusable across turns. Each selected path is append-only user text; a later `read` result appends the requested contents through the ordinary tool transcript.

### Session model selection

#### What the model sees

The `/model` command text and keyboard-selector input are not logged or sent. New steps receive the selected provider/model route in prompt variables and the selected provider/model/reasoning-effort target in request routing.

#### Token effect

The selector adds no messages. A target change may alter interpolated system-prompt text and sends subsequent requests to the selected model.

#### KV Cache effect

Changing provider or model enters that target's cache domain; no cache reuse across distinct targets is assumed.

### Manual skill invocation

#### What the model sees

A `/skill:<name> [instructions]` submission loads the named skill and delivers one text block: a `<skill name="…">` element wrapping the skill's instructions — preceded, when the provider exposes a resource base, by a line locating the skill's relative resources — followed by any trailing instructions the user typed. Delivery follows the same followup-while-idle / steer-while-running rule as ordinary input. The command, not the model, chooses the skill: autocomplete and exact invocation apply `invocation.userInvocable`, while `invocation.modelInvocable` does not restrict this surface. User-disabled skills are omitted from autocomplete and rejected before exact-name loading; the loaded definition is rechecked for a policy race. Autocomplete retains its last complete skill snapshot and refetches after `skills/change`; an incomplete observation preserves the prior menu, a complete empty observation clears it, and a catalog arriving while a slash-name draft is open immediately re-queries that draft. The skill service is an optional peer; this policy check uses its type contract without introducing a runtime package dependency.

#### Token effect

The rendered skill block and trailing instructions are retained as one user turn under the agent loop's normal session-history and compaction rules; a repeated invocation appends the body again.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Interactive user-question answers

#### What the model sees

When a consumer calls `ctx.userQuestions.ask()`, this provider presents each question in order and returns selected option labels, `custom` text, or both for a multi-select question. Pending custom text survives switching back to options and joins checked labels on a later options-mode submit. Abort, cancellation, or UI disposal becomes a typed `UserQuestionError`; `dsh-tool-ask-user` translates that outcome into the tool result seen by the model.

#### Token effect

Waiting and terminal overlays add no tokens; the resolved answer or error is model-visible only through the calling tool or plugin's result.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool approval decisions

#### What the model sees

For the exact mounted agent, the TUI answers `approval/request` with `allowed-once`, `rejected`, or `cancelled`. It does not evaluate policy or execute the tool. `ctx.approval` remains authoritative and records the durable `approval/asked` / `approval/decided` pair; the model observes only the normal tool continuation or rejection produced by that owner.

#### Token effect

The modal itself adds no tokens. Any rejection or cancellation text enters context only through the owning tool/runtime result.

#### KV Cache effect

None until the owning runtime appends a tool result; that result follows the reusable prefix through the ordinary append-only tool transcript.

## Known Limitations and Deferred Work

- **Resume has no cross-process session lock** — the selector rejects sessions known to be live in its own runtime, but another process can resume the same persisted id before or during handoff. The all-workspaces scope makes this reachable in one step, since a session another host is driving in a different directory is now selectable. Deployments that can run concurrent hosts must coordinate ownership outside the TUI.
- **One bound session owns the transcript and editor** — questions from other agents can still use the shared overlay provider, but session rendering and prompt input remain bound to the direct renderer's `sessionId` or the bundle runner's `tuiStartup.identity`.
- **Tool cards are text terminal presentations** — terminal, diff, and generic cards use tool-owned titles/content, but session content currently has no image block for inline image rendering.
- **Markdown is terminal-native rather than browser-identical** — TeX stays literal instead of using KaTeX, Markdown images retain text instead of fetching remote content, and ordinary programming-language fences use one code tone instead of Shiki token highlighting. `diff` and `patch` fences retain semantic line coloring.
- **Non-TTY operation is intentionally unsupported** — use the shipped `headless` profile or another server front door for pipes and automation rather than expecting an internal fallback.
- **Manual `/skill:` invocation always reloads the full skill body** — the TUI does not detect a skill already present in the conversation, so repeated invocations append its instructions again.
- **File discovery is host-workspace discovery** — autocomplete reads the TUI process's session `cwd`, while the selected text is later interpreted by the configured `read` tool. Deployments that mount a remote or virtual filesystem must keep those namespaces aligned or provide another completion surface.
- **File search uses explicit directory exclusions, not ignore files** — `.git` and `node_modules` are excluded by default and deployments may configure more basenames, but `.gitignore` and `.ignore` are not interpreted. Directory symlinks are not traversed.
