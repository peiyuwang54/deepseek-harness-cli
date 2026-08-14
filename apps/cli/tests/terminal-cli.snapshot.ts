import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import {
  LOADER_SMOKE_TEST_TIMEOUT_MS,
  resolveExampleLaunch,
  resolveExampleMode,
} from '@deepseek-ai/dsh-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const fixtureDir = fileURLToPath(new URL('./snapshots/terminal-cli-journey/', import.meta.url))
const freshReplay = join(fixtureDir, 'fresh.session.jsonl')
const resumeReplay = join(fixtureDir, 'resume.session.jsonl')
const terminalExpected = join(fixtureDir, 'terminal.expected.txt')
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

const POSIX_TERMINAL_CLI_DRIVER = String.raw`
import errno, json, os, pty, select, signal, sys, time
node, launch_args_json, launch_env_json, cwd, actions_json, timeout_seconds, expected_exit = sys.argv[1:]
env = os.environ.copy()
env.update(json.loads(launch_env_json))
actions = [(marker.encode("utf-8"), reply.encode("utf-8")) for marker, reply in json.loads(actions_json)]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, *json.loads(launch_args_json)], env)

output = bytearray()
action_index = 0
scan_start = 0
deadline = time.monotonic() + float(timeout_seconds)
status = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)
    while action_index < len(actions):
        marker, reply = actions[action_index]
        position = output.find(marker, scan_start)
        if position == -1:
            break
        os.write(fd, reply)
        scan_start = position + len(marker)
        action_index += 1
    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate
        break

if status is None:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
if action_index != len(actions):
    sys.stderr.write(f"completed {action_index}/{len(actions)} terminal actions before timeout\n")
    sys.exit(124)
actual_exit = os.waitstatus_to_exitcode(status)
if actual_exit != int(expected_exit):
    sys.stderr.write(f"expected exit {expected_exit}, got {actual_exit}\n")
    sys.exit(125)
`

interface PtyRun {
  output: string
  sessionId: string
}

function replayPluginPath(): string {
  const mode = resolveExampleMode()
  return fileURLToPath(new URL(
    mode === 'lib'
      ? '../../../packages/test-support/llm-replay/lib/index.js'
      : '../../../packages/test-support/llm-replay/src/index.ts',
    import.meta.url,
  ))
}

async function runPty(
  cwd: string,
  home: string,
  patch: string,
  replay: string,
  args: readonly string[],
  actions: readonly (readonly [marker: string, input: string])[],
  options: { expectedExit?: number; env?: Readonly<Record<string, string>> } = {},
): Promise<PtyRun> {
  const configArgs = args.length === 0
    ? ['--patch', patch]
    : [args[0] as string, '--patch', patch, ...args.slice(1)]
  const launch = resolveExampleLaunch({
    srcBin: dshBinScript,
    configArgs,
    tsconfigPath,
    env: {
      DSH_HOME: home,
      DSH_AGENTS_HOME: join(cwd, '.agents'),
      DSH_SNAPSHOT_FILE: replay,
      DSH_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
      TERM: 'xterm-256color',
      ...options.env,
    },
  })
  const timeoutMs = 30_000
  const result = await execa('python3', [
    '-c',
    POSIX_TERMINAL_CLI_DRIVER,
    launch.command,
    JSON.stringify(launch.args),
    JSON.stringify(launch.env),
    cwd,
    JSON.stringify(actions),
    String(timeoutMs / 1_000),
    String(options.expectedExit ?? 0),
  ], {
    stdin: 'ignore',
    timeout: timeoutMs + 5_000,
    killSignal: 'SIGKILL',
    reject: false,
    stripFinalNewline: false,
  })
  if (result.timedOut || result.failed) {
    throw new Error(
      `terminal CLI PTY failed (${String(result.exitCode)}). stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  const match = /^session: (session-[^\r\n]+)$/mu.exec(result.stdout)
  if (match?.[1] === undefined) throw new Error(`terminal CLI printed no Session id:\n${result.stdout}`)
  return { output: result.stdout, sessionId: match[1] }
}

function normalizeTerminal(output: string, cwd: string): string {
  return output
    .replace(/\r\n?/gu, '\n')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replaceAll(cwd, '{{cwd}}')
    .replace(/^cwd: .+$/gmu, 'cwd: {{cwd}}')
    .replace(/^session: session-[^\n]+$/gmu, 'session: {{sessionId}}')
    .replace(/[ \t]+$/gmu, '')
}

describe.skipIf(process.platform === 'win32')('terminal CLI journey (real Loader tree in a PTY)', () => {
  it('runs two fresh turns, exits cleanly, and resumes the same Session', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-terminal-cli-snapshot-'))
    const home = join(cwd, '.dsh')
    const patch = join(cwd, 'terminal-cli.snapshot.cordis.yml')
    try {
      await writeFile(patch, [
        '- id: llm-deepseek',
        '  disabled: true',
        '- id: session-title-llm',
        '  disabled: true',
        '- insert:',
        '    - id: terminal-cli-replay',
        `      name: '${pathToFileURL(replayPluginPath()).href}'`,
        '',
      ].join('\n'))

      const fresh = await runPty(cwd, home, patch, freshReplay, [], [
        ['Type /help for commands.', 'first prompt\n'],
        ['assistant> FIRST_REPLY', ''],
        ['› ', 'second prompt\n'],
        ['assistant> SECOND_REPLY', ''],
        ['› ', '/exit\n'],
      ])
      const resumed = await runPty(cwd, home, patch, resumeReplay, ['resume', '--last'], [
        ['Type /help for commands.', 'resume prompt\n'],
        ['assistant> RESUME_REPLY', ''],
        ['› ', '/exit\n'],
      ])

      expect(resumed.sessionId).toBe(fresh.sessionId)
      const persisted = (await readdir(join(home, 'sessions'), { recursive: true }))
        .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
      expect(persisted).toHaveLength(1)

      const actual = [
        '=== fresh ===',
        normalizeTerminal(fresh.output, cwd).trimEnd(),
        '=== resume ===',
        normalizeTerminal(resumed.output, cwd).trimEnd(),
        '',
      ].join('\n')
      if (refreshing) await writeFile(terminalExpected, actual)
      else expect(actual).toBe(await readFile(terminalExpected, 'utf8'))
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('forces exit 130 when terminal readline receives Ctrl-C twice during one running turn', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-terminal-cli-interrupt-'))
    const home = join(cwd, '.dsh')
    const patch = join(cwd, 'terminal-cli.interrupt.cordis.yml')
    const override = join(cwd, 'hang.override.json')
    try {
      await writeFile(patch, [
        '- id: llm-deepseek',
        '  disabled: true',
        '- id: session-title-llm',
        '  disabled: true',
        '- insert:',
        '    - id: terminal-cli-replay',
        `      name: '${pathToFileURL(replayPluginPath()).href}'`,
        '',
      ].join('\n'))
      await writeFile(override, JSON.stringify([{ kind: 'hang' }]))

      const interrupted = await runPty(cwd, home, patch, freshReplay, [], [
        ['Type /help for commands.', 'hang now\n'],
        ['assistant> partial', '\u0003\u0003'],
      ], {
        expectedExit: 130,
        env: { DSH_SNAPSHOT_OVERRIDE: override },
      })

      expect(normalizeTerminal(interrupted.output, cwd))
        .toContain('dsh: cancelling current turn (press Ctrl-C again to exit)')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
