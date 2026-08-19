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
  it('reports healthy injected installation state as JSON', async () => {
    const paths = fixture()
    let output = ''
    const code = await runDoctor(['--json'], {
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

  it('reports a missing hoisted profile overlay by package specifier', async () => {
    const paths = fixture()
    rmSync(join(paths.assetRoot, '..', 'dsh-base', 'cordis.patch.yml'))
    let output = ''
    expect(await runDoctor(['--json'], {
      ...paths,
      stdout: (text) => { output += text },
    })).toBe(1)
    expect(parseDoctorOutput(output).checks).toContainEqual(expect.objectContaining({
      id: 'assets',
      status: 'fail',
      detail: '@deepseek-ai/dsh-base/cordis.patch.yml',
    }))
  })

  it.runIf(process.platform === 'win32')('detects Windows system commands without a version flag', async () => {
    const paths = fixture()
    let output = ''
    expect(await runDoctor(['--json'], {
      ...paths,
      platform: 'win32',
      stdout: (text) => { output += text },
    })).toBe(0)
    const report = parseDoctorOutput(output)
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sandbox', message: 'sandbox runner icacls is available' }))
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'clipboard', status: 'pass', message: 'clipboard command clip is available' }))
  })

  it('returns a blocking status for unsupported Node or malformed MCP', async () => {
    const paths = fixture()
    writeFileSync(join(paths.home, 'mcp.json'), '{')
    let output = ''
    const code = await runDoctor([], {
      ...paths,
      nodeVersion: '20.0.0',
      stdout: (text) => { output += text },
    })
    expect(code).toBe(1)
    expect(output).toContain('Node.js 20.0.0 is unsupported')
    expect(output).toContain('MCP catalog is invalid')
  })

  it('probes enabled MCP servers, skips disabled entries, and preserves optional startup failures as warnings', async () => {
    const paths = fixture()
    writeFileSync(join(paths.home, 'mcp.json'), JSON.stringify({
      version: 0,
      servers: {
        enabled: { transport: 'stdio', command: 'enabled-server', args: [] },
        disabled: { transport: 'stdio', command: 'disabled-server', args: [], enabled: false },
        optional: {
          transport: 'streamable-http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'MCP_SECRET' },
        },
      },
    }))
    const probed: string[] = []
    let output = ''
    expect(await runDoctor(['--json', '--mcp-timeout-ms', '1234'], {
      ...paths,
      env: { MCP_SECRET: 'secret-value' },
      stdout: (text) => { output += text },
      probeMcp: async (config, timeoutMs) => {
        probed.push(config.serverName)
        expect(timeoutMs).toBe(1234)
        if (config.serverName === 'optional') throw new Error('offline secret-value')
        return { toolCount: 2 }
      },
    })).toBe(0)
    expect(probed).toEqual(['enabled', 'optional'])
    const checks = parseDoctorOutput(output).checks
    expect(checks).toContainEqual(expect.objectContaining({ id: 'mcp:enabled', status: 'pass', message: 'MCP server connected (2 tools)' }))
    expect(checks).toContainEqual(expect.objectContaining({ id: 'mcp:disabled', status: 'pass', message: 'MCP server is disabled' }))
    expect(checks).toContainEqual(expect.objectContaining({ id: 'mcp:optional', status: 'warn', detail: 'offline <redacted>' }))
    expect(output).not.toContain('secret-value')
  })

  it('makes a required MCP startup failure blocking', async () => {
    const paths = fixture()
    writeFileSync(join(paths.home, 'mcp.json'), JSON.stringify({
      version: 0,
      servers: {
        required: {
          transport: 'stdio',
          command: 'required-server',
          args: [],
          failOnStartupError: true,
        },
      },
    }))
    let output = ''
    expect(await runDoctor(['--json'], {
      ...paths,
      stdout: (text) => { output += text },
      probeMcp: async () => { throw new Error('unreachable') },
    })).toBe(1)
    expect(parseDoctorOutput(output).checks).toContainEqual(expect.objectContaining({
      id: 'mcp:required',
      status: 'fail',
      detail: 'unreachable',
    }))
  })

  it('connects to a managed stdio server through the production probe', async () => {
    const paths = fixture()
    writeFileSync(join(paths.home, 'mcp.json'), JSON.stringify({
      version: 0,
      servers: {
        fixture: {
          transport: 'stdio',
          command: process.execPath,
          args: [
            '--import',
            'tsx/esm',
            join(process.cwd(), 'packages/mcp/mcp-client/tests/fixture-server.ts'),
          ],
          cwd: process.cwd(),
          failOnStartupError: true,
        },
      },
    }))
    let output = ''
    expect(await runDoctor(['--json', '--mcp-timeout-ms', '5000'], {
      ...paths,
      stdout: (text) => { output += text },
    })).toBe(0)
    expect(parseDoctorOutput(output).checks).toContainEqual(expect.objectContaining({
      id: 'mcp:fixture',
      status: 'pass',
      message: 'MCP server connected (6 tools)',
    }))
  })

  it('rejects unknown flags and prints help', async () => {
    let error = ''
    expect(await runDoctor(['--bogus'], { stderr: (text) => { error += text } })).toBe(1)
    expect(error).toContain('unknown option')
    let help = ''
    expect(await runDoctor(['--help'], { stdout: (text) => { help += text } })).toBe(0)
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
