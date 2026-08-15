import { describe, expect, it } from 'vitest'
import {
  assertSafePackageDestination,
  parsePackWindowsCliArgs,
  packWindowsCliUsage,
  WINDOWS_CLI_DEFAULT_PROFILE,
  WINDOWS_CLI_ENTRY,
  WINDOWS_CLI_PRODUCT_LAUNCHER_NAME,
  WINDOWS_CLI_REQUIRED_RELATIVE_PATHS,
  windowsCliInstallManifest,
  windowsCliLauncherScript,
  windowsCliZipName,
} from './windows-cli-package.ts'

describe('windows-cli-package', () => {
  it('parses packer flags and keeps the usage text aligned with the CLI', () => {
    expect(parsePackWindowsCliArgs([])).toEqual({ skipBuild: false, dryRun: false, skipZip: false })
    expect(parsePackWindowsCliArgs(['--skip-build', '--dry-run', '--skip-zip'])).toEqual({
      skipBuild: true,
      dryRun: true,
      skipZip: true,
    })
    expect(packWindowsCliUsage()).toContain('--skip-build')
    expect(packWindowsCliUsage()).toContain('win32')
  })

  it('rejects a destination that is or contains the repository root', () => {
    expect(() => { assertSafePackageDestination('C:\\repo', 'C:\\repo') }).toThrow('repository root')
    expect(() => { assertSafePackageDestination('C:\\repo', 'C:\\') }).toThrow('contains the repository root')
    expect(() => { assertSafePackageDestination('C:\\repo', 'C:\\repo\\dist-windows\\dsh') }).not.toThrow()
  })

  it('writes a cmd launcher that boots tui only when the user passed no arguments', () => {
    const script = windowsCliLauncherScript()
    expect(script).toContain('if "%~1"=="" (')
    expect(script).toContain(`lib\\bin.js" ${WINDOWS_CLI_DEFAULT_PROFILE}`)
    expect(script).toContain('lib\\bin.js" %*')
    expect(script).toContain('NODE_USE_ENV_PROXY=1')
    expect(script.endsWith('\r\n')).toBe(true)
    expect(WINDOWS_CLI_PRODUCT_LAUNCHER_NAME).toBe('deepseek-harness-cli.cmd')
    expect(WINDOWS_CLI_REQUIRED_RELATIVE_PATHS).toContain(WINDOWS_CLI_PRODUCT_LAUNCHER_NAME)
  })

  it('records the install manifest the installer later checks', () => {
    expect(windowsCliInstallManifest({ version: '0.1.0-rc.5', arch: 'x64', node: '24.5.0' })).toEqual({
      name: 'dsh',
      version: '0.1.0-rc.5',
      platform: 'win32',
      arch: 'x64',
      node: '24.5.0',
      entry: WINDOWS_CLI_ENTRY,
      defaultProfile: WINDOWS_CLI_DEFAULT_PROFILE,
    })
    expect(windowsCliZipName('x64')).toBe('deepseek-harness-cli-x64-windows.zip')
    expect(windowsCliZipName('arm64')).toBe('deepseek-harness-cli-arm64-windows.zip')
  })
})
