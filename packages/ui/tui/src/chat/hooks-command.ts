/** Read-only `/hooks` diagnostics over the active hook bridge registry. */

import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { HookCatalogSnapshot, HookRegistry } from '@deepseek-ai/dsh-hook-protocol'

type HookCatalogReader = Pick<HookRegistry, 'list'>

/** Render a stable source label for one supported bridge dialect. */
function dialectLabel(source: HookCatalogSnapshot): string {
  return source.dialect === 'codex' ? 'Codex' : 'Claude Code'
}

/** Count handlers under one catalog point. */
function pointHandlerCount(source: HookCatalogSnapshot['points'][number]): number {
  return source.groups.reduce((total, group) => total + group.handlers.length, 0)
}

/** Render one concise configured-source summary. */
function conciseSource(source: HookCatalogSnapshot): string[] {
  const lines = [
    `${dialectLabel(source)} · ${String(source.handlerCount)} handler${source.handlerCount === 1 ? '' : 's'} · ${source.configPath}`,
  ]
  for (const point of source.points) {
    const count = pointHandlerCount(point)
    lines.push(`  ${point.point} · ${String(count)} handler${count === 1 ? '' : 's'}`)
  }
  if (source.skipped.length > 0) lines.push(`  Skipped · ${String(source.skipped.length)}`)
  return lines
}

/** Render one configured source with matcher, command, timeout, and skip diagnostics. */
function verboseSource(source: HookCatalogSnapshot): string[] {
  const lines = conciseSource(source).slice(0, 1)
  for (const point of source.points) {
    lines.push(`  ${point.point}`)
    for (const group of point.groups) {
      lines.push(`    matcher: ${group.matcher ?? '*'}`)
      for (const handler of group.handlers) {
        const timeout = handler.timeoutSec === undefined ? '' : ` · timeout ${String(handler.timeoutSec)}s`
        lines.push(`    $ ${handler.command}${timeout}`)
      }
    }
  }
  for (const skipped of source.skipped) lines.push(`  skipped ${skipped.point}: ${skipped.reason}`)
  return lines
}

/**
 * Execute `/hooks` without mutating hook configuration or bridge state.
 * @param rawInput - Text following the slash command.
 * @param registry - Optional runtime hook catalog service.
 * @returns Command result rendered into the terminal transcript.
 */
export function hooksCommandResult(
  rawInput: string,
  registry: HookCatalogReader | undefined,
): CommandResult {
  const argument = rawInput.trim().toLowerCase()
  if (argument !== '' && argument !== 'verbose') {
    return { kind: 'error', text: 'Usage: /hooks [verbose]' }
  }
  if (registry === undefined) {
    return { kind: 'error', text: 'Hook diagnostics are not available in this profile.' }
  }
  const sources = registry.list()
  if (sources.length === 0) {
    return {
      kind: 'success',
      text: 'No lifecycle hooks are configured. Add a Codex or Claude Code hook bridge to this profile to load an existing hooks.json.',
    }
  }
  const render = argument === 'verbose' ? verboseSource : conciseSource
  return {
    kind: 'success',
    text: ['Lifecycle hooks', ...sources.flatMap((source, index) => [
      ...(index === 0 ? [] : ['']),
      ...render(source),
    ])].join('\n'),
  }
}
