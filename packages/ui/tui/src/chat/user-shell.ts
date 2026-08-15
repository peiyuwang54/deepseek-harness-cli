/**
 * Direct human shell-command execution for the TUI. The runner uses the
 * composed shell executor and the current session sandbox policy without
 * entering the model-facing tool pipeline.
 * @module @deepseek-ai/dsh-tui/chat/user-shell
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

/** Bounded captured stream retained in a durable user-shell result. */
interface UserShellOutput {
  /** Captured UTF-8 text. */
  text: string
  /** Whether the executor dropped bytes beyond its capture budget. */
  truncated: boolean
  /** Full-stream spill file when the executor made one available. */
  spillPath?: string
}

/** Sandbox facts retained for one direct user command. */
interface UserShellSandboxResult {
  /** Effective file-sandbox mode. */
  mode: string
  /** Whether the sandbox denied a file operation. */
  denied: boolean
  /** Strength of the selected platform enforcement. */
  enforcement?: string
  /** Whether the sandbox runner failed before command execution. */
  runnerFailed?: boolean
}

/** Stable result returned by a host user-shell runner and recorded by the TUI. */
export interface UserShellResult {
  /** Process exit code, or `null` after signal termination. */
  exitCode: number | null
  /** Terminating signal, or `null` after normal exit. */
  signal: string | null
  /** Whether the executor timeout ended the command. */
  timedOut: boolean
  /** Whether TUI cancellation ended the command. */
  aborted: boolean
  /** Captured standard output. */
  stdout: UserShellOutput
  /** Captured standard error. */
  stderr: UserShellOutput
  /** Effective sandbox facts when the executor confines commands. */
  sandbox?: UserShellSandboxResult
}

/** One direct shell invocation requested by the human at the TUI composer. */
export interface UserShellRequest {
  /** Exact command after the leading `!` and surrounding whitespace are removed. */
  command: string
  /** Agent whose Session supplies cwd and sandbox policy. */
  agent: Agent
  /** Cancels the command, normally from Escape or TUI disposal. */
  signal: AbortSignal
}

/** Host boundary for direct TUI shell execution. */
export type UserShellRunner = (request: UserShellRequest) => Promise<UserShellResult>

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A direct human `!command` started. This is a log-only TUI transcript
     * event and never enters model context. `id` pairs it with at most one
     * `tui/user-shell-result`; an unmatched start represents an interrupted
     * process. The command may be recorded only while the Agent is idle.
     */
    'tui/user-shell-start': {
      id: string
      command: string
      cwd: string
    }
    /**
     * The settled outcome for one prior `tui/user-shell-start`. It is log-only
     * and preserves the executor's bounded output and sandbox facts for resume.
     */
    'tui/user-shell-result': {
      id: string
      durationMs: number
      result: UserShellResult
    }
  }
}

/** Detach executor-owned output into the durable TUI vocabulary. */
function detachResult(result: ShellRunResult): UserShellResult {
  const output = (stream: ShellRunResult['stdout']): UserShellOutput => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath === undefined ? {} : { spillPath: stream.spillPath },
  })
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...result.sandbox === undefined ? {} : {
      sandbox: {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement === undefined ? {} : { enforcement: result.sandbox.enforcement },
        ...result.sandbox.runnerFailed === undefined ? {} : { runnerFailed: result.sandbox.runnerFailed },
      },
    },
  }
}

/**
 * Create the production direct-shell runner over optional composed services.
 * The returned function resolves services at execution time so a TUI embedding
 * can mount without shell support and receive a clear submission error.
 *
 * @param ctx - Composition that may provide shell and sandbox-policy services.
 * @returns A runner that executes under the calling Session's current policy.
 */
export function createUserShellRunner(ctx: Context): UserShellRunner {
  return async ({ command, agent, signal }) => {
    const shell = ctx.get('shell')
    if (shell === undefined) {
      throw new Error('shell commands are unavailable in this profile')
    }
    const sandboxPolicy = ctx.get('sandboxPolicy')
    if (shell.sandboxMode !== undefined && sandboxPolicy === undefined) {
      throw new Error('the configured shell executor requires a sandbox policy')
    }
    const policy = sandboxPolicy?.resolve({ session: agent.session })
    const workdir = policy?.workspaceRoot ?? agent.session.header.cwd ?? process.cwd()
    const result = await shell.run(shell.resolve({
      command,
      workdir,
      signal,
      ...policy === undefined ? {} : { sandboxPolicy: policy },
    }))
    return detachResult(result)
  }
}
