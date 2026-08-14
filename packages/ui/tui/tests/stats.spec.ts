import { describe, expect, it } from 'vitest'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { visibleWidth } from '@earendil-works/pi-tui'
import {
  formatMetricDuration,
  formatMetricThroughput,
  formatMetricTokens,
  formatSessionStatsLine,
  SessionStatsLineComponent,
} from '../src/chat/stats.ts'
import { createPalette } from '../src/components/theme.ts'

function stats(overrides: Partial<SessionStatsProjection> = {}): SessionStatsProjection {
  return {
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    ...overrides,
  }
}

function usage(overrides: Partial<TokenUsageProjection> = {}): TokenUsageProjection {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  }
}

describe('terminal session statistics line', () => {
  it('uses the Web thresholds for duration, tokens, and throughput', () => {
    expect(formatMetricDuration(45_240)).toBe('45.2s')
    expect(formatMetricDuration(162_000)).toBe('2m42s')
    expect(formatMetricTokens(7_650)).toBe('7.7K')
    expect(formatMetricTokens(1_250_000)).toBe('1.3M')
    expect(formatMetricThroughput(83.4)).toBe('83')
    expect(formatMetricThroughput(3.14)).toBe('3.1')
  })

  it('renders the same semantic groups as the Web composer strip', () => {
    expect(formatSessionStatsLine(stats({
      turns: 1,
      steps: 1,
      llmMs: 1_600,
      ttftMs: 1_200,
      ttftSteps: 1,
      decodeMs: 385,
      decodeTokens: 32,
    }), usage({ uncachedInputTokens: 7_700, outputTokens: 32 }))).toBe(
      '1 turn · 1 step | LLM 1.6s | TTFT avg 1.2s · 83 tok/s | Cache hit 0% | Input 7.7K tok · Output 32 tok',
    )
  })

  it('includes cached input in billing and omits unavailable timing groups', () => {
    expect(formatSessionStatsLine(undefined, usage({
      uncachedInputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 900,
    })))
      .toBe('Cache hit 90% | Input 1K tok · Output 5 tok')
    expect(formatSessionStatsLine(stats(), usage())).toBeUndefined()
  })

  it('elides a dense Web statistics row instead of wrapping a narrow terminal', () => {
    const component = new SessionStatsLineComponent(() => ({
      stats: stats({
        turns: 1,
        steps: 1,
        llmMs: 1_600,
        ttftMs: 1_200,
        ttftSteps: 1,
        decodeMs: 385,
        decodeTokens: 32,
      }),
      usage: usage({ uncachedInputTokens: 7_700, outputTokens: 32 }),
    }), createPalette(false))

    const rendered = component.render(72)
    expect(rendered).toHaveLength(1)
    expect(visibleWidth(rendered[0] ?? '')).toBeLessThanOrEqual(71)
    expect(rendered[0]).toContain('…')
    expect(rendered[0]).not.toContain('\n')
  })
})
