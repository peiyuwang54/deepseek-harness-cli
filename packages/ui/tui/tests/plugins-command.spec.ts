import { describe, expect, it } from 'vitest'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory'
import { pluginsCommandResult } from '../src/chat/plugins-command.ts'

/** Construct a package-owned opaque id for an inventory fixture. */
const pluginEntryId = (value: string): PluginEntryId => value as PluginEntryId

const inventory = {
  list: () => ({
    entries: [
      {
        entryId: pluginEntryId('tool-bash'),
        moduleName: '@deepseek-ai/dsh-tool-bash',
        enabled: true,
        fiberPhase: 'active' as const,
      },
      {
        entryId: pluginEntryId('web-search'),
        moduleName: '@deepseek-ai/dsh-web-search-deepseek',
        enabled: false,
        fiberPhase: null,
      },
      {
        entryId: pluginEntryId('custom-reviewer'),
        moduleName: '@example/dsh-reviewer',
        enabled: true,
        fiberPhase: 'failed' as const,
      },
    ],
  }),
}

describe('/plugins browser', () => {
  it('renders a bounded compact inventory with lifecycle totals', () => {
    expect(pluginsCommandResult('', inventory)).toEqual({
      kind: 'success',
      text: [
        'Plugins (3 configured · 1 active · 1 disabled)',
        '- tool-bash · active',
        '- web-search-deepseek · disabled',
        '- reviewer · failed',
        'Manage profile packages outside chat: deepseek plugin --profile tui install|update|remove|enable|disable <package>.',
      ].join('\n'),
    })
  })

  it('filters by module or Loader id and exposes full diagnostics in verbose mode', () => {
    expect(pluginsCommandResult('verbose custom', inventory)).toEqual({
      kind: 'success',
      text: [
        'Plugins (3 configured · 1 active · 1 disabled)',
        'Filter: custom · 1 matched',
        '- reviewer · failed',
        '  @example/dsh-reviewer · custom-reviewer',
        'Manage profile packages outside chat: deepseek plugin --profile tui install|update|remove|enable|disable <package>.',
      ].join('\n'),
    })
  })

  it('reports unavailable and empty search states', () => {
    expect(pluginsCommandResult('', undefined)).toEqual({
      kind: 'error',
      text: 'Plugin inventory is not available in this profile.',
    })
    expect(pluginsCommandResult('missing', inventory)).toEqual({
      kind: 'success',
      text: [
        'Plugins (3 configured · 1 active · 1 disabled)',
        'No plugins match "missing".',
        'Manage profile packages outside chat: deepseek plugin --profile tui install|update|remove|enable|disable <package>.',
      ].join('\n'),
    })
  })
})
