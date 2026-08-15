/** Runtime catalog for configured Claude Code and Codex hook bridges. @module @deepseek-ai/dsh-hook-protocol/registry */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandHook, HookDialect, MatcherGroup } from './types.ts'

/** One configured command handler exposed to human-facing diagnostics. */
export interface HookCatalogHandler {
  /** Exact shell command that the bridge will execute. */
  readonly command: string
  /** Per-handler timeout in seconds, when the configuration overrides the bridge default. */
  readonly timeoutSec?: number
}

/** One matcher group under a configured lifecycle event. */
export interface HookCatalogGroup {
  /** Dialect-specific matcher; omission means every invocation of the event. */
  readonly matcher?: string
  /** Runnable synchronous command handlers in configuration order. */
  readonly handlers: readonly HookCatalogHandler[]
}

/** One lifecycle event contributed by a configured bridge. */
export interface HookCatalogPoint {
  /** External hook event name, such as `PreToolUse`. */
  readonly point: string
  /** Matcher groups in configuration order. */
  readonly groups: readonly HookCatalogGroup[]
}

/** One configured handler that the bridge parsed but cannot execute. */
export interface SkippedHookCatalogEntry {
  /** External hook event name. */
  readonly point: string
  /** Stable human-readable reason the bridge skipped the handler. */
  readonly reason: string
}

/** Catalog contribution from one loaded hook bridge instance. */
export interface HookCatalogRegistration {
  /** External hook dialect implemented by the bridge. */
  readonly dialect: HookDialect
  /** Absolute source configuration path read by the bridge. */
  readonly configPath: string
  /** Runnable lifecycle events. */
  readonly points: readonly HookCatalogPoint[]
  /** Parsed handlers that are unsupported by this bridge. */
  readonly skipped: readonly SkippedHookCatalogEntry[]
}

/** Immutable catalog snapshot returned by {@link HookRegistry.list}. */
export interface HookCatalogSnapshot extends HookCatalogRegistration {
  /** Total runnable command handlers across every event and matcher group. */
  readonly handlerCount: number
}

/**
 * Convert a bridge's parsed matcher-group map into the common catalog form.
 * Empty events are omitted because they have no runnable handler to inspect.
 * @param config - Parsed dialect-local hook configuration.
 * @returns Runnable events and matcher groups in parser insertion order.
 */
export function hookCatalogPoints(
  config: Readonly<Record<string, readonly MatcherGroup[]>>,
): HookCatalogPoint[] {
  const points: HookCatalogPoint[] = []
  for (const [point, groups] of Object.entries(config)) {
    const catalogGroups = groups
      .filter(group => group.hooks.length > 0)
      .map(group => ({
        ...(group.matcher === undefined ? {} : { matcher: group.matcher }),
        handlers: group.hooks.map(handlerCatalogEntry),
      }))
    if (catalogGroups.length > 0) points.push({ point, groups: catalogGroups })
  }
  return points
}

/** Copy one trusted same-process command-hook value into catalog metadata. */
function handlerCatalogEntry(hook: CommandHook): HookCatalogHandler {
  return {
    command: hook.command,
    ...(hook.timeoutSec === undefined ? {} : { timeoutSec: hook.timeoutSec }),
  }
}

/**
 * Registry of successfully loaded hook bridge configurations. Bridge plugins
 * are Service Providers; terminal and future Web diagnostics are Consumers.
 */
export class HookRegistry extends Service {
  private readonly registrations = new Map<symbol, HookCatalogRegistration>()

  constructor(ctx: Context) {
    super(ctx, 'hooks')
  }

  /**
   * Register one loaded bridge configuration for the calling plugin's lifetime.
   * Multiple instances of the same dialect and path are valid profile composition.
   * @param registration - Configuration source and its parsed runnable/skipped handlers.
   * @returns The exact effect disposer that removes this contribution.
   */
  register(registration: HookCatalogRegistration): () => void {
    const token = Symbol(registration.dialect)
    const dispose = this.ctx.effect(() => {
      this.registrations.set(token, registration)
      return () => { this.registrations.delete(token) }
    }, 'hooks.register()')
    return () => { void dispose() }
  }

  /**
   * Snapshot every active bridge contribution in registration order.
   * @returns New top-level snapshot objects with derived handler totals.
   */
  list(): HookCatalogSnapshot[] {
    return [...this.registrations.values()].map(registration => ({
      ...registration,
      handlerCount: registration.points.reduce((total, point) =>
        total + point.groups.reduce((count, group) => count + group.handlers.length, 0), 0),
    }))
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Successfully loaded lifecycle-hook bridge configurations. */
    hooks: HookRegistry
  }
}

export default HookRegistry
