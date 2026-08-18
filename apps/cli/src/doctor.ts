/** Boot-free installation and environment diagnostics for the CLI. */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { platform as hostPlatform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

type DoctorStatus = 'pass' | 'warn' | 'fail'

interface DoctorCheck {
  readonly id: string
  readonly status: DoctorStatus
  readonly message: string
  readonly detail?: string
}

/** Injectable environment and output dependencies for {@link runDoctor}. */
export interface DoctorCommandOptions {
  /** Current working directory used by the workspace check. */
  readonly cwd?: string
  /** Environment used for configuration and terminal capability checks. */
  readonly env?: NodeJS.ProcessEnv
  /** Harness home override used by tests and embedders. */
  readonly home?: string
  /** Node version reported by the launcher; defaults to the running process. */
  readonly nodeVersion?: string
  /** Host platform reported by the launcher; defaults to the running process. */
  readonly platform?: string
  /** Host architecture reported by the launcher; defaults to the running process. */
  readonly arch?: string
  /** Whether stdin is attached to a terminal. */
  readonly stdinIsTTY?: boolean
  /** Whether stdout is attached to a terminal. */
  readonly stdoutIsTTY?: boolean
  /** Receive human-readable diagnostics. */
  readonly stdout?: (text: string) => void
  /** Receive usage and fatal diagnostics. */
  readonly stderr?: (text: string) => void
  /** Runtime asset root; defaults to the CLI package root. */
  readonly assetRoot?: string
}

interface DoctorReport {
  readonly version: string
  readonly checks: readonly DoctorCheck[]
  readonly ok: boolean
}

const USAGE = `Usage:
  deepseek doctor [--json]

Checks the Node runtime, workspace, harness home, API credentials, MCP catalog,
runtime assets, and terminal capabilities without booting a profile.`

const MIN_NODE = { major: 22, minor: 19, patch: 0 }

function parseVersion(version: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isSupportedNode(version: string): boolean {
  const parsed = parseVersion(version)
  if (parsed === undefined) return false
  const [major, minor, patch] = parsed
  if (major >= 24) return true
  if (major !== MIN_NODE.major) return false
  if (minor !== MIN_NODE.minor) return minor > MIN_NODE.minor
  return patch >= MIN_NODE.patch
}

function check(
  id: string,
  status: DoctorStatus,
  message: string,
  detail?: string,
): DoctorCheck {
  return detail === undefined ? { id, status, message } : { id, status, message, detail }
}

function writableDirectory(path: string): boolean {
  try {
    accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK)
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function readPackageVersion(assetRoot: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(assetRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function checkWorkspace(cwd: string): DoctorCheck {
  try {
    if (!statSync(cwd).isDirectory()) return check('workspace', 'fail', 'workspace is not a directory', cwd)
    return check('workspace', 'pass', 'workspace is accessible', cwd)
  } catch {
    return check('workspace', 'fail', 'workspace is not accessible', cwd)
  }
}

function checkHome(home: string): DoctorCheck {
  if (!existsSync(home)) return check('home', 'warn', 'harness home is not initialized', home)
  return writableDirectory(home)
    ? check('home', 'pass', 'harness home is readable and writable', home)
    : check('home', 'fail', 'harness home is not writable', home)
}

function checkCredentials(home: string, env: NodeJS.ProcessEnv): DoctorCheck {
  if (typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.trim().length > 0) {
    return check('credentials', 'pass', 'DEEPSEEK_API_KEY is configured in the environment')
  }
  const credentials = join(home, '.credentials.yaml')
  if (existsSync(credentials)) return check('credentials', 'pass', 'credential file is present', credentials)
  return check('credentials', 'warn', 'no DeepSeek API key was found', 'set DEEPSEEK_API_KEY or run the credential setup flow')
}

function checkMcp(home: string): DoctorCheck {
  const filename = join(home, 'mcp.json')
  if (!existsSync(filename)) return check('mcp', 'pass', 'MCP catalog is not configured')
  try {
    const decoded = JSON.parse(readFileSync(filename, 'utf8')) as { version?: unknown; servers?: unknown }
    if (decoded.version !== 0 || typeof decoded.servers !== 'object' || decoded.servers === null || Array.isArray(decoded.servers)) {
      return check('mcp', 'fail', 'MCP catalog has an unsupported format', filename)
    }
    return check('mcp', 'pass', 'MCP catalog is valid', filename)
  } catch {
    return check('mcp', 'fail', 'MCP catalog is not valid JSON', filename)
  }
}

function checkAssets(assetRoot: string): DoctorCheck {
  const required = ['package.json', 'config', 'config/agent-presets']
  const missing = required.filter(relative => !existsSync(join(assetRoot, relative)))
  if (missing.length > 0) {
    return check('assets', 'fail', 'runtime assets are incomplete', missing.join(', '))
  }
  return check('assets', 'pass', 'runtime assets are present', assetRoot)
}

function checkTerminal(
  env: NodeJS.ProcessEnv,
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
): DoctorCheck {
  if (!stdinIsTTY || !stdoutIsTTY) return check('terminal', 'warn', 'stdin/stdout is not attached to a TTY', 'interactive TUI sessions need both streams attached')
  const color = env.COLORTERM?.toLowerCase()
  if (color !== 'truecolor' && color !== '24bit') return check('terminal', 'warn', 'terminal truecolor is not advertised', 'set COLORTERM=truecolor or use a terminal with truecolor support')
  return check('terminal', 'pass', 'interactive terminal and truecolor support detected')
}

function buildReport(options: DoctorCommandOptions): DoctorReport {
  const env = options.env ?? process.env
  const assetRoot = options.assetRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const home = options.home ?? resolveDshHome(undefined, env)
  const nodeVersion = options.nodeVersion ?? process.versions.node
  const checks: DoctorCheck[] = []
  checks.push(isSupportedNode(nodeVersion)
    ? check('node', 'pass', `Node.js ${nodeVersion} is supported`)
    : check('node', 'fail', `Node.js ${nodeVersion} is unsupported`, 'use Node.js 22.19+ or 24+'),
  )
  checks.push(check('platform', 'pass', `${options.platform ?? hostPlatform()} ${options.arch ?? process.arch}`, release()))
  checks.push(checkWorkspace(resolve(options.cwd ?? process.cwd())))
  checks.push(checkHome(home))
  checks.push(checkCredentials(home, env))
  checks.push(checkMcp(home))
  checks.push(checkAssets(assetRoot))
  checks.push(checkTerminal(env, options.stdinIsTTY ?? process.stdin.isTTY, options.stdoutIsTTY ?? process.stdout.isTTY))
  return {
    version: readPackageVersion(assetRoot),
    checks,
    ok: checks.every(({ status }) => status !== 'fail'),
  }
}

function renderHuman(report: DoctorReport): string {
  const icon: Record<DoctorStatus, string> = { pass: '✓', warn: '!', fail: '✗' }
  const lines = [`DeepSeek Harness doctor · ${report.version}`]
  for (const item of report.checks) {
    lines.push(`${icon[item.status]} ${item.id}: ${item.message}${item.detail === undefined ? '' : ` (${item.detail})`}`)
  }
  lines.push(report.ok ? 'Doctor finished with no blocking errors.' : 'Doctor found blocking errors.')
  return `${lines.join('\n')}\n`
}

/**
 * Run the boot-free doctor command.
 * @param args - arguments after `doctor`.
 * @param options - injectable environment, paths, and output sinks.
 * @returns zero when no check fails, otherwise one.
 */
export function runDoctor(args: readonly string[], options: DoctorCommandOptions = {}): number {
  const stdout = options.stdout ?? ((text) => { process.stdout.write(text) })
  const stderr = options.stderr ?? ((text) => { process.stderr.write(text) })
  try {
    if (args.includes('--help') || args.includes('-h')) {
      if (args.length !== 1) throw new Error('help takes no other arguments')
      stdout(`${USAGE}\n`)
      return 0
    }
    const json = args.includes('--json')
    if (args.some(arg => arg !== '--json')) throw new Error(`unknown option ${JSON.stringify(args.find(arg => arg !== '--json'))}`)
    const report = buildReport(options)
    stdout(json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report))
    return report.ok ? 0 : 1
  } catch (error) {
    stderr(`dsh doctor: ${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`)
    return 1
  }
}
