import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectDshPackageLicenses } from './verify-dsh-package-licenses.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeManifest(root: string, file: string, manifest: Record<string, unknown>): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-licenses-'))
  roots.push(root)
  writeManifest(root, 'package.json', {
    name: '@deepseek-ai/dsh-root',
    license: 'MIT',
    workspaces: ['apps/*', 'packages/*/*', 'vendor/*'],
  })
  return root
}

describe('DSH package license gate', () => {
  it('checks root, unhyphenated CLI, and dsh-prefixed package names while ignoring other families', () => {
    const root = createWorkspace()
    writeManifest(root, 'apps/cli/package.json', { name: '@deepseek-ai/dsh', license: 'MIT' })
    writeManifest(root, 'packages/core/agent/package.json', {
      name: '@deepseek-ai/dsh-agent',
      license: 'BSD-3-Clause',
    })
    writeManifest(root, 'vendor/cordis/package.json', {
      name: '@deepseek-ai/cordis',
      license: 'BSD-3-Clause',
    })

    expect(inspectDshPackageLicenses(root)).toEqual({
      packageCount: 3,
      failures: [
        'packages/core/agent/package.json: @deepseek-ai/dsh-agent must declare "license": "MIT"; found "BSD-3-Clause".',
      ],
    })
  })

  it('rejects a missing license declaration', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/core/agent/package.json', { name: '@deepseek-ai/dsh-agent' })

    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent must declare "license": "MIT"; found undefined.',
    ])
  })

  it('accepts the exact restored-TUI conjunction and no broader DSH exception', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/ui/tui/package.json', {
      name: '@deepseek-ai/dsh-tui',
      license: '(MIT AND BSD-3-Clause)',
    })
    writeManifest(root, 'packages/ui/other/package.json', {
      name: '@deepseek-ai/dsh-other-ui',
      license: '(MIT AND BSD-3-Clause)',
    })

    expect(inspectDshPackageLicenses(root)).toEqual({
      packageCount: 3,
      failures: [
        'packages/ui/other/package.json: @deepseek-ai/dsh-other-ui must declare "license": "MIT"; found "(MIT AND BSD-3-Clause)".',
      ],
    })
  })

  it('rejects a TUI declaration that is equivalent-looking but not the exact policy string', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/ui/tui/package.json', {
      name: '@deepseek-ai/dsh-tui',
      license: 'MIT AND BSD-3-Clause',
    })

    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'packages/ui/tui/package.json: @deepseek-ai/dsh-tui must declare "license": "(MIT AND BSD-3-Clause)"; found "MIT AND BSD-3-Clause".',
    ])
  })
})
