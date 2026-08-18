/** User-level MCP server management and profile patch projection. */

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const CONFIG_VERSION = 0
const MCP_CONFIG_FILENAME = 'mcp.json'
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u
const USAGE = `Usage:
  deepseek mcp [list]
  deepseek mcp get <name>
  deepseek mcp add <name> [--env KEY[=SOURCE]] [--cwd PATH] [--timeout-ms N] [--fail-on-startup-error] -- <command> [args...]
  deepseek mcp add <name> --url <http(s)://...> [--header NAME=SOURCE] [--timeout-ms N] [--fail-on-startup-error]
  deepseek mcp remove <name>

Environment and header options store variable references, never secret values.`

interface StoredBaseServer {
  readonly timeoutMs?: number
  readonly failOnStartupError?: boolean
}

interface StoredStdioServer extends StoredBaseServer {
  readonly transport: 'stdio'
  readonly command: string
  readonly args: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
}

interface StoredHttpServer extends StoredBaseServer {
  readonly transport: 'streamable-http'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

type StoredMcpServer = StoredStdioServer | StoredHttpServer

interface McpConfigFile {
  readonly version: 0
  readonly servers: Readonly<Record<string, StoredMcpServer>>
}

/** Injectable output and filesystem options for {@link runMcp}. */
export interface McpCommandOptions {
  /** Managed catalog path; defaults to `$DSH_HOME/mcp.json`. */
  readonly configPath?: string
  /** Base directory used to resolve a relative `--cwd`. */
  readonly cwd?: string
  /** Receive ordinary command output. */
  readonly stdout?: (text: string) => void
  /** Receive usage and validation diagnostics. */
  readonly stderr?: (text: string) => void
}

interface ParsedAdd {
  readonly name: string
  readonly server: StoredMcpServer
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} has unknown field ${JSON.stringify(key)}`)
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function optionalTimeout(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`)
  return value as number
}

function referenceMap(
  value: unknown,
  label: string,
  targetPattern: RegExp,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${label} must be an object of string references`)
  const entries = Object.entries(value).map(([key, source]) => {
    if (!targetPattern.test(key)) throw new Error(`${label} has invalid target name ${JSON.stringify(key)}`)
    if (typeof source !== 'string' || !ENV_NAME_PATTERN.test(source)) {
      throw new Error(`${label}.${key} must name a source environment variable`)
    }
    return [key, source] as const
  })
  return Object.fromEntries(entries)
}

function parseServer(name: string, value: unknown): StoredMcpServer {
  if (!SERVER_NAME_PATTERN.test(name)) throw new Error(`MCP server name ${JSON.stringify(name)} must match [A-Za-z0-9_-]{1,32}`)
  if (!isRecord(value)) throw new Error(`MCP server ${JSON.stringify(name)} must be an object`)
  const transport = value.transport
  if (transport === 'stdio') {
    assertKeys(value, new Set(['transport', 'command', 'args', 'env', 'cwd', 'timeoutMs', 'failOnStartupError']), `MCP server ${JSON.stringify(name)}`)
    if (!Array.isArray(value.args) || value.args.some(argument => typeof argument !== 'string')) {
      throw new Error(`MCP server ${JSON.stringify(name)}.args must be an array of strings`)
    }
    const env = referenceMap(value.env, `MCP server ${JSON.stringify(name)}.env`, ENV_NAME_PATTERN)
    const cwd = value.cwd === undefined ? undefined : requiredString(value.cwd, `MCP server ${JSON.stringify(name)}.cwd`)
    const timeoutMs = optionalTimeout(value.timeoutMs, `MCP server ${JSON.stringify(name)}.timeoutMs`)
    const failOnStartupError = optionalBoolean(value.failOnStartupError, `MCP server ${JSON.stringify(name)}.failOnStartupError`)
    return {
      transport,
      command: requiredString(value.command, `MCP server ${JSON.stringify(name)}.command`),
      args: value.args as string[],
      ...(env === undefined ? {} : { env }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(failOnStartupError === undefined ? {} : { failOnStartupError }),
    }
  }
  if (transport === 'streamable-http') {
    assertKeys(value, new Set(['transport', 'url', 'headers', 'timeoutMs', 'failOnStartupError']), `MCP server ${JSON.stringify(name)}`)
    const url = requiredString(value.url, `MCP server ${JSON.stringify(name)}.url`)
    validateHttpUrl(url)
    const headers = referenceMap(value.headers, `MCP server ${JSON.stringify(name)}.headers`, HEADER_NAME_PATTERN)
    const timeoutMs = optionalTimeout(value.timeoutMs, `MCP server ${JSON.stringify(name)}.timeoutMs`)
    const failOnStartupError = optionalBoolean(value.failOnStartupError, `MCP server ${JSON.stringify(name)}.failOnStartupError`)
    return {
      transport,
      url,
      ...(headers === undefined ? {} : { headers }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(failOnStartupError === undefined ? {} : { failOnStartupError }),
    }
  }
  throw new Error(`MCP server ${JSON.stringify(name)}.transport must be "stdio" or "streamable-http"`)
}

function parseConfig(text: string, filename: string): McpConfigFile {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch (error) {
    throw new Error(`failed to parse ${filename} as JSON`, { cause: error })
  }
  if (!isRecord(decoded)) throw new Error(`${filename} must contain an object`)
  assertKeys(decoded, new Set(['version', 'servers']), filename)
  if (decoded.version !== CONFIG_VERSION) throw new Error(`${filename} has unsupported version ${JSON.stringify(decoded.version)}; expected ${String(CONFIG_VERSION)}`)
  if (!isRecord(decoded.servers)) throw new Error(`${filename}.servers must be an object`)
  const servers = Object.fromEntries(Object.entries(decoded.servers).map(([name, value]) => [name, parseServer(name, value)]))
  return { version: CONFIG_VERSION, servers }
}

function emptyConfig(): McpConfigFile {
  return { version: CONFIG_VERSION, servers: {} }
}

function readConfig(filename: string): McpConfigFile {
  try {
    return parseConfig(readFileSync(filename, 'utf8'), filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig()
    throw error
  }
}

function renderConfig(config: McpConfigFile): string {
  const servers = Object.fromEntries(Object.entries(config.servers).toSorted(([left], [right]) => left.localeCompare(right)))
  return `${JSON.stringify({ version: CONFIG_VERSION, servers }, null, 2)}\n`
}

function validateServerName(name: string): void {
  if (!SERVER_NAME_PATTERN.test(name)) throw new Error(`server name ${JSON.stringify(name)} must match [A-Za-z0-9_-]{1,32}`)
}

function validateHttpUrl(raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    throw new Error(`MCP URL ${JSON.stringify(raw)} is invalid`, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('MCP URL must use http or https')
  if (url.username !== '' || url.password !== '') throw new Error('MCP URL must not embed credentials; use --header with an environment reference')
}

function parseReference(raw: string, kind: 'env' | 'header'): readonly [string, string] {
  const separator = raw.indexOf('=')
  const target = separator === -1 ? raw : raw.slice(0, separator)
  const source = separator === -1 ? raw : raw.slice(separator + 1)
  const targetPattern = kind === 'env' ? ENV_NAME_PATTERN : HEADER_NAME_PATTERN
  if (!targetPattern.test(target)) throw new Error(`invalid ${kind} target name ${JSON.stringify(target)}`)
  if (!ENV_NAME_PATTERN.test(source)) throw new Error(`${kind} reference must name an environment variable, got ${JSON.stringify(source)}`)
  return [target, source]
}

function parsePositiveInteger(raw: string, flag: string): number {
  if (!/^[1-9][0-9]*$/u.test(raw)) throw new Error(`${flag} must be a positive integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw new Error(`${flag} exceeds the safe integer range`)
  return value
}

function valueAfter(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (value === undefined || value === '--') throw new Error(`${flag} needs a value`)
  return value
}

function parseAdd(args: readonly string[], cwd: string): ParsedAdd {
  const name = args[1]
  if (name === undefined) throw new Error('add needs a server name')
  validateServerName(name)
  const env = new Map<string, string>()
  const headers = new Map<string, string>()
  let url: string | undefined
  let serverCwd: string | undefined
  let timeoutMs: number | undefined
  let failOnStartupError = false
  let command: readonly string[] = []
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      command = args.slice(index + 1)
      break
    }
    if (argument === '--url') {
      url = valueAfter(args, index, '--url')
      index += 1
    } else if (argument === '--env') {
      const [target, source] = parseReference(valueAfter(args, index, '--env'), 'env')
      env.set(target, source)
      index += 1
    } else if (argument === '--header') {
      const [target, source] = parseReference(valueAfter(args, index, '--header'), 'header')
      headers.set(target, source)
      index += 1
    } else if (argument === '--cwd') {
      serverCwd = resolve(cwd, valueAfter(args, index, '--cwd'))
      index += 1
    } else if (argument === '--timeout-ms') {
      timeoutMs = parsePositiveInteger(valueAfter(args, index, '--timeout-ms'), '--timeout-ms')
      index += 1
    } else if (argument === '--fail-on-startup-error') {
      failOnStartupError = true
    } else {
      throw new Error(`unknown add option ${JSON.stringify(argument)}; put the server command after --`)
    }
  }
  if (url !== undefined) {
    validateHttpUrl(url)
    if (command.length > 0) throw new Error('--url and a stdio command are mutually exclusive')
    if (env.size > 0 || serverCwd !== undefined) throw new Error('--env and --cwd apply only to stdio servers')
    return {
      name,
      server: {
        transport: 'streamable-http',
        url,
        ...(headers.size === 0 ? {} : { headers: Object.fromEntries(headers) }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(failOnStartupError ? { failOnStartupError: true } : {}),
      },
    }
  }
  if (command.length === 0) throw new Error('stdio add needs a command after --, or use --url for HTTP')
  if (command[0] === '') throw new Error('stdio command must be non-empty')
  if (headers.size > 0) throw new Error('--header applies only to HTTP servers')
  return {
    name,
    server: {
      transport: 'stdio',
      command: command[0] as string,
      args: command.slice(1),
      ...(env.size === 0 ? {} : { env: Object.fromEntries(env) }),
      ...(serverCwd === undefined ? {} : { cwd: serverCwd }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(failOnStartupError ? { failOnStartupError: true } : {}),
    },
  }
}

function formatServer(name: string, server: StoredMcpServer, detailed: boolean): string[] {
  const endpoint = server.transport === 'stdio'
    ? [server.command, ...server.args].map(argument => JSON.stringify(argument)).join(' ')
    : server.url
  const rows = [`- ${name} · ${server.transport} · ${endpoint}`]
  if (!detailed) return rows
  if (server.transport === 'stdio') {
    if (server.cwd !== undefined) rows.push(`  cwd: ${server.cwd}`)
    for (const [target, source] of Object.entries(server.env ?? {})) rows.push(`  env: ${target} <- $${source}`)
  } else {
    for (const [target, source] of Object.entries(server.headers ?? {})) rows.push(`  header: ${target} <- $${source}`)
  }
  rows.push(`  timeout: ${String(server.timeoutMs ?? 60_000)}ms`)
  rows.push(`  fail on startup error: ${String(server.failOnStartupError ?? false)}`)
  return rows
}

async function mutateConfig(filename: string, update: (config: McpConfigFile) => McpConfigFile): Promise<void> {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  await withFileLock(filename, async () => {
    await writeFileAtomic(filename, renderConfig(update(readConfig(filename))), { mode: 0o600, dirMode: 0o700 })
  })
}

function resolveReferences(
  references: Readonly<Record<string, string>> | undefined,
  environment: NodeJS.ProcessEnv,
  serverName: string,
  kind: string,
  redact: boolean,
): Record<string, string> {
  return Object.fromEntries(Object.entries(references ?? {}).map(([target, source]) => {
    if (redact) return [target, `<environment:${source}>`]
    const value = environment[source]
    if (value === undefined) throw new Error(`MCP server ${JSON.stringify(serverName)} ${kind} ${JSON.stringify(target)} references unset environment variable ${source}`)
    return [target, value]
  }))
}

/** Resolve the user-level MCP catalog path. */
export function mcpConfigPath(): string {
  return resolve(resolveDshHome(), MCP_CONFIG_FILENAME)
}

/**
 * Convert the managed MCP catalog into ordinary Cordis insert patches.
 * @param filename - catalog path.
 * @param environment - environment used to resolve stored secret references.
 * @returns One insert patch, or an empty list when no servers are configured.
 */
export function managedMcpPatches(
  filename = mcpConfigPath(),
  environment: NodeJS.ProcessEnv = process.env,
): PatchOptions[] {
  return projectManagedMcpPatches(filename, environment, false)
}

/**
 * Project the managed catalog for a config dump without resolving or printing secret values.
 * @param filename - catalog path.
 * @returns Cordis insertions whose reference values name their environment source.
 */
export function managedMcpDumpPatches(filename = mcpConfigPath()): PatchOptions[] {
  return projectManagedMcpPatches(filename, {}, true)
}

function projectManagedMcpPatches(
  filename: string,
  environment: NodeJS.ProcessEnv,
  redact: boolean,
): PatchOptions[] {
  const config = readConfig(filename)
  const rows = Object.entries(config.servers)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, server]) => ({
      id: `managed-mcp-${name}`,
      name: '@deepseek-ai/dsh-mcp-client',
      config: server.transport === 'stdio'
        ? {
          transport: server.transport,
          serverName: name,
          command: server.command,
          args: [...server.args],
          env: resolveReferences(server.env, environment, name, 'environment entry', redact),
          cwd: server.cwd ?? '',
          ...(server.timeoutMs === undefined ? {} : { toolCallTimeoutMs: server.timeoutMs }),
          ...(server.failOnStartupError === undefined ? {} : { failOnStartupError: server.failOnStartupError }),
        }
        : {
          transport: server.transport,
          serverName: name,
          url: server.url,
          headers: resolveReferences(server.headers, environment, name, 'header', redact),
          ...(server.timeoutMs === undefined ? {} : { toolCallTimeoutMs: server.timeoutMs }),
          ...(server.failOnStartupError === undefined ? {} : { failOnStartupError: server.failOnStartupError }),
        },
    }))
  return rows.length === 0 ? [] : [{ insert: rows }]
}

/**
 * Run one boot-free `deepseek mcp` management command.
 * @param args - arguments after `mcp`.
 * @param options - optional path, working directory, and output sinks.
 * @returns zero on success and one for usage or validation errors.
 */
export async function runMcp(args: readonly string[], options: McpCommandOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((text) => { process.stdout.write(text) })
  const stderr = options.stderr ?? ((text) => { process.stderr.write(text) })
  const filename = options.configPath ?? mcpConfigPath()
  const command = args[0] ?? 'list'
  try {
    if (command === 'list' || command === 'ls') {
      if (args.length > 1) throw new Error('list takes no arguments')
      const entries = Object.entries(readConfig(filename).servers).toSorted(([left], [right]) => left.localeCompare(right))
      if (entries.length === 0) {
        stdout('No MCP servers configured.\n')
      } else {
        stdout([`MCP servers (${String(entries.length)})`, ...entries.flatMap(([name, server]) => formatServer(name, server, false))].join('\n') + '\n')
      }
      return 0
    }
    if (command === 'get') {
      const name = args[1]
      if (name === undefined || args.length !== 2) throw new Error('get needs exactly one server name')
      const server = readConfig(filename).servers[name]
      if (server === undefined) throw new Error(`MCP server ${JSON.stringify(name)} is not configured`)
      stdout(`${formatServer(name, server, true).join('\n')}\n`)
      return 0
    }
    if (command === 'add') {
      const parsed = parseAdd(args, options.cwd ?? process.cwd())
      await mutateConfig(filename, (config) => {
        if (config.servers[parsed.name] !== undefined) throw new Error(`MCP server ${JSON.stringify(parsed.name)} already exists; remove it before replacing it`)
        return { version: CONFIG_VERSION, servers: { ...config.servers, [parsed.name]: parsed.server } }
      })
      stdout(`Added MCP server ${JSON.stringify(parsed.name)}. Restart DeepSeek CLI to load it.\n`)
      return 0
    }
    if (command === 'remove' || command === 'rm') {
      const name = args[1]
      if (name === undefined || args.length !== 2) throw new Error('remove needs exactly one server name')
      await mutateConfig(filename, (config) => {
        if (config.servers[name] === undefined) throw new Error(`MCP server ${JSON.stringify(name)} is not configured`)
        return {
          version: CONFIG_VERSION,
          servers: Object.fromEntries(Object.entries(config.servers).filter(([candidate]) => candidate !== name)),
        }
      })
      stdout(`Removed MCP server ${JSON.stringify(name)}. Restart DeepSeek CLI to apply the change.\n`)
      return 0
    }
    if (command === 'help' || command === '--help' || command === '-h') {
      stdout(`${USAGE}\n`)
      return 0
    }
    throw new Error(`unknown command ${JSON.stringify(command)}`)
  } catch (error) {
    stderr(`dsh mcp: ${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`)
    return 1
  }
}
