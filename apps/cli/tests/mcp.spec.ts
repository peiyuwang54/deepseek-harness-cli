import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { managedMcpDumpPatches, managedMcpPatches, runMcp } from '../src/mcp.ts'

const roots: string[] = []

async function configPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-test-'))
  roots.push(root)
  return join(root, 'mcp.json')
}

function capture(path: string, cwd = '/workspace'): {
  readonly options: Parameters<typeof runMcp>[1]
  readonly stdout: string[]
  readonly stderr: string[]
} {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    options: {
      configPath: path,
      cwd,
      stdout: (text) => { stdout.push(text) },
      stderr: (text) => { stderr.push(text) },
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('MCP CLI management', () => {
  it('adds, inspects, projects, and removes a stdio server without persisting a secret', async () => {
    const path = await configPath()
    const workdir = join(dirname(path), 'workspace')
    const output = capture(path, workdir)
    expect(await runMcp([
      'add', 'GitHub', '--env', 'TOKEN=GITHUB_TOKEN', '--cwd', 'repo', '--timeout-ms', '1234',
      '--fail-on-startup-error', '--', 'node', 'server.js', '--stdio',
    ], output.options)).toBe(0)

    const stored = await readFile(path, 'utf8')
    expect(stored).toContain('"TOKEN": "GITHUB_TOKEN"')
    expect(stored).not.toContain('secret-token')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(managedMcpPatches(path, { GITHUB_TOKEN: 'secret-token' })).toEqual([{
      insert: [{
        id: 'managed-mcp-GitHub',
        name: '@deepseek-ai/dsh-mcp-client',
        config: {
          transport: 'stdio',
          serverName: 'GitHub',
          command: 'node',
          args: ['server.js', '--stdio'],
          env: { TOKEN: 'secret-token' },
          cwd: join(workdir, 'repo'),
          toolCallTimeoutMs: 1234,
          failOnStartupError: true,
        },
      }],
    }])

    expect(await runMcp(['get', 'GitHub'], output.options)).toBe(0)
    expect(output.stdout.at(-1)).toContain('env: TOKEN <- $GITHUB_TOKEN')
    expect(output.stdout.at(-1)).not.toContain('secret-token')
    expect(await runMcp(['remove', 'GitHub'], output.options)).toBe(0)
    expect(managedMcpPatches(path, {})).toEqual([])
  })

  it('manages HTTP servers with header references and stable list ordering', async () => {
    const path = await configPath()
    const output = capture(path)
    expect(await runMcp(['add', 'zeta', '--url', 'https://example.com/mcp', '--header', 'Authorization=AUTH_TOKEN'], output.options)).toBe(0)
    expect(await runMcp(['add', 'alpha', '--url', 'http://localhost:8080/mcp'], output.options)).toBe(0)
    expect(await runMcp(['list'], output.options)).toBe(0)
    expect(output.stdout.at(-1)).toBe([
      'MCP servers (2)',
      '- alpha · streamable-http · http://localhost:8080/mcp',
      '- zeta · streamable-http · https://example.com/mcp',
      '',
    ].join('\n'))
    expect(managedMcpPatches(path, { AUTH_TOKEN: 'Bearer secret' })).toEqual([{
      insert: [
        {
          id: 'managed-mcp-alpha',
          name: '@deepseek-ai/dsh-mcp-client',
          config: {
            transport: 'streamable-http', serverName: 'alpha', url: 'http://localhost:8080/mcp', headers: {},
          },
        },
        {
          id: 'managed-mcp-zeta',
          name: '@deepseek-ai/dsh-mcp-client',
          config: {
            transport: 'streamable-http', serverName: 'zeta', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret' },
          },
        },
      ],
    }])
    expect(JSON.stringify(managedMcpDumpPatches(path))).toContain('<environment:AUTH_TOKEN>')
    expect(JSON.stringify(managedMcpDumpPatches(path))).not.toContain('Bearer secret')
  })

  it('fails closed for invalid commands, duplicate names, malformed durable data, and missing references', async () => {
    const path = await configPath()
    const output = capture(path)
    expect(await runMcp(['add', 'demo', '--', 'node', 'server.js'], output.options)).toBe(0)
    expect(await runMcp(['add', 'demo', '--', 'other'], output.options)).toBe(1)
    expect(await runMcp(['add', 'bad name', '--', 'node'], output.options)).toBe(1)
    expect(await runMcp(['add', 'http', '--url', 'ftp://example.com/mcp'], output.options)).toBe(1)
    expect(await runMcp(['add', 'credentials', '--url', 'https://token@example.com/mcp'], output.options)).toBe(1)
    expect(await runMcp(['add', 'mixed', '--url', 'https://example.com/mcp', '--', 'node'], output.options)).toBe(1)
    expect(await runMcp(['remove', 'missing'], output.options)).toBe(1)

    await writeFile(path, JSON.stringify({ version: 1, servers: {} }))
    expect(() => managedMcpPatches(path, {})).toThrow(/unsupported version/u)
    await writeFile(path, JSON.stringify({
      version: 0,
      servers: { demo: { transport: 'stdio', command: 'node', args: [], env: { TOKEN: 'MISSING' } } },
    }))
    expect(() => managedMcpPatches(path, {})).toThrow(/unset environment variable MISSING/u)
    await writeFile(path, '{')
    expect(await runMcp(['list'], output.options)).toBe(1)
    expect(output.stderr.at(-1)).toContain('failed to parse')
  })

  it('defaults to list and exposes help without creating a catalog', async () => {
    const path = await configPath()
    const output = capture(path)
    expect(await runMcp([], output.options)).toBe(0)
    expect(output.stdout.at(-1)).toBe('No MCP servers configured.\n')
    expect(await runMcp(['--help'], output.options)).toBe(0)
    expect(output.stdout.at(-1)).toContain('deepseek mcp add')
  })
})
