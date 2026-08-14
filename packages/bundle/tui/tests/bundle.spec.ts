/** The published manifest and patch are the terminal product composition. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('dsh-tui-app bundle', () => {
  it('publishes a parseable patch with every terminal-owned row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as Array<{ id?: string; disabled?: boolean; insert?: Array<{ id?: string; name?: string }> }>
    const rows = patches
      .flatMap(patch => patch.insert ?? [])
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tui-startup', name: '@deepseek-ai/dsh-tui-app/startup' }),
      expect.objectContaining({ id: 'tui-prompt', name: '@deepseek-ai/dsh-tui/prompt' }),
      expect.objectContaining({ id: 'tui-runner', name: '@deepseek-ai/dsh-tui-app' }),
      expect.objectContaining({ id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets' }),
      expect.objectContaining({ id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme' }),
      expect.objectContaining({ id: 'storage', name: '@deepseek-ai/dsh-storage' }),
      expect.objectContaining({ id: 'storage-json', name: '@deepseek-ai/dsh-storage-json' }),
      expect.objectContaining({ id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain' }),
      expect.objectContaining({ id: 'workspace', name: '@deepseek-ai/dsh-workspace' }),
      expect.objectContaining({ id: 'session-reference', name: '@deepseek-ai/dsh-session-reference' }),
    ]))
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tool-ask-user' }),
    ]))
    const disabledAgentRows = patches
      .filter(patch => patch.disabled === true)
      .map(patch => patch.id)
    expect(disabledAgentRows).toEqual(expect.arrayContaining([
      'tool-bash',
      'tool-pwsh',
      'tool-jobs',
      'tool-fs',
      'tool-fs-search',
      'tool-str-replace-editor',
      'skill-filesystem',
      'tool-skill',
      'tool-goal',
      'plan-mode',
      'compaction-basic',
      'command-compact',
      'tool-result-pruner',
      'tool-subagent-control',
      'tool-subagent-list-agents',
      'tool-subagent',
      'tool-subagent-fork',
      'workflow-worker-thread',
      'tool-workflow',
      'tool-ralph',
      'agent-instructions',
      'tool-todo',
      'tool-web',
    ]))
    for (const row of rows) {
      if (row.name?.startsWith('@deepseek-ai/') !== true) continue
      const packageName = row.name === '@deepseek-ai/dsh-tui/prompt'
        ? '@deepseek-ai/dsh-tui'
        : row.name === '@deepseek-ai/dsh-tui-app/startup'
          ? '@deepseek-ai/dsh-tui-app'
          : row.name
      if (packageName === '@deepseek-ai/dsh-tui-app') continue
      expect(manifest.dependencies, `${packageName} must be a runtime dependency`).toHaveProperty(packageName)
    }
  })
})
