/**
 * Tests for scripts/package-dsh-cli-npm.ts. The mapping and layout functions
 * are covered directly; the end-to-end suite packs the main and host-platform
 * packages with `npm pack`, extracts them into a fake global node_modules, and
 * runs the shim against the real host exe. That suite skips when no host exe has
 * been built (CI has none), leaving the pure mapping tests to run everywhere.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
const hostRuntime = host === null ? undefined : resolve(root, 'dist-exe', `deepseek-harness-cli-${host.os}-${host.cpu}`)
const HOST_RUNTIME_PRESENT = hostRuntime !== undefined && existsSync(hostRuntime)

function runIn(dir: string, command: string, args: string[]): string {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command
  return execFileSync(executable, args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    shell: executable.endsWith('.cmd'),
  }).trim()
}

describe('platformTarget', () => {
  it('maps every supported host', () => {
    expect(platformTarget('darwin', 'arm64')).toMatchObject({ os: 'macos', cpu: 'arm64' })
    expect(platformTarget('darwin', 'x64')).toMatchObject({ os: 'macos', cpu: 'x64' })
    expect(platformTarget('linux', 'arm64')).toMatchObject({ os: 'linux', cpu: 'arm64' })
    expect(platformTarget('linux', 'x64')).toMatchObject({ os: 'linux', cpu: 'x64' })
    expect(platformTarget('win32', 'arm64')).toMatchObject({ os: 'windows', cpu: 'arm64' })
    expect(platformTarget('win32', 'x64')).toMatchObject({ os: 'windows', cpu: 'x64' })
  })

  it('rejects unsupported platforms and architectures', () => {
    expect(platformTarget('linux', 'ia32')).toBeNull()
    expect(platformTarget('darwin', 'ppc64')).toBeNull()
    expect(platformTarget('freebsd', 'x64')).toBeNull()
  })

  it('names targets after the optionalDependencies alias convention', () => {
    expect(PLATFORMS.map(target => `${target.os}-${target.cpu}`).sort()).toEqual([
      'linux-arm64',
      'linux-x64',
      'macos-arm64',
      'macos-x64',
      'windows-arm64',
      'windows-x64',
    ])
    for (const target of PLATFORMS) {
      expect(target.name).toBe(`${PACKAGE_NAME}-${target.os}-${target.cpu}`)
    }
  })

  it('uses npm platform identifiers instead of distribution suffixes', () => {
    expect(platformTarget('darwin', 'arm64')?.npmOs).toBe('darwin')
    expect(platformTarget('linux', 'x64')?.npmOs).toBe('linux')
    expect(platformTarget('win32', 'x64')?.npmOs).toBe('win32')
  })
})

describe('package layout', () => {
  it('copies a Windows directory runtime and publishes both Windows aliases', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-npm-windows-spec-'))
    try {
      const distDir = join(tmp, 'dist')
      const source = join(distDir, 'deepseek-harness-cli-windows-x64')
      mkdirSync(join(source, 'lib'), { recursive: true })
      writeFileSync(join(source, 'node.exe'), 'fixture')
      writeFileSync(join(source, 'lib', 'bin.js'), 'console.log("fixture")\n')
      writeFileSync(join(source, 'dsh.cmd'), '@echo off\r\n')
      writeFileSync(join(source, 'deepseek-harness-cli.cmd'), '@echo off\r\n')
      writeFileSync(join(source, 'dsh-install.json'), '{}\n')
      writeFileSync(join(source, 'package.json'), '{}\n')

      const target = platformTarget('win32', 'x64')!
      const platformDir = await layoutPlatformPackage(join(tmp, 'out'), target, '0.0.0-test', distDir)
      const manifest = JSON.parse(readFileSync(join(platformDir, 'package.json'), 'utf8')) as {
        os: string[]
        cpu: string[]
      }
      expect(manifest).toMatchObject({ os: ['win32'], cpu: ['x64'] })
      expect(readFileSync(join(platformDir, 'bin', 'node.exe'), 'utf8')).toBe('fixture')
      expect(readFileSync(join(platformDir, 'bin', 'lib', 'bin.js'), 'utf8')).toContain('fixture')

      const mainDir = await layoutMainPackage(join(tmp, 'out'), '0.0.0-test')
      const main = JSON.parse(readFileSync(join(mainDir, 'package.json'), 'utf8')) as {
        optionalDependencies: Record<string, string>
      }
      expect(main.optionalDependencies).toMatchObject({
        [`${PACKAGE_NAME}-windows-arm64`]: `npm:${PACKAGE_NAME}@0.0.0-test-windows-arm64`,
        [`${PACKAGE_NAME}-windows-x64`]: `npm:${PACKAGE_NAME}@0.0.0-test-windows-x64`,
      })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!HOST_RUNTIME_PRESENT)('packaging e2e', () => {
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
    const expected = host!.os === 'windows'
      ? runIn(root, join(hostRuntime!, 'node.exe'), [join(hostRuntime!, 'lib', 'bin.js'), '--version'])
      : runIn(root, hostRuntime!, ['--version'])
    const actual = runIn(consumer, 'node', [join(mainInstall, 'bin', 'deepseek-harness-cli.js'), '--version'])
    expect(actual).toBe(expected)
  }, 120_000)
})
