/**
 * Pins the Windows download installer: it fetches the win-x64 release
 * tarball, never clones the repository, and writes the same bin names as
 * the POSIX installer plus `dsh.cmd`.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const installer = readFileSync(resolve(import.meta.dirname, '..', 'apps/cli/install/install.ps1'), 'utf8')

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
})
