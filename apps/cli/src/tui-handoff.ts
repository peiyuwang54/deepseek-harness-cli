/**
 * Process handoff for a terminal profile. POSIX replaces the current process
 * after the old tree reaches quiescence; platforms without `process.execve`
 * keep the parent as a foreground supervisor until the replacement exits.
 * @module @deepseek-ai/dsh/tui-handoff
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { constants as osConstants } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ProcessShutdown } from './process-shutdown.ts'

/** One process transition exposed to the TUI renderer. */
export interface TuiProcessHandoff {
  /** Resume a persisted session in its immutable recorded workspace. */
  handoff(sessionId: SessionId, cwd: string): Promise<never>
  /** Start a fresh session in a selected workspace. */
  start(cwd: string): Promise<never>
}

/** Immutable launch facts needed to reconstruct the current profile. */
export interface TuiProcessHandoffOptions {
  /** Profile name; normally `tui`, retained for composed custom profiles. */
  profile: string
  /** Patch overlays from the original invocation. Relative paths resolve before any cwd change. */
  patchFiles: readonly string[]
  /** App-owned arguments from the original invocation. */
  args: readonly string[]
  /** Environment inherited by the original CLI, before project/user `.env` materialization. */
  environment: NodeJS.ProcessEnv
  /** Whole-tree bounded shutdown controller. */
  shutdown: ProcessShutdown
  /** Stop the old launcher's signal path from racing committed terminal teardown. */
  beginReplacement?(): void
  /** Turn the disposed launcher into an inert supervisor on platforms without process replacement. */
  prepareSupervisor?(): void
}

/** Replaceable process boundaries for unit tests. */
export interface TuiProcessHandoffInternals {
  execPath: string
  execArgv: readonly string[]
  scriptPath: string | undefined
  cwd: () => string
  chdir: (path: string) => void
  stat: (path: string) => Promise<{ isDirectory(): boolean }>
  /** Resolve a bare Node preload from the original invoking directory. */
  resolveExecModule: (specifier: string, cwd: string) => string
  /** POSIX process replacement; absent on Windows and IBM i. */
  execve: ((file: string, args: readonly string[], env: NodeJS.ProcessEnv) => never) | undefined
  spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  stderr: { write(chunk: string): unknown }
}

/** Production process boundaries. */
const tuiProcessHandoffInternals: TuiProcessHandoffInternals = {
  execPath: process.execPath,
  execArgv: process.execArgv,
  scriptPath: process.argv[1],
  cwd: () => process.cwd(),
  chdir: (path) => { process.chdir(path) },
  stat,
  resolveExecModule: (specifier, cwd) => createRequire(join(cwd, 'package.json')).resolve(specifier),
  execve: process.execve?.bind(process),
  spawn: (command, args, options) => spawn(command, [...args], options),
  stderr: process.stderr,
}

/** Remove the one app flag owned by the TUI identity provider. */
export function withoutResumeArgument(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string
    if (argument === '--resume') {
      // Commander owns the following value. If it is absent, retain no
      // malformed fragment: the replacement supplies a complete target.
      index += 1
      continue
    }
    if (argument.startsWith('--resume=')) continue
    kept.push(argument)
  }
  return kept
}

/**
 * Rebuild launcher arguments for one replacement while retaining the profile,
 * overlays, and future app flags unrelated to session identity.
 * @param options - Original profile, overlay, and app arguments.
 * @param target - Optional persisted session identity.
 * @param invokingCwd - Directory relative overlays were originally resolved from.
 * @returns Arguments following the dsh entry script.
 */
export function replacementArguments(
  options: Pick<TuiProcessHandoffOptions, 'profile' | 'patchFiles' | 'args'>,
  target: { sessionId?: SessionId },
  invokingCwd: string,
): string[] {
  const patches = options.patchFiles.flatMap(path => ['--patch', resolve(invokingCwd, path)])
  const appArgs = withoutResumeArgument(options.args)
  return [
    '--profile', options.profile,
    ...patches,
    ...appArgs,
    ...target.sessionId === undefined ? [] : ['--resume', target.sessionId],
  ]
}

/** Node flags whose following value is resolved before application startup. */
const PRELOAD_FLAGS = new Map<string, 'esm' | 'require'>([
  ['--import', 'esm'],
  ['--loader', 'esm'],
  ['--experimental-loader', 'esm'],
  ['-r', 'require'],
  ['--require', 'require'],
])

/** Make one preload specifier independent of the replacement workspace. */
function relocatePreload(
  specifier: string,
  kind: 'esm' | 'require',
  invokingCwd: string,
  resolveModule: TuiProcessHandoffInternals['resolveExecModule'],
): string {
  if (/^(?:node|file|data):/u.test(specifier) || isAbsolute(specifier)) return specifier
  const path = specifier.startsWith('.')
    ? resolve(invokingCwd, specifier)
    : resolveModule(specifier, invokingCwd)
  return kind === 'require' ? path : pathToFileURL(path).href
}

/**
 * Make Node's ESM and CommonJS preload flags relocatable before the child changes cwd.
 * Other runtime flags retain their original spelling and order.
 * @param args - Current `process.execArgv`.
 * @param invokingCwd - Directory from which Node resolved the original preloads.
 * @param resolveModule - Bare-specifier resolver anchored at that directory.
 * @returns Runtime arguments safe to reuse from another workspace.
 */
export function relocatableExecArguments(
  args: readonly string[],
  invokingCwd: string,
  resolveModule: TuiProcessHandoffInternals['resolveExecModule'],
): string[] {
  const relocated: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string
    const kind = PRELOAD_FLAGS.get(argument)
    if (kind !== undefined) {
      const specifier = args[index + 1]
      if (specifier === undefined) {
        relocated.push(argument)
        continue
      }
      relocated.push(argument, relocatePreload(specifier, kind, invokingCwd, resolveModule))
      index += 1
      continue
    }
    const equals = /^(--(?:import|loader|experimental-loader|require))=(.*)$/u.exec(argument)
    if (equals !== null) {
      const flag = equals[1] as string
      const specifier = equals[2] as string
      relocated.push(`${flag}=${relocatePreload(
        specifier,
        flag === '--require' ? 'require' : 'esm',
        invokingCwd,
        resolveModule,
      )}`)
      continue
    }
    relocated.push(argument)
  }
  return relocated
}

/** Parse Node's double-quote-aware, whitespace-separated NODE_OPTIONS grammar. */
function parseNodeOptions(value: string): string[] {
  const args: string[] = []
  let current = ''
  let started = false
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string
    if (quoted && character === '\\' && index + 1 < value.length) {
      current += value[index + 1] as string
      started = true
      index += 1
      continue
    }
    if (character === '"') {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && /\s/u.test(character)) {
      if (started) args.push(current)
      current = ''
      started = false
      continue
    }
    current += character
    started = true
  }
  if (quoted) throw new Error('TUI handoff cannot parse NODE_OPTIONS: unmatched double quote')
  if (started) args.push(current)
  return args
}

/** Quote one NODE_OPTIONS token without changing Node's parsed value. */
function quoteNodeOption(value: string): string {
  if (value !== '' && !/[\s"]/u.test(value)) return value
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Anchor NODE_OPTIONS preloads to the invoking workspace before a handoff.
 * @param value - Original environment option string.
 * @param invokingCwd - Directory from which the original Node resolved modules.
 * @param resolveModule - Bare-specifier resolver anchored at that directory.
 * @returns An equivalent option string whose preload targets are relocatable.
 */
export function relocatableNodeOptions(
  value: string,
  invokingCwd: string,
  resolveModule: TuiProcessHandoffInternals['resolveExecModule'],
): string {
  return relocatableExecArguments(parseNodeOptions(value), invokingCwd, resolveModule)
    .map(quoteNodeOption)
    .join(' ')
}

/** Validate the destination before terminal ownership and the app tree are released. */
async function validateWorkspace(
  cwd: string,
  internals: TuiProcessHandoffInternals,
): Promise<void> {
  const info = await internals.stat(cwd)
  if (!info.isDirectory()) throw new Error(`TUI handoff target is not a directory: ${cwd}`)
}

/** Exit status reported by the supervising parent after its replacement stops. */
function childExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code
  if (signal === null) return 1
  const signalNumber = (osConstants.signals as Partial<Record<string, number>>)[signal]
  return signalNumber === undefined ? 1 : 128 + signalNumber
}

/** Omit undefined values before crossing the spawn/exec environment boundary. */
function concreteEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

/**
 * Build the host callback installed by the product CLI. Every recoverable
 * validation step finishes before shutdown. After shutdown begins, any failure
 * exits non-zero because no renderer remains to recover into.
 * @param options - Immutable profile facts and process lifecycle owner.
 * @param internals - Replaceable OS boundaries.
 * @returns A single-flight process handoff host.
 */
export function createTuiProcessHandoff(
  options: TuiProcessHandoffOptions,
  internals: TuiProcessHandoffInternals = tuiProcessHandoffInternals,
): TuiProcessHandoff {
  const invokingCwd = internals.cwd()
  const scriptPath = internals.scriptPath === undefined || internals.scriptPath === ''
    ? undefined
    : resolve(invokingCwd, internals.scriptPath)
  let phase: 'idle' | 'validating' | 'committed' = 'idle'

  const failCommitted = (error: unknown): void => {
    internals.stderr.write(`dsh tui: replacement failed to start: ${String(error)}\n`)
    // shutdown() already owns the disposal promise, so interrupt() is the
    // controller's immediate fatal-exit path if a fake process boundary returns.
    options.shutdown.interrupt(1)
  }

  const launch = async (cwd: string, sessionId?: SessionId): Promise<never> => {
    if (phase !== 'idle') throw new Error('TUI handoff is already in progress')
    phase = 'validating'

    let nodeArguments: string[]
    let environment: Record<string, string>
    try {
      if (scriptPath === undefined) {
        throw new Error('TUI handoff requires a filesystem-backed dsh entry script')
      }
      await validateWorkspace(cwd, internals)
      const appArguments = replacementArguments(
        options,
        { ...sessionId === undefined ? {} : { sessionId } },
        invokingCwd,
      )
      nodeArguments = [
        ...relocatableExecArguments(internals.execArgv, invokingCwd, internals.resolveExecModule),
        scriptPath,
        ...appArguments,
      ]
      environment = concreteEnvironment(options.environment)
      if (environment['NODE_OPTIONS'] !== undefined) {
        environment['NODE_OPTIONS'] = relocatableNodeOptions(
          environment['NODE_OPTIONS'],
          invokingCwd,
          internals.resolveExecModule,
        )
      }
    } catch (error: unknown) {
      phase = 'idle'
      throw error
    }

    phase = 'committed'
    try {
      options.beginReplacement?.()
      // Code 1 owns a failed or timed-out disposal. A successful replacement
      // supersedes it through execve or shutdown.interrupt(childCode).
      await options.shutdown.shutdown(1)
    } catch (error: unknown) {
      failCommitted(error)
      throw error
    }

    if (internals.execve !== undefined) {
      try {
        internals.chdir(cwd)
        internals.execve(
          internals.execPath,
          [internals.execPath, ...nodeArguments],
          environment,
        )
        /* v8 ignore next -- process.execve never returns on success. */
        throw new Error('process.execve returned without replacing the process')
      } catch (error: unknown) {
        failCommitted(error)
        throw error
      }
    }

    try {
      options.prepareSupervisor?.()
    } catch (error: unknown) {
      failCommitted(error)
      throw error
    }

    let child: ChildProcess
    try {
      child = internals.spawn(internals.execPath, nodeArguments, {
        cwd,
        env: environment,
        stdio: 'inherit',
        shell: false,
      })
    } catch (error: unknown) {
      failCommitted(error)
      throw error
    }

    return await new Promise<never>((_resolve, reject) => {
      let settled = false
      child.once('error', (error) => {
        if (settled) return
        settled = true
        failCommitted(error)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        if (settled) return
        settled = true
        options.shutdown.interrupt(childExitCode(code, signal))
        // A production interrupt exits synchronously. A fake returning here
        // deliberately leaves this Promise pending, matching Promise<never>.
      })
    })
  }

  return {
    handoff: (sessionId, cwd) => launch(cwd, sessionId),
    start: cwd => launch(cwd),
  }
}
