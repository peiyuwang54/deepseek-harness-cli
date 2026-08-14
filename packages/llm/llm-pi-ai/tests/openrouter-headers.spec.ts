import { describe, expect, it } from 'vitest'
import { APP_IDENTITY, userAgent } from '@deepseek-ai/dsh-llm'
import {
  OPENROUTER_PROVIDER,
  openRouterAttributionHeaders,
  requestHeaders,
} from '../src/openrouter-headers.ts'

describe('OpenRouter product headers', () => {
  it('uses the shared public identity on the explicit openrouter route', () => {
    expect(OPENROUTER_PROVIDER).toBe('openrouter')
    expect(openRouterAttributionHeaders()).toEqual({
      'http-referer': APP_IDENTITY.url,
      'x-openrouter-title': 'DeepSeek Harness',
    })
  })

  it('adds OpenRouter headers only for that route and keeps User-Agent reserved', () => {
    const openrouter = requestHeaders('openrouter', {
      'X-Company': 'private',
      'User-Agent': 'wrong',
      'HTTP-Referer': 'https://example.test',
    })
    expect(openrouter['HTTP-Referer']).toBe('https://example.test')
    expect(openrouter).not.toHaveProperty('http-referer')
    expect(openrouter['x-openrouter-title']).toBe('DeepSeek Harness')
    expect(openrouter['X-Company']).toBe('private')
    expect(openrouter['user-agent']).toBe(userAgent())

    const other = requestHeaders('deepseek', { 'X-Company': 'private' })
    expect(other).not.toHaveProperty('http-referer')
    expect(other).not.toHaveProperty('x-openrouter-title')
    expect(other['user-agent']).toBe(userAgent())
  })
})
