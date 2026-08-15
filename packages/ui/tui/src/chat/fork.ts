/**
 * Current-session fork controller for the interactive TUI. It creates a
 * durable child only after the `/fork` command lifecycle has settled, then
 * hands that child to the process host without treating the still-live child
 * as an ordinary `/resume` candidate.
 * @module @deepseek-ai/dsh-tui/chat/fork
 */

import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { TuiRuntime } from '../runtime.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'

/** Collaborators for one channel's current-session fork command. */
export interface ForkControllerDeps extends ChatChannelDeps, ChannelNotice {
  readonly agent: Agent
  readonly runtime: TuiRuntime
  /** Current status re-read before every state-changing phase. */
  agentStatus(): AgentStatus
  /** Release pi-tui plus terminal modes immediately before process handoff. */
  releaseTerminal(): void
  /** Restore terminal modes and editor focus after a host failure. */
  restoreTerminal(): void
}

/** Current-session fork controller for one chat channel. */
export interface ForkController {
  /**
   * Queue a fork after the current slash-command lifecycle settles.
   * @returns an error message when the operation cannot be admitted, otherwise `undefined`.
   */
  queueFork(): string | undefined
  /** Cancel a queued, not-yet-started fork during channel shutdown. */
  dispose(): void
}

/**
 * Build the current-session fork controller.
 * @param deps - session, terminal, process-handoff, and notice collaborators.
 * @returns the controller wired to `/fork`.
 */
export function createForkController(deps: ForkControllerDeps): ForkController {
  const { ctx, agent, runtime } = deps
  let forkInFlight = false
  let forkTimer: ReturnType<typeof setTimeout> | undefined

  const runFork = async (cwd: string, host: NonNullable<TuiRuntime['handoffResume']>): Promise<void> => {
    let terminalReleased = false
    let childId: string | undefined
    try {
      if (deps.isDisposed()) return
      const status = deps.agentStatus()
      if (status !== 'idle') throw new Error(`Fork requires an idle agent (status: ${status}).`)

      const child = ctx.sessions.fork(agent.session)
      childId = child.id
      if (!await ctx.sessions.flush(child)) throw new Error('no session persistence checkpoint accepted the fork')
      await ctx.sessions.flush(agent.session)
      if (deps.isDisposed()) return
      const finalStatus = deps.agentStatus()
      if (finalStatus !== 'idle') throw new Error(`Fork requires an idle agent (status: ${finalStatus}).`)
      await runtime.terminal.drainInput(100, 20)
      if (deps.isDisposed()) return
      deps.releaseTerminal()
      terminalReleased = true
      await host(child.id, cwd)
      throw new Error('fork host returned without replacing the process')
    } catch (error: unknown) {
      if (!deps.isDisposed()) {
        if (terminalReleased) deps.restoreTerminal()
        const retained = childId === undefined ? '' : `Forked session ${childId} remains available. `
        deps.appendNotice(`${retained}Fork failed: ${errorChain(error)}`, 'error')
      }
    } finally {
      forkInFlight = false
    }
  }

  return {
    queueFork(): string | undefined {
      if (forkInFlight) return 'A session fork is already in progress.'
      const status = deps.agentStatus()
      if (status !== 'idle') return `/fork requires the current turn to finish or be cancelled first (status: ${status}).`
      const cwd = agent.session.header.cwd
      if (cwd === undefined) return '/fork is unavailable because the current session has no workspace.'
      const host = runtime.handoffResume
      if (host === undefined) return '/fork is unavailable because this host cannot switch sessions in place.'
      if (ctx.get('sessionPersistence') === undefined) return '/fork is unavailable because session persistence is not mounted.'
      forkInFlight = true
      // The command registry appends command/done after this handler returns.
      // A timer ensures the child receives the complete paired lifecycle.
      forkTimer = setTimeout(() => {
        forkTimer = undefined
        void runFork(cwd, host)
      }, 0)
      return undefined
    },
    dispose(): void {
      if (forkTimer !== undefined) {
        clearTimeout(forkTimer)
        forkTimer = undefined
        forkInFlight = false
      }
    },
  }
}
