/**
 * Tests for scripts/gen-dsh-cask.ts: the pure generator covers the URL
 * construction, the double-nested sha256 blocks, and the livecheck; the sidecar
 * reader covers parsing and failure modes.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { generateCask, readPlatformShas, releaseAssetStem } from './gen-dsh-cask.ts'

const SHAS = {
  'macos-arm64': 'a'.repeat(64),
  'macos-x64': 'b'.repeat(64),
  'linux-arm64': 'c'.repeat(64),
  'linux-x64': 'd'.repeat(64),
}

describe('releaseAssetStem', () => {
  it('writes the published <cpu>-<os> sidecar stem', () => {
    expect(releaseAssetStem('macos-arm64')).toBe('arm64-macos')
    expect(releaseAssetStem('linux-x64')).toBe('x64-linux')
  })
})

describe('generateCask', () => {
  it('builds the per-platform URL from Homebrew arch/os macros and the version tag', () => {
    const cask = generateCask('0.1.0-rc.5', SHAS)
    expect(cask).toContain('version "0.1.0-rc.5"')
    expect(cask).toContain('arch arm: "arm64", intel: "x64"')
    expect(cask).toContain('os macos: "macos", linux: "linux"')
    expect(cask).toContain('deepseek-harness-cli-v#{version}/deepseek-harness-cli-#{arch}-#{os}.tar.gz')
  })

  it('nests the four distinct digests under on_macos/on_linux and on_arm/on_intel', () => {
    const cask = generateCask('0.1.0-rc.5', SHAS)
    for (const digest of Object.values(SHAS)) expect(cask).toContain(digest)
    expect(cask.indexOf('on_macos')).toBeLessThan(cask.indexOf('on_linux'))
    expect(cask).toContain('binary "bin/deepseek-harness-cli", target: "deepseek"')
    expect(cask).toContain('binary "bin/deepseek-harness-cli"')
  })

  it('adds a livecheck that matches deepseek-harness-cli-v<version> tags', () => {
    const cask = generateCask('0.1.0-rc.5', SHAS)
    expect(cask).toContain('strategy :github_releases')
    expect(cask).toContain(String.raw`regex(/^deepseek-harness-cli-v(\d+\.\d+\.\d+(?:-rc\.\d+)?)$/i)`)
  })
})

describe('readPlatformShas', () => {
  it('parses the published sidecar format', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cask-spec-'))
    for (const [target, digest] of Object.entries(SHAS)) {
      const stem = releaseAssetStem(target as keyof typeof SHAS)
      writeFileSync(join(dir, `deepseek-harness-cli-${stem}.sha256`), `${digest}  deepseek-harness-cli-${stem}.tar.gz\n`)
    }
    expect(await readPlatformShas(dir)).toEqual(SHAS)
  })

  it('rejects a missing sidecar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cask-spec-'))
    mkdirSync(dir, { recursive: true })
    await expect(readPlatformShas(dir)).rejects.toThrow(/deepseek-harness-cli-arm64-macos\.sha256 missing/)
  })

  it('rejects a non-hex digest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cask-spec-'))
    writeFileSync(join(dir, 'deepseek-harness-cli-arm64-macos.sha256'), 'not-a-digest\n')
    await expect(readPlatformShas(dir)).rejects.toThrow(/64-hex sha256/)
  })
})
