import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const installer = join(repoRoot, 'scripts/install/install.ps1')
const roots: string[] = []

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-win-install-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeCompletePackage(directory: string): void {
  mkdirSync(join(directory, 'lib'), { recursive: true })
  writeFileSync(join(directory, 'node.exe'), 'not-a-real-node')
  writeFileSync(join(directory, 'dsh.cmd'), '@echo off\r\necho dsh 0.0.0-test\r\n')
  writeFileSync(join(directory, 'deepseek-harness-cli.cmd'), '@echo off\r\necho 0.0.0-test\r\n')
  writeFileSync(join(directory, 'lib/bin.js'), 'console.log("ok")\n')
  writeFileSync(join(directory, 'dsh-install.json'), JSON.stringify({
    name: 'dsh',
    version: '0.0.0-test',
    platform: 'win32',
    arch: process.arch,
    node: process.versions.node,
    entry: 'lib/bin.js',
    defaultProfile: 'tui',
  }))
  writeFileSync(join(directory, 'package.json'), '{"name":"@deepseek-ai/dsh","version":"0.0.0-test"}\n')
}

describe('scripts/install/install.ps1', () => {
  it('downloads a release package and verifies both the sidecar and manifest', () => {
    const source = readFileSync(installer, 'utf8')
    expect(source).toContain('github.com/$Repository/releases/download')
    expect(source).toContain('Invoke-RestMethod')
    expect(source).toContain('Invoke-WebRequest')
    expect(source).toContain('Get-FileHash')
    expect(source).toContain('Expand-Archive')
    expect(source).toContain('Assert-PackageManifest')
    expect(source).toContain('deepseek-harness-cli-$architecture-windows.zip')
    expect(source).toContain('LOCALAPPDATA')
    expect(source).toContain('robocopy')
    expect(source).toContain('.backup-dsh.')
    expect(source).not.toContain('pnpm install')
  })

  it.skipIf(process.platform !== 'win32')('copies a packed tree into InstallDir without mutating PATH', async () => {
    const root = fixtureRoot()
    const packageDir = join(root, 'package')
    const installDir = join(root, 'installed')
    writeCompletePackage(packageDir)

    await execa('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      installer,
      '-InstallDir',
      installDir,
      '-PackageDir',
      packageDir,
      '-Version',
      '0.0.0-test',
      '-SkipPath',
      '-SkipVerify',
    ], {
      cwd: repoRoot,
      env: { ...process.env, DSH_NON_INTERACTIVE: '1' },
    })

    expect(readFileSync(join(installDir, 'dsh.cmd'), 'utf8')).toContain('dsh 0.0.0-test')
    expect(readFileSync(join(installDir, 'dsh-install.json'), 'utf8')).toContain('"name":"dsh"')
  })

  it.skipIf(process.platform !== 'win32')('downloads and verifies the matching release archive', async () => {
    const root = fixtureRoot()
    const packageDir = join(root, 'stage', 'dsh')
    const serverRoot = join(root, 'server')
    const releaseDir = join(serverRoot, 'releases', 'download', 'deepseek-harness-cli-v0.0.0-test')
    const assetName = `deepseek-harness-cli-${process.arch}-windows.zip`
    const asset = join(releaseDir, assetName)
    const installDir = join(root, 'installed-remote')
    writeCompletePackage(packageDir)
    mkdirSync(releaseDir, { recursive: true })
    await execa('tar', ['-a', '-cf', asset, '-C', join(root, 'stage'), 'dsh'])
    const digest = createHash('sha256').update(readFileSync(asset)).digest('hex')
    writeFileSync(`${asset}.sha256`, `${digest}  ${assetName}\n`)

    const server = createServer((request, response) => {
      const prefix = '/releases/download/deepseek-harness-cli-v0.0.0-test/'
      const file = request.url === `${prefix}${assetName}`
        ? asset
        : request.url === `${prefix}${assetName}.sha256`
          ? `${asset}.sha256`
          : undefined
      if (file === undefined) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200).end(readFileSync(file))
    })
    await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new TypeError('fixture server must use a TCP port')
      await execa('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installer,
        '-Version',
        '0.0.0-test',
        '-BaseUrl',
        `http://127.0.0.1:${address.port}/releases/download`,
        '-InstallDir',
        installDir,
        '-SkipPath',
      ], {
        cwd: repoRoot,
        env: { ...process.env, DSH_NON_INTERACTIVE: '1' },
      })
    } finally {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolvePromise()
            return
          }
          reject(error)
        })
      })
    }

    expect(readFileSync(join(installDir, 'deepseek-harness-cli.cmd'), 'utf8')).toContain('0.0.0-test')
  })
})
