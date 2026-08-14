/**
 * OpenRouter product-surface headers for the explicit `openrouter` catalog
 * route. Shared `attributionHeaders()` stays User-Agent only; these fields
 * are added only when the request names that route.
 *
 * @module dsh-llm-pi-ai/openrouter-headers
 */

import { APP_IDENTITY, attributionHeaders } from '@deepseek-ai/dsh-llm'

/** Catalog route that receives OpenRouter product-surface headers. */
export const OPENROUTER_PROVIDER = 'openrouter'

/**
 * OpenRouter app-attribution headers for one request on {@link OPENROUTER_PROVIDER}.
 * @returns `HTTP-Referer` and `X-OpenRouter-Title` from the shared public identity.
 */
export function openRouterAttributionHeaders(): Record<string, string> {
  return {
    'http-referer': APP_IDENTITY.url,
    'x-openrouter-title': 'DeepSeek Harness',
  }
}

/**
 * Merge profile headers with Harness `User-Agent` attribution, and with
 * OpenRouter product headers when the route is {@link OPENROUTER_PROVIDER}.
 * Profile values may replace the OpenRouter-specific names; they cannot
 * replace reserved attribution names.
 * @param provider - harness provider route.
 * @param headers - optional profile headers.
 * @returns headers to pass to pi-ai.
 */
export function requestHeaders(
  provider: string,
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map(name => name.toLowerCase()))
  const byLower = new Map<string, { name: string; value: string }>()
  if (provider === OPENROUTER_PROVIDER) {
    for (const [name, value] of Object.entries(openRouterAttributionHeaders())) {
      byLower.set(name.toLowerCase(), { name, value })
    }
  }
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase()
    if (reserved.has(lower)) continue
    byLower.set(lower, { name, value })
  }
  const merged: Record<string, string> = {}
  for (const { name, value } of byLower.values()) {
    merged[name] = value
  }
  return { ...merged, ...attribution }
}
