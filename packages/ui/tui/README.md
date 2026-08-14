# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

The interactive terminal front door for DeepSeek Harness agents, built on [`@earendil-works/pi-tui`](https://www.npmjs.com/package/@earendil-works/pi-tui). It requires stdin and stdout TTYs; scripts and Loader pipes should use the one-shot [`@deepseek-ai/dsh-headless`](../../bundle/headless/README.md) profile instead.

The implemented [shipped TUI CLI Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-shipped-tui-cli-front-door.md) owns the front-door, composition, compatibility, provenance, and verification decisions.

Interactive terminals on macOS, Linux, and Windows are supported. Windows uses pi-tui's native console VT-input handling and ConPTY process verification.

The renderer uses the alternate screen by default, so the conversation, overlays, and growing multiline editor occupy one full terminal viewport and the previous shell screen returns on exit. Ordinary built-in selectors are composer-attached: the framed editor remains visible, the selected command's panel opens immediately below it, and the status lines remain below the panel instead of a modal covering the middle of the conversation. Slash-command, skill, workspace-file, and session-reference autocomplete use that same flow: the complete editor frame closes first, then the candidate list renders on the following rows instead of inside the border. The root `/` catalog remains command-only; concrete skill rows are nested under the explicit `/skill:` prefix or the `/skills` browser. Approval requests and structured user questions remain modal because they interrupt execution and require an explicit answer; `/resume` retains its purpose-built full-viewport browser. The focused editor retains pi-tui's hardware cursor marker as the terminal IME anchor and alternates a one-cell software caret every 530 ms, so focus stays visible even when the terminal profile disables or ignores cursor blinking. A click or keystroke restarts the visible phase. Shift/Alt+Enter inserts a newline, bracketed paste retains multiline content, and `@` completion remains available at every cursor position. Page Up/Down or the mouse wheel scrolls the transcript; reaching the newest page resumes following live output. Application mouse tracking also makes the model badge and footer disclosure glyph clickable and lets the wheel navigate an open selector or autocomplete list. Hold the terminal's selection modifier (normally Shift) when selecting text for the clipboard. `fullscreen: false` restores inline scrollback rendering and leaves mouse handling to the terminal.

A fresh, empty session opens on an adaptive, Claude Code-inspired split welcome card without copying Claude product text or assets. Its title includes the base package version, while its left column says welcome, renders the repository's first-party DeepSeek SVG whale as a Braille-cell raster, and projects the composed agent preset, selected model, effective permission preset or approval policy, and workspace. The whale inherits the terminal foreground, so it is black on a light terminal and remains legible on a dark one. The right column lists real Harness entry points and up to two newest sessions from the optional session-query service. Short terminals use a reduced whale, compact status line, and action row. Two quiet rows separate the card from the composer instead of stretching an empty transcript to the bottom of the screen. The card contracts to the ordinary transcript header as soon as the first turn starts. Recent-session rows are informative rather than clickable; `/resume` owns searching and validation.

The prompt is a full-width framed multiline editor. Its footer changes between idle send hints and running steer/cancel hints, while the first bottom status bar keeps workspace, branch, compact token usage, agent state, model, and context pressure separate from editable text. A second, centered statistics strip reuses Web's whole-log `sessionStats` projection and token accounting to show turns/steps, summed LLM and tool time, average TTFT, decode throughput, cache hit rate, and billed input/output tokens. Missing facts drop out instead of becoming invented zeros, and a narrow terminal elides the single line rather than wrapping it into the editor. These labels are projections of current services and session events, not independent UI settings.

Codex-shaped developer commands are terminal-native adapters over Harness services. `/skills` browses the current Agent-scoped user-invocable catalog; `/keymap` and `/vim` switch the composer between default editing and Vim Insert/Normal modes; `/fast` selects an actually advertised route whose metadata identifies it as flash, fast, turbo, or lite, and refuses to claim acceleration when none exists. `/experimental` launches the existing fast, Vim, reasoning-visibility, and Loader-reload actions. `/ide` reports the detected terminal host and offers `@` file references or workspace handoff; open-file and selection capture remain unavailable without an IDE bridge. `/approve` grants an active request once or arms exactly one next request matching the latest interactive rejection's tool and reason; a different next request consumes the grant without receiving it, and the command never changes the permission preset.

This package owns interactive terminal presentation and input only. It injects `agents`, [`commands`](../../interaction/commands/README.md), `approval`, `llm`, `systemPrompt`, `tokenMeter`, `tools`, and `userQuestions`, optionally reads `settings`, `skills`, and `workspaceRegistry` services when composed, then drives an agent created or resumed by app or developer code. Agent lifecycle, persistence, approval policy, and the model-facing [`ask_user_question`](../../interaction/tool-ask-user/README.md) tool remain separate composition entries.

After terminal startup succeeds, the package provides the terminal-local `ctx.tui` extension service. A plugin that injects it can call `openOverlay()` with a component factory and constrained layout options; the host exposes the viewport, semantic theme (including terminal-safe DeepSeek `brand` treatment), display-text escaping, redraw, close, and a lifetime signal, but not the pi-tui tree, terminal, focus controller, or overlay handle. Plugin overlays, composer-attached selectors, user questions, and approval requests share one FIFO focus queue even though their placements differ. Each request is an effect of the calling plugin fiber, so unload removes queued work or closes visible work before cleanup settles; terminal shutdown unloads dependents before stopping pi-tui. Overlay state is not logged or replayed. Component code is trusted and may render ANSI styling, but must pass untrusted text through `host.display()`.

The TUI rebuilds resumed history from the append-origin session events, renders Markdown responses and reasoning, applies each tool's `presentCall` / `presentResult` intent to terminal, diff, or generic cards, keeps the standing `todo/write` plan above the editor (cleared on the next `turn/start`), and presents `ctx.userQuestions` questions inline between the transcript/status area and the editor. The question panel shows progress, numbered options, wrapped labels, and separately indented descriptions; it obeys both `maxQuestionOptions` and `questionDialogMaxHeight`, marks hidden options with `↑ N more` / `↓ N more`, and uses Page Up / Page Down to page long question/detail content before an individually oversized selected block while keeping the editor visible. Agent-scoped approval requests use the same modal queue but remain an answerer only: `ctx.approval` owns policy and durable `approval/asked` / `approval/decided` audit events. The latest logged session title becomes the header subtitle, with `welcome` before a title exists, and the terminal window title becomes `<session title> — <configured title>`. A durable `llm/retry` event retracts the failed step's live chunks and renders the scheduled retry count, delay, and failure in the transcript; success, exhaustion, and cancellation then settle through ordinary session events. The footer totals each logged model step's usage once, including failed attempts, while treating committed-message usage as a fallback for logs without a usage chunk. Its idle view compares token-meter pressure with `ctx.llm.resolveModelInfo()` context for the current route, displays `context unknown` when the adapter has no capacity metadata, and also shows tool-card mode plus the current model and any explicitly selected reasoning effort; while the agent runs, an elapsed working indicator and `esc interrupt` replace that summary. A surface replacement never rewrites the rendered transcript: the conversation it shadows stays readable, and a landed compaction checkpoint adds one dim `… earlier context was compacted …` marker at its log position, so the terminal reports where the model stopped seeing that history instead of erasing it. Model-only replacement copies — a pruned tool result, a regenerated assistant message — render nothing.

Markdown responses support headings, emphasis, links, nested and task lists, blockquotes, GFM tables, and fenced code. `diff` and `patch` fences color additions, removals, hunk headers, and file metadata with the same semantic palette as tool diff cards; diff cards group adjacent hunks for one file under a single path with `⋯` separators.

An embedding may provide `TuiRuntime.formatCwd` when its logical workspace label differs from the session's host directory. The override changes only the footer label; tools continue to use the session `cwd`.

Before model output, session events, tool presenters, questions, configuration, or diagnostics reach pi-tui's ANSI-aware renderers or the terminal title, the TUI renders C0 and C1 controls other than line feeds as visible `\xNN` text. Those sources cannot add terminal control sequences; the TUI and pi-tui retain ownership of terminal rendering and styling.

Typing `@` at a token boundary searches files and directories under the session working directory. A bare fuzzy query uses a reusable bounded workspace index; a query containing `/` lists that directory directly, and selecting a folder keeps completion open for descent. Whitespace-bearing paths are inserted as `@"path with spaces"`. Selecting a file inserts only its path and a trailing space: the TUI does not read it, attach hidden context, or replace it with a reference object. When a model-facing `read` tool is registered, the TUI adds one fixed system-prompt instruction telling the model to read an explicit path when its contents are needed.

When optional `ctx.sessionReferenceResolver` is mounted, the same `@` menu also offers metadata-only session candidates, inserts `@[label](dsh-session:<payload>)`, and prepares the selected snapshots before dispatch. Session references remain structured because the model has no filesystem-like tool for retrieving session snapshots later. Preparation disables duplicate submission and restores the editor input on failure. Once preparation finishes, the TUI injects the resolved context and chooses `agent.steer()` or `agent.followup()` from the current status; there is no separate prompt-admission hook.

While the agent is running, ordinary editor submissions call `agent.steer()`; otherwise they call `agent.followup()`. A slash at the start of the submitted line enters `ctx.commands` instead: known commands execute directly, unknown commands produce a warning, and neither path automatically reaches the model. A command producer may explicitly schedule agent work; [`dsh-plan-mode`](../../plan/plan-mode/README.md#model-and-human-interactions) uses that contract for `/plan [message]`. The TUI registers `/help`, `/model`, `/clear`, `/details`, `/palette`, `/reload`, `/resume`, `/settings`, `/theme`, `/workspace`, `/status`, and `/exit` as agent-scoped definitions; every other effective command joins autocomplete and `/help` dynamically, as do `/skill:` completions. The shared permission service contributes `/permissions [preset]` and the Codex-inspired `/yolo` shortcut. Bare `/permissions` opens a composer-attached selector over the service's current preset table; selecting a row submits the same argued command the Web picker uses, while `/permissions <preset>` remains the direct path. The welcome card and footer render the configured display name rather than the storage key. `/yolo` is deliberately immediate: submitting that exact command selects the configured `danger-full-access + never` entry, displays a danger notice, and prints the command that restores the previous selectable preset. The bottom status bar reports the turn phase derived from session events — waiting for the first token, thinking, responding, or executing tools — with elapsed time and the running step total, refreshed each second. The editor frame carries `Enter steer · Esc cancel` while running; queued steering appears in the status bar until each message drains. During a live standalone compaction bracket, a fixed `Context being compacted <elapsed>` row appears above the prompt, the idle prompt caret becomes a one-cell throbbing `⊙`, and terminal progress stays active until close; the row and glyph share the bracket's one refresh timer. This live state is never reconstructed from the log; a failed close adds `Compaction failed: <error>` to the transcript, while a resumed orphaned start never activates the indicator. Ctrl+C or Escape cancels a running turn. Tool and injected-context cards collapse long bodies into a configurable head/tail preview; Ctrl+O cycles tool cards through collapsed preview, full output, and hidden — the hidden phase drops tool cards from the transcript entirely while context cards stay at their preview, since injected instructions are not tool traffic. The hidden phase also folds each turn's assistant steps into one message: the first step with visible text or reasoning keeps the turn's single `Assistant` header, later steps render as headerless continuations, and a step without a visible body renders nothing; leaving the hidden phase restores the per-step headers. An injected-context card renders its message as prose with the producer's outer reminder frame stripped, so neither the fold nor the frame stripping depends on the payload's syntax. Ctrl+R toggles reasoning, Ctrl+L redraws, and Ctrl+D exits while idle. `/details` names the same state those two shortcuts cycle: bare it opens a composer-attached keyboard toggle with one entry per dimension — `Tool cards` and `Reasoning` — showing the live values, where Tab cycles the highlighted entry and applies the change immediately (the transcript above the editor is the preview), and Enter, Esc, or Ctrl+C closes; `/details collapsed|expanded|hidden` jumps tool cards to that phase directly, and `/details reasoning [on|off]` sets — or bare `reasoning` toggles — reasoning-block display; arguments combine in one invocation, an unknown argument fails with the usage line, and a combined invocation applies reasoning first so its transcript rebuild never drops the card notice.

`/model`, Alt+M, or a left click on the model badge beside the editor opens the advisory `ctx.llm` catalog immediately below the framed editor rather than in the center of the terminal. A filter box above the list narrows rows by a case-insensitive substring over each row's `provider/model` label, model name, and description, keeping the highlighted row selected when it survives the filter. Up/Down or the mouse wheel moves between models. A dedicated `Reasoning effort` row always renders the exact levels advertised for the highlighted model—including `Off` when present—and brackets the selected level; Tab or Right moves forward and Shift+Tab or Left moves backward. Enter selects the visible model-and-effort pair, while Escape clears a non-empty filter before a second Escape closes the selector. When an adapter does not advertise a default effort, the row also includes `Default`, which clears an explicit selection and preserves provider behavior; a model without reasoning metadata reports `Not available`. The selector does not synthesize, clamp, or transfer an effort between models. `/model <model>` still selects an unambiguous model id directly, while `/model <provider>/<model>` selects an exact target and uses its adapter default when one exists. The configured target or latest logged request header initializes the selector, and an unlisted current model remains visible because catalogs are advisory. Selection is local to this TUI session. Prompt assembly snapshots the target for one step, replaces `{{provider}}` and `{{model}}`, and applies the same provider/model/reasoning-effort target through `agent/request`; a switch during assembly therefore starts with a later step. The request header durably records targets that reach the model, while an unused selection remains process-local.

`/reload` (EXPERIMENTAL, dev-only) re-reads every file-backed loader config tree and applies the diff to the running app — the HMR watcher's config path, invoked manually; it needs the cordis Loader in the context and degrades to a warning without one, runs only while the agent is idle, and refuses re-entry while a reload is in flight. Module-source hot reload remains watcher-owned. When a `skills` service is mounted, `/skill:<name> [instructions]` loads that skill's instructions into the conversation as a user turn; autocomplete lists user-invocable skills, and exact invocation rejects a skill whose user policy disables it.

The bottom status bar sums the session's reported usage as `↑<uncached input> ↓<output>`, followed by `cache <rate>%` once any input has been billed — the share of billed prompt tokens (uncached input plus cache reads and writes) served from the provider cache, rounded to a percent. Its left side identifies the workspace and branch; its right side shows idle/running state, the current model, usage, token-meter context pressure when known, and queued work. The middle gap yields before either side is clipped on a narrow terminal.

`/status` adds a point-in-time diagnostics card to the transcript and remains available while the agent runs. It reports the session id, title, working directory, selected provider/model, selected reasoning effort or default behavior, reasoning-block visibility, agent state, event/turn/step/tool-call counts, exact input/output/cache token buckets, KV-cache hit rate, token-meter context use and capacity, creation time, and latest event time. Missing titles, models, cache input, or context capacity are labeled instead of inferred. The card is terminal-only and does not duplicate the compact footer.

`/settings` is a terminal hub over the shared optional `ctx.settings` provider. Bare `/settings` shows the file-backed document plus every registered namespace as redacted metadata (live/restart scope, inherited/user override, and hidden-secret count); `/settings list` prints the same namespace summary and `/settings document` prepares and reports the editable document path. It deliberately does not clone the Web React forms or write a complete redacted section back, because replacing such a section could erase stored secrets. `/theme [light|dark|system]` is the terminal-safe live action: it field-mutates the same `ui-theme.preference` namespace the Web client uses, follows external settings updates, and resolves `system` through the terminal color-scheme report.

`/workspace` opens a searchable selector over the shared durable `ctx.workspaceRegistry`; `/workspace <directory>` canonicalizes and registers that directory first. Choosing a row starts a **fresh** session in that workspace through the optional host-owned `TuiRuntime.handoffWorkspace`. The controller requires an idle agent, checks the directory, flushes the current session, drains input, and releases the UI plus full-screen/mouse terminal modes before handoff. A missing host leaves the current TUI running with a warning; a rejected host restores the terminal and forces a complete frame. It never rewrites the current session's immutable `SessionHeader.cwd` — changing workspace is a process/session handoff, not an in-place metadata mutation.

`/resume` opens a full-viewport keyboard selector instead of a centered dialog. The selector opens as soon as the command runs and takes input focus while the session scan is still pending, showing a loading placeholder until the rows arrive; Escape cancels an in-flight scan the same way it cancels the loaded list. Two scopes cover the same candidate set: the current workspace, which it opens on, and all workspaces, which Tab toggles to. The scope line under the search field names the active scope and the count the other holds, and each row in the all-workspaces scope also reports its own workspace. Toggling clears the search and selection so the highlighted row always belongs to the visible list.

Its focused search field starts immediately after the search glyph and emits pi-tui's cursor marker, so terminal IME composition remains anchored inside the field. Rows read no whole logs: when the optional projection cache is mounted, titles come from the live projection registry or the durable checkpoint row, with a cold read folding only the log tail since the checkpoint (written back so the next scan is zero-I/O, bounded by `resumeScanConcurrency`); a composition without the cache falls back to one bounded batch title read over the logs. Candidates are sorted by metadata activity — a live session's last in-memory event time, otherwise the persisted artifact's mtime, falling back to creation time — and searchable by title or session id, and by workspace label in the all-workspaces scope; each row reports that timestamp plus current/live/persisted state and the id. Up/Down and Page Up/Page Down navigate, Enter resumes, Escape clears a non-empty search before a second Escape cancels, and Ctrl+C cancels directly. The current session, a session already live in this runtime, an unreadable log, or a session with no recorded workspace to run in remains visible but disabled; a workspace other than the current one is a scope rather than a disabled reason, because resume enters that directory.

Selection repeats those checks, fully reads and replay-validates the one chosen log, rejects it when its logged provider has no current adapter, and requires the current agent to be idle. Without the optional host-owned `TuiRuntime.handoffResume`, the selector closes and warns without stopping the current TUI. The shipped `dsh tui` host supplies both resume and fresh-workspace handoffs; custom embeddings may remain resume-only or supply neither. A host receives the selected id and workspace after the current session is flushed and the terminal UI stops; process cwd, not the restored session header, is what filesystem and shell tools resolve against, so the host must enter that directory before replacing the process. A completed handoff restores the same `SessionId`, transcript, title, todos, durable goal, and recorded agent preset; goal activation remains disarmed and the TUI asks for human confirmation or `/goal resume`.

The exit line is launcher-owned, not configurable. A launcher provides `TUI_GOODBYE_MESSAGE_KEY` on the boot context — for the shipped `dsh`, the command that resumes this session — and exiting prints it verbatim after the terminal is released; absent, exiting prints nothing. Only the launcher knows how it was invoked, so only it can name a command that works. The TUI escapes terminal controls before rendering and never executes the text. A launcher that also supplies `MAIN_SESSION_ID_KEY` fixes which session the mounted app binds to, so resume survives any config-level patch.

An embedding can seed a session by setting the direct renderer's `initialSkill` config or providing `INITIAL_SKILL_KEY` on the boot context. Once the chat is live, the TUI auto-invokes that skill exactly as a typed `/skill:<name>`; the embedding must omit it on resumed sessions when it wants fresh-session-only behavior. The shipped `dsh tui` launcher sets no initial skill, and an unknown name is reported as a notice.

Reasoning is hidden on first render. Injected-context cards use a single `N lines hidden` disclosure row rather than showing a head/tail preview. The footer's clickable `▸` glyph expands context, tool cards, and reasoning together and changes to `▾`; clicking again restores the compact view. Ctrl+O, Ctrl+R, and `/details` remain the keyboard and command equivalents.

## Config

`TuiConfig` is the presentation schema accepted by the shipped bundle's `tui-runner` row and by the direct renderer. The direct `@deepseek-ai/dsh-tui` plugin's full `Config` adds `welcome`, `sessionId`, and `initialSkill`; the bundle runner deliberately exposes only `TuiConfig`, while `tuiStartup` owns its session identity and the shipped launcher supplies no initial skill.

| Key | Scope | Default | Meaning |
|---|---|---|---|
| `welcome` | direct renderer only | — | Banner subtitle until the session has a logged title; unset, the banner sweeps in with no subtitle |
| `sessionId` | direct renderer only | `main` | Exact shared agent/session identity driven by the terminal |
| `initialSkill` | direct renderer only | — | Skill auto-invoked once the chat is live |
| `fullscreen` | `TuiConfig` | `true` | Use the alternate screen and restore the previous shell screen on exit |
| `mouse` | `TuiConfig` | `true` | Enable transcript/selector wheel input and model-badge clicks in full-screen mode |
| `showReasoning` | `TuiConfig` | `false` | Render reasoning blocks initially; hidden by default and expandable through details |
| `maxToolOutputLines` | `TuiConfig` | `6` | Output lines retained across a collapsed tool card's head/tail preview |
| `maxDiffEditLength` | `TuiConfig` | `1000` | Maximum added and removed lines explored for an exact diff before whole-side fallback |
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
| `theme.leftPrompt` | `TuiConfig` | `${cwd}${git/worktree}` | Left-aligned bottom status template |
| `theme.rightPrompt` | `TuiConfig` | `${details}${status}${model}${token_meter/cache_hit_rate}${context}${queued}` | Right-aligned bottom status template |
| `theme.inputPrompt` | `TuiConfig` | `${symbol} ${indicator}` | Editor first-line prefix template |
| `theme.inputPlaceholder` | `TuiConfig` | `Describe a task, @ a file, or / for commands` | Empty-editor placeholder |
| `title` | `TuiConfig` | `DeepSeek Harness` | Product suffix for the terminal window title |

Patch the shipped profile's existing runner row for presentation settings:

```yaml
# Shipped tui profile: presentation-only TuiConfig.
- id: tui-runner
  config:
    showReasoning: false
    theme:
      color: false
```

A direct renderer composition may additionally choose its session identity and startup content:

```yaml
# Direct renderer: full Config extends TuiConfig.
- id: terminal
  name: '@deepseek-ai/dsh-tui'
  config:
    welcome: 'Coding agent ready.'
    sessionId: main-session-123
    initialSkill: onboarding
    theme:
      color: true
```

Both process entries reject a non-TTY stdin or stdout before claiming the terminal. The shipped runner creates or resumes its exact Agent after Loader settlement and then mounts the renderer onto that existing root. A direct composition can mount before a config-created Agent to observe `agent-loop/config-start-failed`; `mountTui` also checks for an already-existing matching root after installing its listeners. Disposal stops extension admission, unloads the `ctx.tui` provider and its dependent plugins, aborts running commands, removes the TUI definitions, stops loaders, rejects pending questions, drains terminal input, restores terminal state, unregisters event listeners and the user-interaction provider, and never exits a replacement process during HMR. A user exit disposes the application root so sibling resources close, then exits; a five-second fallback prevents one stuck disposer from trapping the process.

## Color

Every general-purpose SGR code the TUI emits lives in one table, `paletteSpec` in `components/theme.ts`, which `createPalette` derives its wrappers from and `/palette` prints; no component writes an escape of its own. The table holds only the standard 16-color ANSI foregrounds and SGR attributes, which every terminal remaps to its active color scheme, so the TUI stays readable on light and dark backgrounds alike. The startup banner gradient and the official mark's exact `#4D6BFE` ink are the two deliberate truecolor brand exceptions. Body text keeps the terminal's default foreground rather than a fixed shade.

There is one role per visual meaning: `dim` is the single recessed tone, `accent` the single interaction emphasis, and `brand` the DeepSeek mark's standard-ANSI fallback, while `success` and `error` double as a diff's added and removed lines. Colors and attributes are separately typed, so `bold(accent(x))` compiles and `accent(error(x))` does not — SGR has no color stack, so nesting one color inside another silently drops the outer color at the inner one's close. Attributes occupy independent SGR groups and compose with any color in either order. Run `/palette` to see every role as your terminal renders it, with its SGR pair.

Grouped regions (user prompts, assistant replies, tool cards) are separated by a bold, underlined role header in the role color and blank-line spacing rather than a filled block or a per-line prefix, so a mouse drag-select copies the message text without any leading bar or indent; a tool card's status (pending, error, success) shows in its colored, underlined title glyph and title. Inside a tool card, the whole body — presenter title, a terminal `$` command and cwd, and the tool's own output — renders in one dim tone, so only the status-colored header carries color and the body reads as one recessed block instead of a run of competing shades; an injected-context card's prose is the same tone as its header. A diff card with both sides available colors and counts exact added `+` and removed `-` lines, while unchanged context stays dim and uncounted. If exact comparison exceeds `maxDiffEditLength`, the card renders each old-side row as removed and each new-side row as added, marks the footer approximate, and caches that fallback for later redraws. When `oldText` is unavailable, including pending writes and replay fallbacks as well as creates, every non-empty new-side row is shown and counted as added; that count does not prove the rows were absent from an existing file. Empty new content produces no synthetic `+ ` row. A `[signal …]` marker remains colored because there the color is the meaning rather than emphasis. The question panel emphasizes its active row with bold accent text, while selectors use reverse video. These treatments are foreground-only, so they never collide with the terminal background. Set `theme.color: false` to strip all styling.

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
