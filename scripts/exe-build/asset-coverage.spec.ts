/**
 * Tests for pkg asset coverage: the files the composed application reads at
 * runtime (bundle `cordis.patch.yml` overlays, the shipped `config/` tree, the
 * web frontend dist) must all be matched by ASSET_GLOBS, or the packaged
 * executable cannot read them from its `/snapshot/` filesystem.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ASSET_GLOBS, collectBundlePatchOverlays, expandGlob, findUncoveredAssets } from './asset-coverage.ts'

/** The staged closure fixture: one bundle, the app package's config tree, a frontend dist. */
let staging: string

/** The CLI product's required-asset globs, applied to the fixture. */
const REQUIRED_ASSET_GLOBS = [
  'node_modules/@deepseek-ai/dsh/config/**/*',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/**/*',
] as const

beforeAll(async () => {
  staging = await mkdtemp(join(tmpdir(), 'dsh-asset-coverage-'))
  const files: Record<string, string> = {
    'node_modules/@deepseek-ai/dsh-base/package.json': '{"dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}',
    'node_modules/@deepseek-ai/dsh-base/cordis.patch.yml': '[]',
    'node_modules/@deepseek-ai/dsh/package.json': '{"name":"@deepseek-ai/dsh"}',
    'node_modules/@deepseek-ai/dsh/config/agent-presets/standard/preset.yml': 'name: standard',
    'node_modules/@deepseek-ai/dsh/config/agent-presets/cordis/skills/editing/SKILL.md': '# editing',
    'node_modules/@deepseek-ai/dsh-web-frontend/package.json': '{"name":"@deepseek-ai/dsh-web-frontend"}',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html': '<!doctype html>',
    'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/app.js': '// app',
    'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js': '// boot',
  }
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(staging, file)), { recursive: true })
    await writeFile(join(staging, file), content)
  }
})

afterAll(async () => {
  await rm(staging, { recursive: true, force: true })
})

describe('findUncoveredAssets', () => {
  it('covers bundle overlays, the shipped config tree, and the frontend dist', async () => {
    const required = [
      ...await collectBundlePatchOverlays(staging),
      ...REQUIRED_ASSET_GLOBS.flatMap(pattern => expandGlob(staging, pattern)),
    ]
    expect(required.length).toBeGreaterThan(0)
    expect(findUncoveredAssets(staging, required)).toEqual([])
  })

  it('reports a runtime-read file kind no asset glob matches', () => {
    expect(findUncoveredAssets(staging, ['node_modules/@deepseek-ai/dsh/config/agent-presets/roster.toml']))
      .toEqual(['node_modules/@deepseek-ai/dsh/config/agent-presets/roster.toml'])
  })
})

describe('collectBundlePatchOverlays', () => {
  it('collects declared dsh.bundle.patch files and skips plain manifests', async () => {
    expect(await collectBundlePatchOverlays(staging)).toEqual([
      'node_modules/@deepseek-ai/dsh-base/cordis.patch.yml',
    ])
  })
})

describe('ASSET_GLOBS', () => {
  it('keeps code and data patterns for the staged tree', () => {
    expect(ASSET_GLOBS).toContain('node_modules/**/*.yml')
    expect(ASSET_GLOBS).toContain('node_modules/@deepseek-ai/dsh/config/**/*.md')
    expect(ASSET_GLOBS).toContain('node_modules/@deepseek-ai/dsh-web-frontend/dist/**/*')
    expect(findUncoveredAssets(staging, ['node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'])).toEqual([])
  })
})
