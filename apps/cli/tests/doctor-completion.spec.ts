import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCompletion } from '../src/completion.ts'
import { runDoctor } from '../src/doctor.ts'

interface DoctorJsonReport {
  readonly version: string
  readonly ok: boolean
  readonly checks: ReadonlyArray<{
    readonly id: string
    readonly status: string
    readonly message: string
    readonly detail?: string
  }>
}

function parseDoctorOutput(output: string): DoctorJsonReport {
  return JSON.parse(output) as DoctorJsonReport
}

function fixture(): { home: string; assetRoot: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-doctor-'))
  const home = join(root, 'home')
  const packageScope = join(root, 'installation', 'node_modules', '@deepseek-ai')
  const assetRoot = join(packageScope, 'dsh')
  const cwd = join(root, 'workspace')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(assetRoot, 'config', 'agent-presets'), { recursive: true })
  for (const bundle of ['dsh-base', 'dsh-tui-app', 'dsh-headless', 'dsh-web-app']) {
    const packageRoot = join(packageScope, bundle)
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
      name: `@deepseek-ai/${bundle}`,
      exports: { './cordis.patch.yml': './cordis.patch.yml' },
    }))
    writeFileSync(join(packageRoot, 'cordis.patch.yml'), '[]\n')
  }
  const frontendRoot = join(packageScope, 'dsh-web-frontend')
  mkdirSync(join(frontendRoot, 'dist'), { recursive: true })
  writeFileSync(join(frontendRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-web-frontend',
    exports: { './dist/*': './dist/*' },
  }))
  writeFileSync(join(frontendRoot, 'dist', 'index.html'), '<!doctype html>\n')
  mkdirSync(cwd)
  writeFileSync(join(assetRoot, 'package.json'), JSON.stringify({ version: '0.1.0-test' }))
  return { home, assetRoot, cwd }
}

describe('doctor command', () => {
  it('reports healthy injected installation state as JSON', () => {
    const paths = fixture()
    let output = ''
    const code = runDoctor(['--json'], {
      ...paths,
      env: { DEEPSEEK_API_KEY: 'redacted', COLORTERM: 'truecolor' },
      nodeVersion: '22.19.0',
      platform: 'darwin',
      arch: 'arm64',
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stdout: (text) => { output += text },
    })
    expect(code).toBe(0)
    const report = parseDoctorOutput(output)
    expect(report).toMatchObject({ version: '0.1.0-test', ok: true })
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'assets', status: 'pass' }))
    expect(output).not.toContain('redacted')
  })

  it('reports a missing hoisted profile overlay by package specifier', () => {
    const paths = fixture()
    rmSync(join(paths.assetRoot, '..', 'dsh-base', 'cordis.patch.yml'))
    let output = ''
    expect(runDoctor(['--json'], {
      ...paths,
      stdout: (text) => { output += text },
    })).toBe(1)
    expect(parseDoctorOutput(output).checks).toContainEqual(expect.objectContaining({
      id: 'assets',
      status: 'fail',
      detail: '@deepseek-ai/dsh-base/cordis.patch.yml',
    }))
  })

  it.runIf(process.platform === 'win32')('detects Windows system commands without a version flag', () => {
    const paths = fixture()
    let output = ''
    expect(runDoctor(['--json'], {
      ...paths,
      platform: 'win32',
      stdout: (text) => { output += text },
    })).toBe(0)
    const report = parseDoctorOutput(output)
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sandbox', message: 'sandbox runner icacls is available' }))
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'clipboard', status: 'pass', message: 'clipboard command clip is available' }))
  })

  it('returns a blocking status for unsupported Node or malformed MCP', () => {
    const paths = fixture()
    writeFileSync(join(paths.home, 'mcp.json'), '{')
    let output = ''
    const code = runDoctor([], {
      ...paths,
      nodeVersion: '20.0.0',
      stdout: (text) => { output += text },
    })
    expect(code).toBe(1)
    expect(output).toContain('Node.js 20.0.0 is unsupported')
    expect(output).toContain('MCP catalog is not valid JSON')
  })

  it('rejects unknown flags and prints help', () => {
    let error = ''
    expect(runDoctor(['--bogus'], { stderr: (text) => { error += text } })).toBe(1)
    expect(error).toContain('unknown option')
    let help = ''
    expect(runDoctor(['--help'], { stdout: (text) => { help += text } })).toBe(0)
    expect(help).toContain('deepseek doctor [--json]')
  })
})
describe('completion command', () => {
  it('prints scripts for every supported shell', () => {
    for (const shell of ['bash', 'zsh', 'fish', 'powershell']) {
      let output = ''
      expect(runCompletion([shell], { stdout: (text) => { output += text } })).toBe(0)
      expect(output).toContain('deepseek')
      expect(output).toContain('completion')
    }
  })

  it('rejects an unsupported shell', () => {
    let error = ''
    expect(runCompletion(['cmd.exe'], { stderr: (text) => { error += text } })).toBe(1)
    expect(error).toContain('expected one of bash, zsh, fish, powershell')
  })
})
