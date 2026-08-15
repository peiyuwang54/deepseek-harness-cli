/**
 * Read-only Git worktree diff used by the terminal `/diff` command. External
 * diff helpers, text conversion, hooks, filesystem monitors, and executable
 * clean/process filters are disabled before repository content is inspected.
 * @module @deepseek-ai/dsh-tui/chat/git-diff
 */

import { spawn } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/** Complete result of inspecting one directory for `/diff`. */
export interface GitDiffResult {
  /** Whether the directory belongs to a Git worktree. */
  readonly isWorktree: boolean
  /** Tracked and untracked unified diff text; empty when no changes exist. */
  readonly text: string
}

interface GitCommandOutput {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

const FILTER_COMMAND_PATTERN = String.raw`^filter\..*\.(clean|process)$`

/** Format a failed Git command without exposing the scrubbed environment. */
function commandFailure(command: string, output: GitCommandOutput): Error {
  const detail = output.stderr.trim()
  return new Error(`git ${command} failed with status ${String(output.status)}${detail === '' ? '' : `: ${detail}`}`)
}

/**
 * Execute Git with every repository-configured executable integration disabled.
 * @param cwd - Worktree directory for the child process.
 * @param args - Git arguments after the safety configuration prefix.
 * @param timeoutMs - Maximum lifetime of this child process.
 * @param signal - Command-lifecycle cancellation signal.
 * @param filterOverrides - Filter-driver names whose executables must be blanked.
 * @returns Captured exit status and UTF-8 output.
 */
function runGit(
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
  signal: AbortSignal,
  filterOverrides: readonly string[] = [],
): Promise<GitCommandOutput> {
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Git diff cancelled.'))
  }
  /* v8 ignore next -- Windows selects NUL; the portable suite runs on POSIX. */
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const env: Record<string, string> = scrubbedParentEnv()
  if (filterOverrides.length > 0) {
    const values = filterOverrides.flatMap(driver => [
      [`${driver}.clean`, ''],
      [`${driver}.process`, ''],
      [`${driver}.required`, 'false'],
    ] as const)
    env.GIT_CONFIG_COUNT = String(values.length)
    values.forEach(([key, value], index) => {
      env[`GIT_CONFIG_KEY_${String(index)}`] = key
      env[`GIT_CONFIG_VALUE_${String(index)}`] = value
    })
  }
  const argv = [
    '-c', 'safe.bareRepository=explicit',
    '-c', 'core.fsmonitor=false',
    '-c', `core.hooksPath=${nullDevice}`,
    ...args,
  ]
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn('git', argv, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    timer.unref()
    const onAbort = (): void => { child.kill() }
    signal.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    child.once('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    child.once('close', (status, childSignal) => {
      if (settled) return
      settled = true
      cleanup()
      if (signal.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error('Git diff cancelled.'))
        return
      }
      if (timedOut) {
        reject(new Error(`Git diff timed out after ${String(timeoutMs)} ms.`))
        return
      }
      if (status === null) {
        reject(new Error(`Git diff ended from signal ${childSignal ?? 'unknown'}.`))
        return
      }
      resolve({ status, stdout, stderr })
    })
  })
}

/** Resolve filter driver prefixes that could execute worktree content. */
async function executableFilterDrivers(
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const args = ['config', '--null', '--name-only', '--get-regexp', FILTER_COMMAND_PATTERN]
  const output = await runGit(cwd, args, timeoutMs, signal)
  if (output.status !== 0 && output.status !== 1) throw commandFailure('config', output)
  return [...new Set(output.stdout
    .split('\0')
    .filter(Boolean)
    .map(key => key.replace(/\.(?:clean|process)$/u, '')))]
    .sort()
}

/**
 * Compute the current unstaged Git diff and append a no-index diff for every
 * untracked file, matching Codex's `/diff` worktree semantics without mutating
 * the index.
 * @param cwd - Directory to inspect.
 * @param timeoutMs - Maximum lifetime of each Git child process.
 * @param signal - Cancellation signal owned by the slash-command invocation.
 * @returns Worktree detection plus unified diff text.
 */
export async function gitDiff(
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<GitDiffResult> {
  const probeArgs = ['rev-parse', '--is-inside-work-tree']
  const probe = await runGit(cwd, probeArgs, timeoutMs, signal)
  if (probe.status !== 0) return { isWorktree: false, text: '' }

  const filters = await executableFilterDrivers(cwd, timeoutMs, signal)
  const diffArgs = [
    'diff',
    '--no-color',
    '--no-textconv',
    '--no-ext-diff',
    '--submodule=short',
    '--ignore-submodules=dirty',
  ]
  const tracked = await runGit(cwd, diffArgs, timeoutMs, signal, filters)
  if (tracked.status !== 0 && tracked.status !== 1) throw commandFailure('diff', tracked)

  const listArgs = ['ls-files', '--others', '--exclude-standard', '-z']
  const listed = await runGit(cwd, listArgs, timeoutMs, signal)
  if (listed.status !== 0) throw commandFailure('ls-files', listed)

  /* v8 ignore next -- Windows selects NUL; the portable suite runs on POSIX. */
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
  let text = tracked.stdout
  for (const path of listed.stdout.split('\0').filter(Boolean)) {
    const untrackedArgs = [
      ...diffArgs,
      '--no-index',
      '--',
      nullDevice,
      path,
    ]
    const untracked = await runGit(cwd, untrackedArgs, timeoutMs, signal, filters)
    if (untracked.status !== 0 && untracked.status !== 1) throw commandFailure('diff', untracked)
    text += untracked.stdout
  }
  return { isWorktree: true, text }
}
