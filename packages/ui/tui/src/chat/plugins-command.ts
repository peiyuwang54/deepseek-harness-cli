/** Read-only `/plugins` browser over the active Cordis Loader inventory. */

import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type {
  PluginInventoryEntry,
  PluginInventoryGateway,
} from '@deepseek-ai/dsh-host-plugin-inventory'

type PluginInventoryReader = Pick<PluginInventoryGateway, 'list'>

const DEFAULT_RESULT_LIMIT = 20
const MANAGE_HINT = 'Manage profile packages outside chat: deepseek plugin --profile tui install|update|remove|enable|disable <package>.'

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/u, '')
    .replace(/^cordis-plugin-/u, '')
    .replace(/^dsh-(?:host-|client-)?/u, '')
}

/** Describe effective enablement and the current root Fiber phase. */
function pluginStatus(entry: PluginInventoryEntry): string {
  if (!entry.enabled) return 'disabled'
  return entry.fiberPhase ?? 'not loaded'
}

/** Whether one entry matches a case-insensitive package or Loader-id query. */
function matchesPlugin(entry: PluginInventoryEntry, query: string): boolean {
  if (query === '') return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(query))
}

/** Parse the optional verbose switch while retaining the rest as a search query. */
function parseInput(rawInput: string): { readonly query: string; readonly verbose: boolean } {
  const words = rawInput.trim().split(/\s+/u).filter(Boolean)
  const verbose = words[0]?.toLocaleLowerCase() === 'verbose'
  return {
    verbose,
    query: (verbose ? words.slice(1) : words).join(' ').toLocaleLowerCase(),
  }
}

/** Render one inventory row in compact or diagnostic form. */
function renderEntry(entry: PluginInventoryEntry, verbose: boolean): string {
  const shortName = moduleShortName(entry.moduleName)
  const status = pluginStatus(entry)
  return verbose
    ? `- ${shortName} · ${status}\n  ${entry.moduleName} · ${entry.entryId}`
    : `- ${shortName} · ${status}`
}

/**
 * Execute `/plugins` without changing the active Loader tree.
 * @param rawInput - Optional `verbose` switch and package or Loader-id query.
 * @param inventory - Optional current-profile inventory service.
 * @returns Bounded plugin catalog rendered into the terminal transcript.
 */
export function pluginsCommandResult(
  rawInput: string,
  inventory: PluginInventoryReader | undefined,
): CommandResult {
  if (inventory === undefined) {
    return { kind: 'error', text: 'Plugin inventory is not available in this profile.' }
  }
  const { query, verbose } = parseInput(rawInput)
  const snapshot = inventory.list()
  const matching = snapshot.entries.filter(entry => matchesPlugin(entry, query))
  const active = snapshot.entries.filter(entry => entry.enabled && entry.fiberPhase === 'active').length
  const disabled = snapshot.entries.filter(entry => !entry.enabled).length
  const heading = `Plugins (${String(snapshot.entries.length)} configured · ${String(active)} active · ${String(disabled)} disabled)`
  if (matching.length === 0) {
    return {
      kind: 'success',
      text: [
        heading,
        query === '' ? 'No plugins are configured.' : `No plugins match "${query}".`,
        MANAGE_HINT,
      ].join('\n'),
    }
  }
  const visible = matching.slice(0, DEFAULT_RESULT_LIMIT)
  const omitted = matching.length - visible.length
  return {
    kind: 'success',
    text: [
      heading,
      ...query === '' ? [] : [`Filter: ${query} · ${String(matching.length)} matched`],
      ...visible.map(entry => renderEntry(entry, verbose)),
      ...omitted === 0 ? [] : [`… ${String(omitted)} more; narrow the list with /plugins <query>`],
      MANAGE_HINT,
    ].join('\n'),
  }
}
