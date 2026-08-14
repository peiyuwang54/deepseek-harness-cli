/**
 * Tests for scripts/package-dsh-cli-npm.ts. The mapping and layout functions
 * are covered directly; the end-to-end suite packs the main and host-platform
 * packages with `npm pack`, extracts them into a fake global node_modules, and
 * runs the shim against the real host exe. That suite skips when no host exe has
 * been built (CI has none), leaving the pure mapping tests to run everywhere.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  PACKAGE_NAME,
  PLATFORMS,
  layoutMainPackage,
  layoutPlatformPackage,
  platformTarget,
} from './package-dsh-cli-npm.ts'

const root = resolve(import.meta.dirname, '..')
const host = platformTarget()
const hostExe = host === null ? undefined : resolve(root, 'dist-exe', `deepseek-harness-cli-${host.os}-${host.cpu}`)
const HOST_EXE_PRESENT = hostExe !== undefined && existsSync(hostExe)

function runIn(dir: string, command: string, args: string[]): string {
  return execFileSync(command, args, { cwd: dir, encoding: 'utf8', timeout: 120_000 }).trim()
}

describe('platformTarget', () => {
  it('maps every supported host', () => {
    expect(platformTarget('darwin', 'arm64')).toMatchObject({ os: 'macos', cpu: 'arm64' })
    expect(platformTarget('darwin', 'x64')).toMatchObject({ os: 'macos', cpu: 'x64' })
    expect(platformTarget('linux', 'arm64')).toMatchObject({ os: 'linux', cpu: 'arm64' })
    expect(platformTarget('linux', 'x64')).toMatchObject({ os: 'linux', cpu: 'x64' })
  })

  it('rejects unsupported platforms and architectures', () => {
    expect(platformTarget('win32', 'x64')).toBeNull()
    expect(platformTarget('linux', 'ia32')).toBeNull()
    expect(platformTarget('darwin', 'ppc64')).toBeNull()
  })

  it('names targets after the optionalDependencies alias convention', () => {
    expect(PLATFORMS.map(target => `${target.os}-${target.cpu}`).sort()).toEqual([
      'linux-arm64',
      'linux-x64',
      'macos-arm64',
      'macos-x64',
    ])
    for (const target of PLATFORMS) {
      expect(target.name).toBe(`${PACKAGE_NAME}-${target.os}-${target.cpu}`)
    }
  })
})

describe.skipIf(!HOST_EXE_PRESENT)('packaging e2e', () => {
  it('packs the shim + host platform package and runs the shim against the host exe', async () => {
    const version = '0.0.0-e2e'
    const distDir = resolve(root, 'dist-exe')
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-npm-spec-'))
    const outDir = join(tmp, 'out')

    const platformDir = await layoutPlatformPackage(outDir, host!, version, distDir)
    const mainDir = await layoutMainPackage(outDir, version)

    // `npm pack` both packages, then extract them into a fake global install.
    const packed = join(tmp, 'packed')
    mkdirSync(packed, { recursive: true })
    runIn(packed, 'npm', ['pack', platformDir, '--pack-destination', packed, '--silent'])
    runIn(packed, 'npm', ['pack', mainDir, '--pack-destination', packed, '--silent'])
    const tarballs = readdirSync(packed).filter(name => name.endsWith('.tgz'))
    const platformTgz = tarballs.find(name => name.includes(`-${host!.os}-${host!.cpu}.tgz`))
    const mainTgz = tarballs.find(name => name.includes(`${PACKAGE_NAME.replace('@peiyuwang54/', 'peiyuwang54-')}-${version}.tgz`))
    expect(platformTgz).toBeDefined()
    expect(mainTgz).toBeDefined()

    const consumer = join(tmp, 'consumer')
    const platformInstall = join(consumer, 'node_modules', host!.name)
    const mainInstall = join(consumer, 'node_modules', PACKAGE_NAME)
    mkdirSync(platformInstall, { recursive: true })
    mkdirSync(mainInstall, { recursive: true })
    const unpackMain = join(tmp, 'unpack-main')
    const unpackPlatform = join(tmp, 'unpack-platform')
    mkdirSync(unpackMain, { recursive: true })
    mkdirSync(unpackPlatform, { recursive: true })
    runIn(tmp, 'tar', ['-xzf', join(packed, mainTgz!), '-C', unpackMain])
    runIn(tmp, 'tar', ['-xzf', join(packed, platformTgz!), '-C', unpackPlatform])
    cpSync(join(unpackMain, 'package'), mainInstall, { recursive: true })
    cpSync(join(unpackPlatform, 'package'), platformInstall, { recursive: true })

    // The shim must resolve the platform exe and reproduce its --version output.
    const expected = runIn(root, hostExe!, ['--version'])
    const actual = runIn(consumer, 'node', [join(mainInstall, 'bin', 'deepseek-harness-cli.js'), '--version'])
    expect(actual).toBe(expected)
  }, 120_000)
})
