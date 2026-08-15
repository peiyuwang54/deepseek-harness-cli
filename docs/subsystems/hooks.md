# Lifecycle Hooks

English | [中文](hooks.zh.md)

[`@deepseek-ai/dsh-hook-protocol`](../../packages/hooks/hook-protocol) provides the shared Claude Code / Codex command-hook protocol and the read-only `ctx.hooks` runtime catalog. Bridge plugins register successfully parsed configuration sources for their effect lifetime; consumers inspect snapshots without loading, enabling, trusting, disabling, or editing hooks.

Hook execution remains on the typed `agent/*` and `tools/*` interception points. Profile rows and bridge `configPath` fields remain the configuration authority.

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
