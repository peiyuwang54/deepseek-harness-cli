import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatPackCommand, packWindowsCli, WindowsCliPack } from './pack-windows-cli.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pack-windows-cli', () => {
  it('quotes command arguments that contain spaces', () => {
    expect(formatPackCommand('pnpm.cmd', ['--filter', '@deepseek-ai/dsh', 'deploy', 'C:\\Program Files\\dsh']))
      .toBe(`pnpm.cmd --filter @deepseek-ai/dsh deploy ${JSON.stringify('C:\\Program Files\\dsh')}`)
  })

  it('prints the deploy and launcher steps without writing files in dry-run mode', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })
    const pipeline = new WindowsCliPack({ skipBuild: false, dryRun: true, skipZip: false })
    pipeline.assertHost()
    await pipeline.build()
    await pipeline.deployPackage()
    await pipeline.writeRuntimeFiles()
    await pipeline.verifyPackage()
    await pipeline.zipPackage()
    pipeline.printProduct()
    const text = logs.join('\n')
    expect(text).toContain('pnpm')
    expect(text).toContain('run build:lib')
    expect(text).toContain('deploy')
    expect(text).toContain('--legacy')
    expect(text).toContain('restore missing workspace and hoist dependencies')
    expect(text).toContain('@deepseek-ai/dsh')
    expect(text).toContain('dsh.cmd')
    expect(text).toContain('tar -a -cf')
    expect(text).toContain('[dry-run] would produce')
  })

  it('skips the library build and zip when those flags are set', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message))
    })
    const pipeline = new WindowsCliPack({ skipBuild: true, dryRun: true, skipZip: true })
    await pipeline.build()
    await pipeline.zipPackage()
    const text = logs.join('\n')
    expect(text).toContain('skipping pnpm run build:lib')
    expect(text).toContain('skipping zip')
    expect(text).not.toContain('tar -a -cf')
  })

  it('refuses a live pack on a non-Windows host and accepts the current Windows CPU', () => {
    const pipeline = new WindowsCliPack({ skipBuild: true, dryRun: false, skipZip: true })
    if (process.platform === 'win32') {
      expect(() => { pipeline.assertHost() }).not.toThrow()
      return
    }
    expect(() => { pipeline.assertHost() }).toThrow('must run on Windows')
  })

  it('prints usage and sets a nonzero exit code for unknown flags', async () => {
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message))
    })
    const previous = process.exitCode
    await packWindowsCli(['--unknown-flag'])
    expect(process.exitCode).toBe(1)
    process.exitCode = previous
    expect(errors.join('\n')).toContain('Usage: pnpm exec tsx scripts/pack-windows-cli.ts')
  })
})
