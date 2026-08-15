/**
 * Per-step timing model for the terminal front door. Timing buckets are
 * replayed from the session event stream; the live turn row owns animation.
 * @module @deepseek-ai/dsh-tui/chat/timing
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Render cadence of the animated live-turn row and standalone compaction clock.
 * Only changed terminal cells are re-emitted.
 */
export const STATUS_ANIMATION_INTERVAL_MS = 50

/** The active phase of a running step, one bucket of accumulated wall time. */
export type TimingBucket = 'ttft' | 'thinking' | 'responding' | 'tools'

/** Turn/step coordinates of one assistant step. */
export type StepPosition = { turn: number; step: number }

/** Accumulated wall time per phase for one step or session slice. */
export interface TimingTotals {
  ttft: number
  thinking: number
  responding: number
  tools: number
}

interface TimingState {
  totals: TimingTotals
  active: { bucket: TimingBucket; since: number } | undefined
}

const TIMING_BUCKET_LABELS: Record<TimingBucket, string> = {
  ttft: 'Model wait',
  thinking: 'Thinking',
  responding: 'Response',
  tools: 'Tools',
}

const TIMING_BUCKETS: readonly TimingBucket[] = ['ttft', 'thinking', 'responding', 'tools']

function emptyTimingTotals(): TimingTotals {
  return { ttft: 0, thinking: 0, responding: 0, tools: 0 }
}

function timingState(startedAt?: number): TimingState {
  return {
    totals: emptyTimingTotals(),
    /* v8 ignore next -- production timing state always begins at a logged step timestamp. */
    active: startedAt === undefined ? undefined : { bucket: 'ttft', since: startedAt },
  }
}

function closeTimingBucket(state: TimingState, at: number): void {
  if (state.active === undefined) return
  state.totals[state.active.bucket] += Math.max(0, at - state.active.since)
  state.active = undefined
}

function enterTimingBucket(state: TimingState, bucket: TimingBucket | undefined, at: number): void {
  if (state.active?.bucket === bucket) return
  closeTimingBucket(state, at)
  if (bucket !== undefined) state.active = { bucket, since: at }
}

function advanceStepTiming(
  state: TimingState,
  event: Extract<SessionEvent, { type: 'assistant/chunk' | 'tool/call' | 'step/end' }>,
): void {
  if (event.type === 'assistant/chunk') {
    const chunk = event.data.chunk
    if (state.active?.bucket === 'ttft') enterTimingBucket(state, undefined, event.time)
    if (chunk.type === 'reasoning-delta' || (chunk.type === 'block-start' && chunk.blockType === 'reasoning')) {
      enterTimingBucket(state, 'thinking', event.time)
    } else if (chunk.type === 'text-delta' || (chunk.type === 'block-start' && chunk.blockType === 'text')) {
      enterTimingBucket(state, 'responding', event.time)
    }
  } else if (event.type === 'tool/call') {
    enterTimingBucket(state, 'tools', event.time)
  } else {
    closeTimingBucket(state, event.time)
  }
}

function timingTotalsAt(state: TimingState, at?: number): TimingTotals {
  const totals = { ...state.totals }
  if (state.active !== undefined && at !== undefined) {
    totals[state.active.bucket] += Math.max(0, at - state.active.since)
  }
  return totals
}

function stepKey(position: StepPosition): string {
  return `${position.turn}:${position.step}`
}

interface TrackedStep extends TimingState {
  /** Set at the step's `step/end`; later same-coordinate events no longer advance the step. */
  closed: boolean
}

/**
 * Incremental per-step timing accumulator shared by every step's timing footer
 * in one transcript. One forward pass over the append-only session log serves
 * all steps' totals: each query advances a cursor over the events appended
 * since the previous query, so a transcript of S steps costs O(events) in
 * total instead of the O(S × events) of replaying the whole log per footer
 * ([rationale](../../../../../.agents/notes/implemented/feature/2026-08-14-shipped-tui-cli-front-door.md)).
 *
 * The log must be append-only with stable indices (the session `seq = log
 * length` contract). Event times are consumed as logged: a backward wall-clock
 * step clamps each bucket at zero rather than cutting the scan off at the
 * query clock. The open bucket is accumulated to the query clock at lookup,
 * never during the scan.
 */
export class StepTimingTracker {
  private scanned = 0
  private readonly steps = new Map<string, TrackedStep>()

  /**
   * Advance over events appended since the previous query, then return one
   * step's accumulated per-phase timing up to clock `at`.
   * @param events - Current session event log (append-only).
   * @param position - Turn/step coordinates of the queried step.
   * @param at - Render clock to accumulate the open bucket up to.
   * @returns The step's per-phase totals; empty when the step never started.
   */
  totalsAt(events: readonly SessionEvent[], position: StepPosition, at: number): TimingTotals {
    for (; this.scanned < events.length; this.scanned += 1) {
      const event = events[this.scanned] as SessionEvent
      if (event.type === 'step/start') {
        const key = stepKey(event.data)
        if (!this.steps.has(key)) this.steps.set(key, { ...timingState(event.time), closed: false })
      } else if (event.type === 'assistant/chunk' || event.type === 'tool/call' || event.type === 'step/end') {
        const state = this.steps.get(stepKey(event.data))
        if (state !== undefined && !state.closed) {
          advanceStepTiming(state, event)
          if (event.type === 'step/end') state.closed = true
        }
      }
    }
    const state = this.steps.get(stepKey(position))
    return state === undefined ? emptyTimingTotals() : timingTotalsAt(state, at)
  }
}

/**
 * The turn index of the currently open turn, or `undefined` when none is open.
 * @param events - Session events to scan from the tail.
 * @returns The open turn index, or `undefined`.
 */
export function openTurn(events: readonly SessionEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'turn/end') return undefined
    if (event.type === 'turn/start') return event.data.turn
  }
  return undefined
}

/**
 * Format a non-negative elapsed span at 100 ms resolution.
 * @param elapsedMs - Elapsed milliseconds.
 * @returns The formatted duration (e.g. `1.5s`, `2m03.4s`).
 */
export function formatStatusDuration(elapsedMs: number): string {
  const tenths = Math.floor(Math.max(0, elapsedMs) / 100)
  const seconds = tenths / 10
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}s`
}

/**
 * Format the non-zero timing buckets of one step as a middot-joined summary.
 * @param totals - Per-phase totals to format.
 * @param includeModelWait - Whether to always include the model-wait bucket.
 * @returns The formatted timing summary.
 */
export function formatTimingTotals(totals: TimingTotals, includeModelWait = false): string {
  return TIMING_BUCKETS
    .filter(bucket => totals[bucket] > 0 || (includeModelWait && bucket === 'ttft'))
    .map(bucket => `${TIMING_BUCKET_LABELS[bucket]} ${formatStatusDuration(totals[bucket])}`)
    .join(' · ')
}

/**
 * Format the queued-steering badge shown on the running status line.
 * @param queued - Number of queued steering messages.
 * @returns The badge text, or `undefined` when nothing is queued.
 */
export function formatQueuedStatus(queued: number): string | undefined {
  return queued > 0 ? `${queued} queued` : undefined
}

/**
 * Format a completion timestamp as `YYYY-MM-DD HH:MM:SS` in local time.
 * @param time - Epoch milliseconds.
 * @returns The formatted local timestamp.
 */
export function formatCompletionTime(time: number): string {
  const date = new Date(time)
  const parts = [
    date.getFullYear().toString().padStart(4, '0'),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
  ]
  const clock = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(value => value.toString().padStart(2, '0'))
    .join(':')
  return `${parts.join('-')} ${clock}`
}
