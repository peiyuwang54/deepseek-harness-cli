/**
 * Shared hook protocol and runtime registry: matching, command execution,
 * decoding, restrictive outcome merging, durable event helpers, configured
 * bridge discovery, and detached run quiescence. Claude Code and Codex bridges
 * own their distinct payloads, environment rules, matcher mode, and typed
 * extension-point mappings.
 * @module @deepseek-ai/dsh-hook-protocol
 */

import { HookRegistry } from './registry.ts'

export type {
  CommandHook,
  HookDialect,
  HookOutput,
  MatcherGroup,
  MatcherMode,
} from './types.ts'
export { matcherDiagnostic, matchesMatcher } from './matcher.ts'
export { parseHookOutput } from './codec.ts'
export { DEFAULT_HOOK_TIMEOUT_MS, runHook } from './runner.ts'
export type { RunHookOptions, RunHookResult } from './runner.ts'
export { mergeHookOutputs } from './merge.ts'
export type { MergedDecision, MergedHookOutcome } from './merge.ts'
export { appendHookInvoked, appendHookResult, DEFAULT_STDERR_SUMMARY_MAX_CHARS, summarizeStderr } from './events.ts'
export type { HookInvocation, HookResultRecord } from './events.ts'
export { createDetachedRuns } from './detached.ts'
export type { DetachedRuns } from './detached.ts'
export { HookRegistry, hookCatalogPoints } from './registry.ts'
export type {
  HookCatalogGroup,
  HookCatalogHandler,
  HookCatalogPoint,
  HookCatalogRegistration,
  HookCatalogSnapshot,
  SkippedHookCatalogEntry,
} from './registry.ts'

/** Default Cordis provider for the `ctx.hooks` runtime catalog. */
export default class HookRegistryPlugin extends HookRegistry {}
