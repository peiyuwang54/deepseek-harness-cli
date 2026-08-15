/**
 * Host and process boundary the interactive TUI runs against: an optional
 * resume-handoff host and the {@link TuiRuntime} carrying terminal, process exit,
 * clock, and prompt/git overrides. These are plain interfaces so embeddings and
 * tests can supply their own process behavior.
 * @module @deepseek-ai/dsh-tui/runtime
 */

import type { Terminal } from '@earendil-works/pi-tui'
import type { SessionId } from '@deepseek-ai/dsh-session'

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
  /** Monotonic-enough wall clock for elapsed status rendering. Defaults to `Date.now`. */
  now?(): number
  /** Host-owned process handoff; absent leaves the session selectable but not resumable in place. */
  handoffResume?: TuiResumeHost['handoff']
  /** Host-owned fresh-session handoff used by `/new`, `/clear`, and the workspace selector. */
  handoffWorkspace?: NonNullable<TuiResumeHost['start']>
  /**
   * Line the host wants printed once the terminal is released on exit, such as
   * the command that resumes this session. Absent prints nothing. The host owns
   * the wording; the TUI owns rendering and escapes terminal controls, so
   * embedded ANSI is shown literally rather than applied.
   */
  goodbyeMessage?: string
}
