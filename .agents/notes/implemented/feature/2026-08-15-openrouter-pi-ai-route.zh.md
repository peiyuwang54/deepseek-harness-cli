# Agent Note: OpenRouter via the pi-ai catalog route

Status: implemented

[English](2026-08-15-openrouter-pi-ai-route.md) | 中文

## 问题

用户希望用一把 OpenRouter 密钥调用大量第三方模型。harness 已通过休眠的 `llm-pi-ai` 适配器带上 pi-ai 的 `openrouter` catalog（数百个 slug，端点 `https://openrouter.ai/api/v1`），但首次使用的机器没有活路由，也没有 OpenRouter 产品头。再做一个适配器包会与该 catalog 键冲突。共享的 `attributionHeaders()` 必须仍只发 User-Agent，见[强制归属决策](../architecture/2026-06-21-mandatory-app-attribution-headers.md)。

## 决策

OpenRouter 就是已有的 pi-ai catalog 路由 `openrouter`，不是新包。用户 settings 里的 `llm-pi-ai.providers.openrouter` profile 配上 `apiKeyEnv: OPENROUTER_API_KEY` 后，该路由上线并提供已安装 catalog。组合默认值仍是 `deepseek-official`；`agent-default-model` settings 可以把本机默认指到某个 OpenRouter slug。

仅当提供方路由恰好是 `openrouter` 时，请求在共享 `User-Agent` 之外再加 `HTTP-Referer`（`APP_IDENTITY.url`）和 `X-OpenRouter-Title`（`DeepSeek Harness`）。判定依据是路由键，不是 URL 片段或模型 id。profile 的 `headers` 可以覆盖这两个 OpenRouter 名称。其他路由（含 DeepSeek 与手写网关）不会收到它们。

## 测试

`packages/llm/llm-pi-ai/tests/openrouter-headers.spec.ts` 钉住头部合并。`adapter.spec.ts` 在 mock 的 `openrouter` 流上断言这两项，并在 `deepseek` 上断言它们不存在。`openrouter.e2e.ts` 在没有 `OPENROUTER_API_KEY` 时自行跳过。

## 曾考虑的替代方案

**单独的 `llm-openrouter` 包并占用 `openrouter`。** 否决，因为 pi-ai 已经提供该路由、端点、思考格式和 catalog。第二次注册会抛出 `DUPLICATE_ADAPTER`。

**把该路由写进基础 `cordis.patch.yml`。** 否决，因为产品插件在组合层保持按需启用；哪些 pi-ai 提供方运行由 settings 文档决定。

**把 OpenRouter 头放进 `attributionHeaders()`。** 被共享归属笔记否决。本决策就是该笔记推迟的显式 `provider: 'openrouter'` 模式。

**放行未登记 slug。** 本次不做。已安装 catalog 已列出数百个模型；`/model` 从已公布 id 中选择。未列出的 slug 仍失败为 `UNKNOWN_MODEL`。

## 后果

本机有 `OPENROUTER_API_KEY` 和该 settings 分节后，可用 `/model` 换模型，不必再装适配器。OpenRouter 排名能看到这些流量。若另一个路由键的 URL 碰巧指向 OpenRouter，仍只发 User-Agent。catalog 新鲜度取决于已安装的 pi-ai 版本；要加更新的 slug，需要 `models` 列表或升级 pi-ai。
