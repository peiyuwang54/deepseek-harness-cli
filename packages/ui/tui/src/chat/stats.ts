/**
 * Terminal presentation of the Web conversation statistics strip. The
 * authoritative counts and durations come from the shared `sessionStats`
 * projection; this module owns only compact, terminal-safe formatting.
 * @module @deepseek-ai/dsh-tui/chat/stats
 */

import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import type { Palette } from '../components/theme.ts'

/** Sum the disjoint provider prompt billing buckets. */
function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Format the token figures with the same K/M thresholds as the Web strip. */
export function formatMetricTokens(value: number): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Format a session-wide duration exactly like the Web statistics strip. */
export function formatMetricDuration(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1_000
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Format decode throughput with one decimal below ten and integers above. */
export function formatMetricThroughput(tokensPerSecond: number): string {
  const value = Math.max(0, tokensPerSecond)
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}

/**
 * Compose the pipe-separated statistics line shared semantically with Web.
 * Missing projection groups disappear rather than displaying invented zeros.
 */
export function formatSessionStatsLine(
  stats: SessionStatsProjection | undefined,
  usage: TokenUsageProjection | undefined,
): string | undefined {
  const groups: string[] = []
  if (stats !== undefined && stats.steps > 0) {
    groups.push(`${stats.turns} ${stats.turns === 1 ? 'turn' : 'turns'} · ${stats.steps} ${stats.steps === 1 ? 'step' : 'steps'}`)
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(`LLM ${formatMetricDuration(stats.llmMs)}`)
    if (stats.toolMs > 0) durations.push(`Tool call ${formatMetricDuration(stats.toolMs)}`)
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) speeds.push(`TTFT avg ${formatMetricDuration(stats.ttftMs / stats.ttftSteps)}`)
    if (stats.decodeMs > 0) {
      speeds.push(`${formatMetricThroughput(stats.decodeTokens / (stats.decodeMs / 1_000))} tok/s`)
    }
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  if (usage !== undefined) {
    const input = billedInputTokens(usage)
    if (input > 0 || usage.outputTokens > 0) {
      if (input > 0) groups.push(`Cache hit ${Math.round(usage.cacheReadTokens / input * 100)}%`)
      groups.push(`Input ${formatMetricTokens(input)} tok · Output ${formatMetricTokens(usage.outputTokens)} tok`)
    }
  }
  return groups.length === 0 ? undefined : groups.join(' | ')
}

/** Width-aware terminal row that never wraps when the viewport shrinks. */
export class SessionStatsLineComponent implements Component {
  constructor(
    private readonly snapshot: () => {
      stats: SessionStatsProjection | undefined
      usage: TokenUsageProjection | undefined
    },
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const { stats, usage } = this.snapshot()
    const line = formatSessionStatsLine(stats, usage)
    if (line === undefined) return []
    // Leave one spare cell so terminals with pending-wrap semantics do not
    // move the metrics tail onto a phantom continuation row.
    const capacity = Math.max(1, width - 1)
    const clipped = truncateToWidth(line, capacity, '…')
    const margin = ' '.repeat(Math.max(0, Math.floor((capacity - visibleWidth(clipped)) / 2)))
    return [`${margin}${this.palette.dim(clipped)}`]
  }
}
