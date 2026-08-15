/**
 * Host and process boundary the interactive TUI runs against: an optional
 * resume-handoff host and the {@link TuiRuntime} carrying terminal, process exit,
 * clock, and prompt/git overrides. These are plain interfaces so embeddings and
 * tests can supply their own process behavior.
 * @module @deepseek-ai/dsh-tui/runtime
 */

import type { Terminal } from '@earendil-works/pi-tui'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { GitDiffResult } from './chat/git-diff.ts'
import type { ExternalImportGateway } from './chat/external-import.ts'
import type { ExternalEditor } from './chat/external-editor.ts'
import type { UserShellRunner } from './chat/user-shell.ts'

/** Source category for one launcher-composed configuration layer. */
export type TuiConfigLayerKind = 'bundle' | 'profile' | 'home' | 'overlay' | 'runtime' | 'environment'

/** One source layer applied to the running profile. */
export interface TuiConfigLayerDiagnostic {
  /** Category used by the terminal diagnostic. */
  readonly kind: TuiConfigLayerKind
  /** Human-readable source name, such as a bundle package or environment switch. */
  readonly label: string
  /** Absolute source path when the layer came from a file. */
  readonly path?: string
}

/** Launcher-owned profile provenance exposed to the non-secret `/debug-config` view. */
export interface TuiConfigDiagnostics {
  /** Active profile name. */
  readonly profile: string
  /** Absolute Loader root file anchoring the composition. */
  readonly rootConfig: string
  /** Applied source layers in precedence order. */
  readonly layers: readonly TuiConfigLayerDiagnostic[]
}

/** Host-owned navigation between live agents in one root session tree. */
export interface TuiAgentNavigation {
  /** Root session whose primary agent and descendants belong in the picker. */
  readonly rootSessionId: SessionId

  /**
   * Return the agent whose terminal channel is currently mounted.
   * @returns The live channel's session/agent id.
   */
  currentSessionId(): SessionId

  /**
   * Queue a channel switch after the current slash command settles.
   * @param sessionId - Live root or descendant agent selected by the user.
   * @returns An immediate validation error, or `undefined` when the switch was queued.
   */
  queueSwitch(sessionId: SessionId): string | undefined

  /** Return presentation metadata when `sessionId` is the active ephemeral side thread. */
  sideConversation?(sessionId: SessionId): {
    readonly parentSessionId: SessionId
    readonly transcriptStartSeq: number
  } | undefined

  /**
   * Queue creation and selection of an ephemeral fork after command settlement.
   * @param prompt - Optional first direct user message for the side thread.
   * @returns An immediate validation error, or `undefined` when queued.
   */
  queueSide?(prompt: string): string | undefined

  /** Queue restoration of the side thread's parent and disposal of the side. */
  queueCloseSide?(): string | undefined
}

/** Optional process-lifecycle owner for an atomic resume handoff. */
export interface TuiResumeHost {
  /**
   * Dispose the current app and replace it with a runtime for `sessionId` in
   * `cwd`. Success does not return. A host may reject before it commits
   * teardown; after commit it owns fatal reporting and process exit.
   * @param sessionId - validated persisted session selected by the user.
   * @param cwd - the selected session's own workspace, which the replacement
   *   process must run in: process cwd, not the restored session header, is what
   *   filesystem and shell tools resolve against. It may differ from the current
   *   workspace, so a host that cannot enter it must reject before committing
   *   teardown.
   * @returns A promise that never resolves after a successful process handoff.
   */
  handoff(sessionId: SessionId, cwd: string): Promise<never>

  /**
   * Dispose the current app and start a fresh session in `cwd`. Optional so a
   * resume-only embedding keeps working; workspace selection reports the
   * missing capability without changing the current session.
   * @param cwd - selected workspace for the replacement process.
   * @returns A promise that never resolves after a successful process handoff.
   */
  start?(cwd: string): Promise<never>
}

/** Runtime boundary used by the interactive TUI. */
export interface TuiRuntime {
  /** Terminal implementation; production uses pi-tui's `ProcessTerminal`. */
  terminal: Terminal
  /** Exit hook used by terminal shutdown or a target-agent startup failure. */
  exit(code: number): void
  /**
   * Override the prompt's logical working-directory label without changing the session directory used by tools.
   * @param cwd - Operational working directory from the session header.
   * @returns Unescaped label; the TUI makes terminal controls visible.
   */
  formatCwd?: (cwd: string | undefined) => string
  /**
   * Override the Git branch shown in the prompt context line; production resolves it once at mount.
   * @param cwd - Operational working directory from the session header.
   * @returns Unescaped branch name, or `undefined` outside a Git worktree.
   */
  gitBranch?: (cwd: string) => string | undefined
  /**
   * Override the read-only Git inspection used by `/diff`; production invokes
   * the local Git executable with repository-configured helpers disabled.
   * @param cwd - Operational working directory from the session header.
   * @param timeoutMs - Configured maximum lifetime of each Git child process.
   * @param signal - Slash-command cancellation signal.
   * @returns Worktree detection and unified diff text.
   */
  gitDiff?: (cwd: string, timeoutMs: number, signal: AbortSignal) => Promise<GitDiffResult>
  /** Host override for `/import` detection and non-overwriting setup copies. */
  externalImport?: ExternalImportGateway
  /** Host override for editing the current composer draft outside the TUI. */
  externalEditor?: ExternalEditor
  /** Host override for direct `!command` execution. */
  userShell?: UserShellRunner
  /** Monotonic-enough wall clock for elapsed status rendering. Defaults to `Date.now`. */
  now?(): number
  /** Host-owned process handoff; absent leaves the session selectable but not resumable in place. */
  handoffResume?: TuiResumeHost['handoff']
  /** Host-owned fresh-session handoff used by `/new`, `/clear`, and the workspace selector. */
  handoffWorkspace?: NonNullable<TuiResumeHost['start']>
  /** Host-owned live-agent channel navigation used by `/agent` and `/subagents`. */
  agentNavigation?: TuiAgentNavigation
  /**
   * Line the host wants printed once the terminal is released on exit, such as
   * the command that resumes this session. Absent prints nothing. The host owns
   * the wording; the TUI owns rendering and escapes terminal controls, so
   * embedded ANSI is shown literally rather than applied.
   */
  goodbyeMessage?: string
}
