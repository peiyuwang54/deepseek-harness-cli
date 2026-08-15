import { describe, expect, it } from 'vitest'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  GoalTimingTracker,
  formatGoalElapsed,
  formatGoalFooterStatus,
  type GoalFooterState,
} from '../src/chat/goal-status.ts'

const ID = GoalId('goal-1')

function goal(overrides: Partial<GoalFooterState> = {}): GoalFooterState {
  return {
    id: ID,
    phase: 'active',
    activation: 'armed',
    elapsedMs: 125_000,
    ...overrides,
  }
}

function event(type: SessionEvent['type'], time: number, data: object): SessionEvent {
  return { type, seq: time, time, data } as SessionEvent
}

describe('goal footer status', () => {
  it('matches Codex elapsed-time labels for active and restored Goal states', () => {
    expect(formatGoalFooterStatus(goal())).toBe('Pursuing goal (2m)')
    expect(formatGoalFooterStatus(goal({ activation: 'disarmed' }))).toBe('Goal paused (/goal resume)')
  })

  it('shows paused, blocked, complete, and absent states', () => {
    expect(formatGoalFooterStatus(goal({ phase: 'paused' }))).toBe('Goal paused (/goal resume)')
    expect(formatGoalFooterStatus(goal({ phase: 'blocked' }))).toBe('Goal stalled (/goal resume)')
    expect(formatGoalFooterStatus(goal({ phase: 'complete' }))).toBe('Goal achieved (2m)')
    expect(formatGoalFooterStatus(undefined)).toBeUndefined()
  })

  it('uses the compact Codex duration units', () => {
    expect(formatGoalElapsed(59_999)).toBe('59s')
    expect(formatGoalElapsed(60_000)).toBe('1m')
    expect(formatGoalElapsed(90 * 60_000)).toBe('1h 30m')
    expect(formatGoalElapsed(24 * 60 * 60_000)).toBe('1d 0h 0m')
  })

  it('counts Goal-owned turn time without idle or ordinary chat time', () => {
    const tracker = new GoalTimingTracker()
    const events = [
      event('turn/start', 1_000, { turn: 1 }),
      event('user/message', 1_100, { source: { kind: 'human' } }),
      event('turn/end', 6_000, { turn: 1, reason: { kind: 'completed' } }),
      event('turn/start', 10_000, { turn: 2 }),
      event('user/message', 10_100, { source: { kind: 'goal', goalId: ID, revision: 1, round: 1 } }),
      event('turn/end', 20_000, { turn: 2, reason: { kind: 'completed' } }),
      event('turn/start', 30_000, { turn: 3 }),
      event('user/message', 30_100, { source: { kind: 'goal', goalId: ID, revision: 1, round: 2 } }),
    ]
    expect(tracker.elapsedAt(events, ID, 35_000)).toBe(15_000)
    expect(tracker.elapsedAt(events, ID, 38_000)).toBe(18_000)
  })
})
