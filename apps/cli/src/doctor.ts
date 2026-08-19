/** Boot-free installation and environment diagnostics for the CLI. */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { platform as hostPlatform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { probeMcpConnection } from '@deepseek-ai/dsh-mcp-client'
import { managedMcpTargets } from './mcp.ts'

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
  /** MCP connection probe override used by tests and embedders. */
  readonly probeMcp?: typeof probeMcpConnection
}

interface DoctorReport {
  readonly version: string
  readonly checks: readonly DoctorCheck[]
  readonly ok: boolean
}

const USAGE = `Usage:
  deepseek doctor [--json] [--mcp-timeout-ms N]

Checks the Node runtime, workspace, harness home, API credentials, MCP catalog,
enabled MCP connections, runtime assets, and terminal capabilities without
booting a profile.`

const MIN_NODE = { major: 22, minor: 19, patch: 0 }
const DEFAULT_MCP_PROBE_TIMEOUT_MS = 5_000

interface DoctorArguments {
  readonly json: boolean
  readonly mcpTimeoutMs: number
}

function parseDoctorArguments(args: readonly string[]): DoctorArguments {
  let json = false
  let mcpTimeoutMs = DEFAULT_MCP_PROBE_TIMEOUT_MS
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--json') {
      json = true
      continue
    }
    if (argument === '--mcp-timeout-ms') {
      const raw = args[index + 1]
      if (raw === undefined) throw new Error('--mcp-timeout-ms needs a positive integer')
      const parsed = Number(raw)
      if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('--mcp-timeout-ms needs a positive integer')
      mcpTimeoutMs = parsed
      index += 1
      continue
    }
    throw new Error(`unknown option ${JSON.stringify(argument)}`)
  }
  return { json, mcpTimeoutMs }
}

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

async function checkMcp(
  home: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  probe: typeof probeMcpConnection,
): Promise<DoctorCheck[]> {
  const filename = join(home, 'mcp.json')
  try {
    const targets = managedMcpTargets(filename, env)
    if (targets.length === 0) return [check('mcp', 'pass', 'MCP catalog is not configured')]
    const results: DoctorCheck[] = [check('mcp', 'pass', `MCP catalog is valid (${String(targets.length)} servers)`, filename)]
    for (const target of targets) {
      if (!target.enabled) {
        results.push(check(`mcp:${target.name}`, 'pass', 'MCP server is disabled', target.transport))
        continue
      }
      try {
        const result = await probe(target.config, timeoutMs)
        results.push(check(
          `mcp:${target.name}`,
          'pass',
          `MCP server connected (${String(result.toolCount)} tools)`,
          target.transport,
        ))
      } catch (error) {
        const secretValues = Object.values(target.config.transport === 'stdio' ? target.config.env : target.config.headers)
          .filter(value => value.length > 0)
          .toSorted((left, right) => right.length - left.length)
        let detail = error instanceof Error ? error.message : String(error)
        for (const secret of secretValues) detail = detail.replaceAll(secret, '<redacted>')
        results.push(check(
          `mcp:${target.name}`,
          target.failOnStartupError ? 'fail' : 'warn',
          'MCP server connection failed',
          detail,
        ))
      }
    }
    return results
  } catch (error) {
    return [check('mcp', 'fail', 'MCP catalog is invalid', error instanceof Error ? error.message : String(error))]
  }
}

function resolveInstalledAsset(assetRoot: string, specifier: string): string | undefined {
  try {
    return createRequire(join(assetRoot, 'package.json')).resolve(specifier)
  } catch {
    // The assets check reports unresolved shipped files with their public package specifiers.
    return undefined
  }
}

function checkAssets(assetRoot: string): DoctorCheck {
  const required = ['package.json', 'config', 'config/agent-presets']
  const missing = required.filter(relative => !existsSync(join(assetRoot, relative)))
  if (missing.length > 0) {
    return check('assets', 'fail', 'runtime assets are incomplete', missing.join(', '))
  }
  // Executable releases run from a pkg snapshot. JavaScript can be present
  // while profile assembly still fails if non-code overlay files were not
  // embedded; resolve assets through the same package exports as profile boot.
  const bundles = ['dsh-base', 'dsh-tui-app', 'dsh-headless', 'dsh-web-app']
  const missingOverlays = bundles
    .map(name => `@deepseek-ai/${name}/cordis.patch.yml`)
    .filter(specifier => resolveInstalledAsset(assetRoot, specifier) === undefined)
  if (missingOverlays.length > 0) {
    return check('assets', 'fail', 'runtime profile assets are incomplete', missingOverlays.join(', '))
  }
  const frontendSpecifier = '@deepseek-ai/dsh-web-frontend/dist/index.html'
  const frontend = resolveInstalledAsset(assetRoot, frontendSpecifier)
  if (frontend === undefined) {
    // The terminal and headless profiles do not need the browser dist, so a
    // source install remains usable; web users still receive an actionable
    // warning instead of a false healthy result.
    return check('assets', 'warn', 'runtime profile overlays are present; web frontend dist is missing', frontendSpecifier)
  }
  return check('assets', 'pass', 'runtime overlays, presets, and web assets are present', assetRoot)
}

function commandAvailable(command: string, env: NodeJS.ProcessEnv, platform: string): boolean {
  const [probe, args] = platform === 'win32'
    ? ['where.exe', [command]] as const
    : [command, ['--version']] as const
  const result = spawnSync(probe, args, { env, stdio: 'ignore', windowsHide: true })
  return result.error === undefined && result.status === 0
}

function checkSandbox(env: NodeJS.ProcessEnv, platform: string): DoctorCheck {
  // A launcher can report the selected runner explicitly.  This is useful for
  // packaged binaries where the profile is not booted by doctor.  Otherwise
  // probe the host runner without claiming that one arbitrary command was
  // actually confined.
  if (env.DSH_SANDBOX_ENFORCEMENT === 'active') {
    return check('sandbox', 'pass', 'sandbox enforcement is reported active by the launcher')
  }
  const runner = platform === 'darwin'
    ? 'sandbox-exec'
    : platform === 'win32'
      ? 'icacls'
      : 'bwrap'
  if (commandAvailable(runner, env, platform)) {
    return check('sandbox', 'warn', `sandbox runner ${runner} is available`, 'doctor cannot prove per-call confinement without booting a profile')
  }
  return check('sandbox', 'warn', 'no host sandbox runner was detected', 'the selected profile may use a deny-only or unconfined executor')
}

function checkInstallation(assetRoot: string, env: NodeJS.ProcessEnv): DoctorCheck {
  const explicit = env.DSH_INSTALL_CHANNEL?.trim()
  if (explicit !== undefined && explicit.length > 0) {
    return check('installation', 'pass', `installation channel: ${explicit}`, assetRoot)
  }
  const packageManager = env.npm_config_user_agent
  if (packageManager?.startsWith('npm/')) return check('installation', 'pass', 'installation channel appears to be npm', assetRoot)
  if (assetRoot.includes(join('node_modules', '@peiyu_wang'))) return check('installation', 'pass', 'installation channel appears to be npm', assetRoot)
  if (assetRoot.includes('.deepseek-harness-cli')) return check('installation', 'pass', 'installation channel appears to be the standalone installer', assetRoot)
  return check('installation', 'warn', 'installation channel could not be identified', 'set DSH_INSTALL_CHANNEL for packaged deployments')
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

function checkTerminalInput(env: NodeJS.ProcessEnv, stdoutIsTTY: boolean): DoctorCheck {
  if (!stdoutIsTTY) return check('mouse', 'warn', 'mouse reporting is unavailable without an interactive terminal')
  const terminal = env.TERM_PROGRAM ?? env.TERM ?? ''
  if (terminal === '' || terminal === 'dumb') return check('mouse', 'warn', 'terminal mouse reporting is not identifiable', 'keyboard scrolling remains available')
  return check('mouse', 'pass', 'interactive terminal input is available', terminal)
}

function checkClipboard(env: NodeJS.ProcessEnv, platform: string): DoctorCheck {
  const command = platform === 'darwin'
    ? 'pbcopy'
    : platform === 'win32'
      ? 'clip'
      : env.WAYLAND_DISPLAY !== undefined
        ? 'wl-copy'
        : 'xclip'
  return commandAvailable(command, env, platform)
    ? check('clipboard', 'pass', `clipboard command ${command} is available`)
    : check('clipboard', 'warn', `clipboard command ${command} was not found`, 'copy and paste shortcuts may be unavailable')
}

async function buildReport(options: DoctorCommandOptions, mcpTimeoutMs: number): Promise<DoctorReport> {
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
  checks.push(...await checkMcp(home, env, mcpTimeoutMs, options.probeMcp ?? probeMcpConnection))
  checks.push(checkAssets(assetRoot))
  checks.push(checkInstallation(assetRoot, env))
  const platform = options.platform ?? hostPlatform()
  checks.push(checkSandbox(env, platform))
  checks.push(checkTerminal(env, options.stdinIsTTY ?? process.stdin.isTTY, options.stdoutIsTTY ?? process.stdout.isTTY))
  checks.push(checkTerminalInput(env, options.stdoutIsTTY ?? process.stdout.isTTY))
  checks.push(checkClipboard(env, platform))
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
export async function runDoctor(args: readonly string[], options: DoctorCommandOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((text) => { process.stdout.write(text) })
  const stderr = options.stderr ?? ((text) => { process.stderr.write(text) })
  try {
    if (args.includes('--help') || args.includes('-h')) {
      if (args.length !== 1) throw new Error('help takes no other arguments')
      stdout(`${USAGE}\n`)
      return 0
    }
    const parsed = parseDoctorArguments(args)
    const report = await buildReport(options, parsed.mcpTimeoutMs)
    stdout(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report))
    return report.ok ? 0 : 1
  } catch (error) {
    stderr(`dsh doctor: ${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`)
    return 1
  }
}
