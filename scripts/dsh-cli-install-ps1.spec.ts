/**
 * Pins the Windows download installer: it fetches the win-x64 release
 * tarball, never clones the repository, and writes the same bin names as
 * the POSIX installer plus `dsh.cmd`.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const installerPath = resolve(import.meta.dirname, '..', 'apps/cli/install/install.ps1')
const installer = readFileSync(installerPath, 'utf8')

describe('apps/cli/install/install.ps1', () => {
  it('downloads the published win-x64 tarball and never clones', () => {
    expect(installer).toContain('deepseek-harness-cli-x64-win')
    expect(installer).toContain('releases/download')
    expect(installer).toContain('Get-FileHash')
    expect(installer).not.toContain('git clone')
    expect(installer).toContain('never clones the repository')
  })

  it('installs the exe and cmd launchers under .deepseek-harness-cli/bin', () => {
    expect(installer).toContain('.deepseek-harness-cli')
    expect(installer).toContain('deepseek-harness-cli.exe')
    expect(installer).toContain('dsh.cmd')
    expect(installer).toContain('deepseek.cmd')
  })

  it('refuses non-x64 Windows hosts', () => {
    expect(installer).toContain('PROCESSOR_ARCHITECTURE')
    expect(installer).toContain('supported: Windows x64')
  })

  it('bounds and retries every release download', () => {
    expect(installer).toContain('function Invoke-Download')
    expect(installer).toContain('TimeoutSec = $downloadTimeoutSecondsValue')
    expect(installer).toContain('download failed after $downloadAttemptsValue attempts')
    expect(installer).not.toMatch(/Invoke-WebRequest\s+-Uri/)
  })

  it.runIf(process.platform === 'win32')('recovers from transient asset failures without keeping a partial download', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-install-retry-'))
    const payload = join(root, 'payload')
    const tarballPath = join(root, 'deepseek-harness-cli-x64-win.tar.gz')
    const executableBody = 'retry-tested executable'
    const assetPath = '/deepseek-harness-cli-v9.9.9/deepseek-harness-cli-x64-win.tar.gz'
    const releasesPath = '/releases.atom'
    let tarballRequests = 0
    let server: ReturnType<typeof createServer> | undefined

    try {
      mkdirSync(join(payload, 'bin'), { recursive: true })
      writeFileSync(join(payload, 'bin', 'deepseek-harness-cli.exe'), executableBody)
      await execFileAsync('tar.exe', ['-czf', tarballPath, '-C', payload, 'bin'])
      const tarball = readFileSync(tarballPath)
      const checksum = createHash('sha256').update(tarball).digest('hex')

      server = createServer((request, response) => {
        if (request.url === releasesPath) {
          response.writeHead(200, { 'Content-Type': 'application/atom+xml' })
          response.end([
            '<?xml version="1.0" encoding="utf-8"?>',
            '<feed xmlns="http://www.w3.org/2005/Atom">',
            '<entry><link href="https://example.invalid/releases/tag/deepseek-harness-cli-v9.9.9" /></entry>',
            '</feed>',
          ].join(''))
          return
        }
        if (request.url === assetPath) {
          tarballRequests += 1
          if (tarballRequests < 3) {
            response.writeHead(503)
            response.end('temporary failure')
            return
          }
          response.writeHead(200, { 'Content-Length': tarball.length })
          response.end(tarball)
          return
        }
        if (request.url === `${assetPath.slice(0, -'.tar.gz'.length)}.sha256`) {
          response.writeHead(200)
          response.end(`${checksum}  deepseek-harness-cli-x64-win.tar.gz\n`)
          return
        }
        response.writeHead(404)
        response.end()
      })
      await new Promise<void>((resolveListen, rejectListen) => {
        server?.once('error', rejectListen)
        server?.listen(0, '127.0.0.1', resolveListen)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('test server did not bind a TCP port')

      const installDir = join(root, '带空格 Windows 安装')
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installerPath,
        '-BaseUrl',
        `http://127.0.0.1:${address.port}`,
        '-ReleasesUrl',
        `http://127.0.0.1:${address.port}${releasesPath}`,
        '-InstallDir',
        installDir,
        '-DownloadAttempts',
        '3',
        '-DownloadTimeoutSeconds',
        '5',
        '-DownloadRetryDelaySeconds',
        '0',
        '-SkipPath',
      ], { timeout: 20_000 })

      expect(tarballRequests).toBe(3)
      expect(stdout).toContain('installing deepseek-harness-cli 9.9.9 for win-x64')
      expect(stdout).toContain('download failed (1/3)')
      expect(stdout).toContain('download failed (2/3)')
      expect(readFileSync(join(installDir, 'bin', 'deepseek-harness-cli.exe'), 'utf8')).toBe(executableBody)
    } finally {
      if (server !== undefined) {
        const activeServer = server
        await new Promise<void>((resolveClose) => {
          activeServer.close(() => { resolveClose() })
        })
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it.runIf(process.platform === 'win32')('stops after the retry budget without replacing an installed executable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-install-exhausted-'))
    const installDir = join(root, 'existing installation')
    const installedExecutable = join(installDir, 'bin', 'deepseek-harness-cli.exe')
    const assetPath = '/deepseek-harness-cli-v9.9.9/deepseek-harness-cli-x64-win.tar.gz'
    let tarballRequests = 0
    let server: ReturnType<typeof createServer> | undefined

    try {
      mkdirSync(join(installDir, 'bin'), { recursive: true })
      writeFileSync(installedExecutable, 'existing executable')
      server = createServer((request, response) => {
        if (request.url === assetPath) {
          tarballRequests += 1
          response.writeHead(503)
          response.end('temporary failure')
          return
        }
        response.writeHead(404)
        response.end()
      })
      await new Promise<void>((resolveListen, rejectListen) => {
        server?.once('error', rejectListen)
        server?.listen(0, '127.0.0.1', resolveListen)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('test server did not bind a TCP port')

      await expect(execFileAsync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installerPath,
        '-Version',
        '9.9.9',
        '-BaseUrl',
        `http://127.0.0.1:${address.port}`,
        '-InstallDir',
        installDir,
        '-DownloadAttempts',
        '3',
        '-DownloadTimeoutSeconds',
        '5',
        '-DownloadRetryDelaySeconds',
        '0',
        '-SkipPath',
      ], { timeout: 20_000 })).rejects.toThrow()

      expect(tarballRequests).toBe(3)
      expect(readFileSync(installedExecutable, 'utf8')).toBe('existing executable')
    } finally {
      if (server !== undefined) {
        const activeServer = server
        await new Promise<void>((resolveClose) => {
          activeServer.close(() => { resolveClose() })
        })
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
