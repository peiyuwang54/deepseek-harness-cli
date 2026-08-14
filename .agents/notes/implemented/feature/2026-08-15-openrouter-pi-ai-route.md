# Agent Note: OpenRouter via the pi-ai catalog route

Status: implemented

English | [中文](2026-08-15-openrouter-pi-ai-route.zh.md)

## Problem

Users want to call many third-party models through one OpenRouter key. The harness already ships pi-ai's `openrouter` catalog (hundreds of slugs, `https://openrouter.ai/api/v1`) behind the dormant `llm-pi-ai` adapter, but a first-run machine has no live route and no OpenRouter product headers. A second adapter package would collide with that catalog key. Shared `attributionHeaders()` must stay User-Agent only, per the [mandatory attribution decision](../architecture/2026-06-21-mandatory-app-attribution-headers.md).

## Decision

OpenRouter is the existing pi-ai catalog route `openrouter`, not a new package. A user-settings `llm-pi-ai.providers.openrouter` profile with `apiKeyEnv: OPENROUTER_API_KEY` registers the route live and serves the installed catalog. The composition default remains `deepseek-official`; `agent-default-model` settings may point a machine at an OpenRouter slug.

Requests whose provider route is exactly `openrouter` add `HTTP-Referer` (`APP_IDENTITY.url`) and `X-OpenRouter-Title` (`DeepSeek Harness`) beside the shared `User-Agent`. Detection is the route key, not a URL fragment or model id. Profile `headers` may replace those two OpenRouter names. Other routes, including DeepSeek and hand-declared gateways, do not receive them.

## Testing

`packages/llm/llm-pi-ai/tests/openrouter-headers.spec.ts` pins the header merge. `adapter.spec.ts` asserts the OpenRouter pair on a mock `openrouter` stream and their absence on `deepseek`. `openrouter.e2e.ts` self-skips without `OPENROUTER_API_KEY`.

## Alternatives considered

**A dedicated `llm-openrouter` package owning `openrouter`.** Rejected because pi-ai already ships that route, endpoint, thinking format, and catalog. A second registration would throw `DUPLICATE_ADAPTER`.

**Ship the route in the base `cordis.patch.yml`.** Rejected because product plugins stay opt-in at composition; which pi-ai providers run is the settings document.

**Put OpenRouter headers in `attributionHeaders()`.** Rejected by the shared-attribution note. This decision is the explicit `provider: 'openrouter'` mode that note deferred.

**Pass through unknown slugs.** Rejected for this change. The installed catalog already lists hundreds of models; `/model` selects among advertised ids. An unlisted slug still fails `UNKNOWN_MODEL`.

## Consequences

A machine with `OPENROUTER_API_KEY` and the settings section can switch models with `/model` without another adapter. OpenRouter rankings can see this traffic. A URL that happens to host OpenRouter under another route key still gets User-Agent only. The catalog is as current as the installed pi-ai version; adding a newer slug is a `models` list or a pi-ai upgrade.
