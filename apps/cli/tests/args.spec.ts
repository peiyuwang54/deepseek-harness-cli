import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDshArgs } from '../src/args.ts'

const parse = (argv: string[]) => parseDshArgs(argv, '1.2.3')

/** Capture the process exit code while muting Commander's output. */
function exitCode(argv: string[]): number {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch {
    return exit.mock.calls.at(-1)?.[0] as number
  } finally {
    vi.restoreAllMocks()
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('parseDshArgs', () => {
  it('routes profile boots and the shipped aliases, handing the rest to the app', () => {
    expect(parse([])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['--full-auto']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--full-auto'] })
    expect(parse(['--yolo']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--yolo'] })
    expect(parse(['--dangerously-bypass-approvals-and-sandbox']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--dangerously-bypass-approvals-and-sandbox'] })
    expect(parse(['--full-auto', '--help']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--full-auto', '--help'] })
    expect(parse(['--profile', 'tui'])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--patch', 'b.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml', 'b.yml'], args: [] })
    expect(parse(['web'])).toEqual({ mode: 'profile', profile: 'web', patches: [], args: [] })
    expect(parse(['web', '--patch', 'web.yml']))
      .toEqual({ mode: 'profile', profile: 'web', patches: ['web.yml'], args: [] })
    expect(parse(['tui'])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['tui', '--patch', 'terminal.yml', '--resume', 'session-a']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['terminal.yml'], args: ['--resume', 'session-a'] })
    expect(parse(['exec', '--json', 'review', 'this', 'repository']))
      .toEqual({ mode: 'profile', profile: 'headless', patches: [], args: ['--json', 'review', 'this', 'repository'] })
  })

  it('ends the launcher flags at the first token it does not own', () => {
    // App flags, including its -h, and positionals reach the app verbatim.
    expect(parse(['--profile', 'tui', '--resume', 'abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'abc'] })
    expect(parse(['--profile', 'web', '-h']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['-h'] })
    expect(parse(['web', '--host', '127.0.0.1', '--port', '8080', '--dev']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--host', '127.0.0.1', '--port', '8080', '--dev'] })
    expect(parse(['tui', '--resume', 'abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'abc'] })
    expect(parse(['--profile', 'headless', 'run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'headless', patches: [], args: ['run', 'the', 'tests'] })
    // Launcher flags placed after that boundary belong to the app too.
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--resume', 'b', '--patch', 'late.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml'], args: ['--resume', 'b', '--patch', 'late.yml'] })
  })

  it('routes the plugin pnpm forwarder', () => {
    expect(parse(['plugin', '--profile', 'tui', 'add', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'remove', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['remove', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'why', '@deepseek-ai/cordis']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['why', '@deepseek-ai/cordis'] })
    // Unknown pnpm flags forward verbatim.
    expect(parse(['plugin', '--profile', 'tui', 'add', '--save-dev', 'x']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', '--save-dev', 'x'] })
  })

  it('routes boot-free MCP management arguments verbatim', () => {
    expect(parse(['mcp'])).toEqual({ mode: 'mcp', args: [] })
    expect(parse(['mcp', 'list'])).toEqual({ mode: 'mcp', args: ['list'] })
    expect(parse(['mcp', '--help'])).toEqual({ mode: 'mcp', args: ['--help'] })
    expect(parse(['mcp', 'add', 'filesystem', '--env', 'TOKEN=GITHUB_TOKEN', '--', 'npx', '-y', 'server']))
      .toEqual({
        mode: 'mcp',
        args: ['add', 'filesystem', '--env', 'TOKEN=GITHUB_TOKEN', '--', 'npx', '-y', 'server'],
      })
  })

  it('routes boot-free diagnostics and completion arguments', () => {
    expect(parse(['doctor'])).toEqual({ mode: 'doctor', args: [] })
    expect(parse(['doctor', '--json'])).toEqual({ mode: 'doctor', args: ['--json'] })
    expect(parse(['completion', 'zsh'])).toEqual({ mode: 'completion', args: ['zsh'] })
  })

  it('routes profile and shipped-alias config dumps', () => {
    expect(parse(['--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: [] })
    expect(parse(['--profile', 'web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['--profile', 'web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
    expect(parse(['--profile', 'tui', '--dump-config', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: ['x.yml'] })
    expect(parse(['web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
    expect(parse(['tui', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: [] })
    expect(parse(['tui', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: true, patches: [] })
    expect(parse(['exec', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'headless', defaultOnly: false, patches: [] })
    expect(parse(['exec', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'headless', defaultOnly: true, patches: [] })
  })

  it('hands unowned root arguments to the default terminal profile', () => {
    expect(parse(['--config', 'c.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--config', 'c.yml'] })
    expect(parse(['-p', 'task']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['-p', 'task'] })
    expect(parse(['run', 'task']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['run', 'task'] })
    expect(parse(['--bogus']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--bogus'] })
  })

  it('rejects contradictory launcher inputs', () => {
    expect(exitCode(['--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', '--patch='])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-default-config', '--patch', 'p.yml'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', 'task'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'web'])).toBe(1)
    expect(exitCode(['web', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['web', '--dump-default-config', '--patch', 'w.yml'])).toBe(1)
    expect(exitCode(['web', '--patch='])).toBe(1)
    expect(exitCode(['tui', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['tui', '--dump-default-config', '--patch', 't.yml'])).toBe(1)
    expect(exitCode(['tui', '--patch='])).toBe(1)
    expect(exitCode(['exec', '--dump-config', '--json', 'task'])).toBe(1)
    // A dump never runs app command-line providers, so it cannot show what
    // those flags would decide; printing a tree that differs from the same
    // invocation's boot would mislead.
    expect(exitCode(['web', '--dump-config', '--port', '8080'])).toBe(1)
    expect(exitCode(['tui', '--dump-config', '--resume', 'abc'])).toBe(1)
    expect(exitCode(['--profile', 'web', '--dump-config', '-h'])).toBe(1)
    expect(exitCode(['plugin', 'add', 'x'])).toBe(1) // --profile required
    expect(exitCode(['plugin', '--profile', 'tui'])).toBe(1) // nothing to forward
    expect(exitCode(['plugin', '--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', 'plugin', 'add', 'y'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'mcp', 'list'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'doctor'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'completion', 'zsh'])).toBe(1)
  })

  it('keeps the launcher help discoverable at the bare front door', () => {
    expect(exitCode(['--help'])).toBe(0)
    expect(exitCode(['-h'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })
})
