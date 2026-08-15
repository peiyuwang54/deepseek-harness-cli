import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  writeFileSync(join(directory, 'deepseek.cmd'), '@echo off\r\necho deepseek 0.0.0-test\r\n')
  writeFileSync(join(directory, 'lib/bin.js'), 'console.log("ok")\n')
  writeFileSync(join(directory, 'dsh-install.json'), '{"name":"dsh"}\n')
  writeFileSync(join(directory, 'package.json'), '{"name":"@deepseek-ai/dsh","version":"0.0.0-test"}\n')
}

describe('scripts/install/install.ps1', () => {
  it('installs from a local checkout package and never names a download URL', () => {
    const source = readFileSync(installer, 'utf8')
    expect(source).toContain('never fetches a remote payload')
    expect(source).toContain('pack-windows-cli.ts')
    expect(source).toContain('--import')
    expect(source).toContain('tsx/esm')
    expect(source).toContain('LOCALAPPDATA')
    expect(source).toContain('robocopy')
    expect(source).not.toMatch(/https?:\/\/chatgpt\.com/)
    expect(source).not.toContain('Invoke-RestMethod')
    expect(source).not.toContain('irm ')
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
      '-SkipPack',
      '-SkipPath',
      '-SkipVerify',
    ], {
      cwd: repoRoot,
      env: { ...process.env, DSH_NON_INTERACTIVE: '1' },
    })

    expect(readFileSync(join(installDir, 'dsh.cmd'), 'utf8')).toContain('dsh 0.0.0-test')
    expect(readFileSync(join(installDir, 'deepseek.cmd'), 'utf8')).toContain('deepseek 0.0.0-test')
    expect(readFileSync(join(installDir, 'dsh-install.json'), 'utf8')).toContain('"name":"dsh"')
  })
})
