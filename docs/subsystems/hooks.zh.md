# 生命周期 Hook

[English](hooks.md) | 中文

[`@deepseek-ai/dsh-hook-protocol`](../../packages/hooks/hook-protocol) 提供共享的 Claude Code／Codex command-hook 协议与只读 `ctx.hooks` 运行时目录。桥接插件在其 effect 生命周期内注册成功解析的配置来源；消费方只读取快照，不加载、启用、信任、禁用或编辑 hook。

Hook 执行仍位于类型化 `agent/*` 与 `tools/*` 拦截点。Profile 行与桥接 `configPath` 字段仍是配置权威来源。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxhooks--hookregistry"></a>

### `ctx.hooks` — `HookRegistry`

Registry of successfully loaded hook bridge configurations. Bridge plugins are Service Providers; terminal and future Web diagnostics are Consumers.

```ts cordis-catalog
/**
 * Register one loaded bridge configuration for the calling plugin's lifetime.
 * Multiple instances of the same dialect and path are valid profile composition.
 * @param registration - Configuration source and its parsed runnable/skipped handlers.
 * @returns The exact effect disposer that removes this contribution.
 */
register(registration: HookCatalogRegistration): () => void

/**
 * Snapshot every active bridge contribution in registration order.
 * @returns New top-level snapshot objects with derived handler totals.
 */
list(): HookCatalogSnapshot[]
```

Source: [`packages/hooks/hook-protocol/src/registry.ts:91`](../../packages/hooks/hook-protocol/src/registry.ts)
<!-- END GENERATED cordis-surface -->
