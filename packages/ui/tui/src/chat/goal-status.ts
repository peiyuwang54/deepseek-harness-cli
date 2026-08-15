/** Compact right-status projection of the durable Goal domain. */

import type { GoalActivation, GoalPhase, GoalSnapshot } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Goal facts required by the terminal footer. */
export interface GoalFooterState {
  readonly id: GoalSnapshot['id']
  readonly phase: GoalPhase
  readonly activation: GoalActivation
  readonly elapsedMs: number
}

/** Format elapsed Goal execution with Codex's compact units. */
export function formatGoalElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h ${remainingMinutes}m`
}

/**
 * Format the Codex Goal status indicator from Harness-owned state. Harness
 * has no token-budget Goal field, so active and completed goals use elapsed
 * execution time, matching Codex's unbudgeted path.
 * @param goal - Current durable phase, activation, and accumulated execution time.
 * @returns Footer text, or `undefined` when no Goal exists.
 */
export function formatGoalFooterStatus(goal: GoalFooterState | undefined): string | undefined {
  if (goal === undefined) return undefined
  switch (goal.phase) {
    case 'active':
      return goal.activation === 'armed'
        ? `Pursuing goal (${formatGoalElapsed(goal.elapsedMs)})`
        : 'Goal paused (/goal resume)'
    case 'paused': return 'Goal paused (/goal resume)'
    case 'blocked': return 'Goal stalled (/goal resume)'
    case 'complete': return `Goal achieved (${formatGoalElapsed(goal.elapsedMs)})`
    default: return assertNever(goal.phase)
  }
}

interface OpenTurn {
  readonly turn: number
  readonly startedAt: number
  goalOwned: boolean
  stoppedAt?: number
}

/**
 * Incrementally accumulates wall time only for turns admitted by one Goal.
 * Idle time between automatic rounds and paused time are excluded. A terminal
 * Goal mutation caps an open round immediately even if its enclosing turn
 * emits its final assistant text afterward.
 */
export class GoalTimingTracker {
  private goalId: GoalSnapshot['id'] | undefined
  private scanned = 0
  private elapsedMs = 0
  private open: OpenTurn | undefined

  /**
   * Return execution time for the current Goal at `now`.
   * @param events - Append-only session log.
   * @param goalId - Current Goal identity.
   * @param now - Render clock in epoch milliseconds.
   * @returns Accumulated Goal-owned turn time.
   */
  elapsedAt(events: readonly SessionEvent[], goalId: GoalSnapshot['id'], now: number): number {
    if (this.goalId !== goalId) {
      this.goalId = goalId
      this.scanned = 0
      this.elapsedMs = 0
      this.open = undefined
    }
    for (; this.scanned < events.length; this.scanned += 1) {
      const event = events[this.scanned] as SessionEvent
      switch (event.type) {
        case 'turn/start':
          this.open = { turn: event.data.turn, startedAt: event.time, goalOwned: false }
          break
        case 'user/message':
          if (event.data.source.kind === 'goal' && event.data.source.goalId === goalId && this.open !== undefined) {
            this.open.goalOwned = true
          }
          break
        case 'goal/change':
          if (event.data.operation !== 'clear' && event.data.goal.id === goalId
            && event.data.goal.phase !== 'active' && this.open?.goalOwned === true) {
            this.open.stoppedAt = event.time
          }
          break
        case 'turn/end':
          if (this.open?.turn === event.data.turn) {
            if (this.open.goalOwned) {
              this.elapsedMs += Math.max(0, (this.open.stoppedAt ?? event.time) - this.open.startedAt)
            }
            this.open = undefined
          }
          break
        default:
          break
      }
    }
    if (this.open?.goalOwned !== true) return this.elapsedMs
    return this.elapsedMs + Math.max(0, (this.open.stoppedAt ?? now) - this.open.startedAt)
  }
}

/** Closed-union exhaustiveness guard. */
function assertNever(value: never): never {
  throw new TypeError(`unknown goal phase: ${String(value)}`)
}
