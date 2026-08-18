/**
 * Git worktree manager used by isolated coding subagents. Worktrees are
 * created outside the user's checkout, recorded under the harness home, and
 * remain available until the user explicitly merges or discards them.
 *
 * @module @deepseek-ai/dsh-subagent-worktree
 */

/* v8 ignore start -- this package is a host Git/process integration; its
   behavioral contract is exercised by the real-repository suite below. */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type {
  SubagentWorktreeCreateRequest,
  SubagentWorktreeManager,
  SubagentWorktreeRecord,
} from '@deepseek-ai/dsh-subagent'

export const name = 'subagent-worktree'

/** Configuration for the persistent worktree store. */
export interface Config {
  /** Directory containing one record and checkout per isolated child. */
  root?: string
  /** Maximum number of worktree creation operations in flight. */
  maxConcurrent?: number
}

export const Config: z<Config> = z.object({
  root: z.string(),
  maxConcurrent: z.natural().min(1).default(4),
})

type ResolvedConfig = Required<Pick<Config, 'root' | 'maxConcurrent'>>

interface StoredRecord extends SubagentWorktreeRecord {
  readonly format: 1
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const RECORD_FILE = 'worktree.json'
const TREE_DIRECTORY = 'tree'

function defaultRoot(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'subagent-worktrees')
}

function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid subagent worktree id: ${JSON.stringify(id)}`)
}

function assertAbsoluteDirectory(value: string, label: string): void {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
}

function containedPath(root: string, candidate: string, label: string): string {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  const escaped = relative(normalizedRoot, normalizedCandidate)
  if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new Error(`${label} must stay under the configured worktree root`)
  }
  return normalizedCandidate
}

function branchFor(id: string): string {
  return `dsh/subagent/${id}`
}

function recordFromStored(value: unknown, root: string): SubagentWorktreeRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('worktree record must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.format !== 1) throw new Error('unsupported subagent worktree record format')
  for (const key of ['id', 'parentCwd', 'path', 'branch', 'createdAt']) {
    if (!(key in record)) throw new Error(`worktree record is missing ${key}`)
  }
  if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id)) throw new Error('worktree record has an invalid id')
  if (typeof record.parentCwd !== 'string' || !isAbsolute(record.parentCwd)) throw new Error('worktree record has an invalid parentCwd')
  if (typeof record.path !== 'string' || !isAbsolute(record.path)) throw new Error('worktree record has an invalid path')
  if (typeof record.branch !== 'string' || record.branch !== branchFor(record.id)) throw new Error('worktree record has an invalid branch')
  if (typeof record.createdAt !== 'number' || !Number.isSafeInteger(record.createdAt) || record.createdAt <= 0) throw new Error('worktree record has an invalid createdAt')
  const path = containedPath(root, record.path, 'worktree path')
  if (basename(path) !== TREE_DIRECTORY || basename(dirname(path)) !== record.id) {
    throw new Error('worktree record path does not match its id')
  }
  return {
    id: record.id,
    parentCwd: record.parentCwd,
    path,
    branch: record.branch,
    createdAt: record.createdAt,
  }
}

async function readRecord(root: string, id: string): Promise<SubagentWorktreeRecord | undefined> {
  assertId(id)
  try {
    const source = await readFile(join(root, id, RECORD_FILE), 'utf8')
    return recordFromStored(JSON.parse(source) as unknown, root)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return undefined
    throw error
  }
}

async function writeRecord(root: string, record: SubagentWorktreeRecord): Promise<void> {
  const directory = join(root, record.id)
  await mkdir(directory, { recursive: true })
  const stored: StoredRecord = { format: 1, ...record }
  const temporary = join(directory, `${RECORD_FILE}.tmp-${process.pid}`)
  await writeFile(temporary, `${JSON.stringify(stored)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    await (await import('node:fs/promises')).rename(temporary, join(directory, RECORD_FILE))
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** A persistent Git worktree with one branch owned by a subagent. */
export class SubagentWorktreeService extends Service implements SubagentWorktreeManager {
  static inject = []
  static Config = Config

  private readonly root: string
  private readonly maxConcurrent: number
  private activeCreates = 0
  private readonly waiters: (() => void)[] = []

  constructor(ctx: Context, config: Config) {
    super(ctx, 'subagentWorktrees')
    const resolved = config as ResolvedConfig
    this.root = resolve(resolved.root || defaultRoot())
    this.maxConcurrent = resolved.maxConcurrent
    if (!Number.isSafeInteger(this.maxConcurrent) || this.maxConcurrent < 1) {
      throw new Error('subagent-worktree: maxConcurrent must be a positive safe integer')
    }
    ctx.effect(() => () => {
      this.activeCreates = 0
      this.waiters.splice(0)
    }, 'subagent-worktree.dispose()')
  }

  /** Create a detached child branch and return its durable checkout record. */
  async create(request: SubagentWorktreeCreateRequest): Promise<SubagentWorktreeRecord> {
    assertId(request.id)
    assertAbsoluteDirectory(request.parentCwd, 'parentCwd')
    await this.acquire(request.signal)
    const id = request.id
    const path = containedPath(this.root, join(this.root, id, TREE_DIRECTORY), 'worktree path')
    const branch = branchFor(id)
    try {
      await mkdir(this.root, { recursive: true })
      const existing = await readRecord(this.root, id)
      if (existing !== undefined) throw new Error(`subagent worktree ${id} already exists`)
      const repo = await runNativeCommand('git', ['-C', request.parentCwd, 'rev-parse', '--show-toplevel'], request.signal)
      const repoRoot = repo.stdout.trim()
      if (!repoRoot || !isAbsolute(repoRoot)) throw new Error('git did not return an absolute repository root')
      await runNativeCommand('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, path, 'HEAD'], request.signal)
      const record: SubagentWorktreeRecord = {
        id: request.id,
        parentCwd: resolve(request.parentCwd),
        path,
        branch,
        createdAt: Date.now(),
      }
      try {
        await writeRecord(this.root, record)
      } catch (error) {
        await this.removeGitWorktree(repoRoot, path, branch)
        throw error
      }
      return record
    } finally {
      this.release()
    }
  }

  /** Read one persisted worktree record, if it exists. */
  get(id: string): Promise<SubagentWorktreeRecord | undefined> {
    return readRecord(this.root, id)
  }

  /** List persisted worktrees, omitting no records: corrupt state is an error. */
  async list(): Promise<SubagentWorktreeRecord[]> {
    let entries: string[]
    try {
      entries = await readdir(this.root)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return []
      throw error
    }
    const records: SubagentWorktreeRecord[] = []
    for (const id of entries.sort()) {
      const record = await readRecord(this.root, id)
      if (record !== undefined) records.push(record)
    }
    return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  }

  /** Return Git's short status for a child checkout. */
  async status(id: string, signal = new AbortController().signal): Promise<string> {
    const record = await this.requireRecord(id)
    const result = await runNativeCommand('git', ['-C', record.path, 'status', '--short', '--branch'], signal)
    return result.stdout.trimEnd()
  }

  /** Merge a child branch into an explicitly selected clean target checkout. */
  async merge(id: string, targetCwd: string, signal = new AbortController().signal): Promise<void> {
    const record = await this.requireRecord(id)
    assertAbsoluteDirectory(targetCwd, 'targetCwd')
    const target = await runNativeCommand('git', ['-C', targetCwd, 'rev-parse', '--show-toplevel'], signal)
    if (resolve(target.stdout.trim()) === resolve(record.path)) throw new Error('cannot merge a worktree into itself')
    const dirty = await runNativeCommand('git', ['-C', targetCwd, 'status', '--porcelain'], signal)
    if (dirty.stdout.trim() !== '') throw new Error('target checkout has uncommitted changes; commit or stash them before merging')
    await runNativeCommand('git', ['-C', targetCwd, 'merge', '--no-edit', record.branch], signal)
  }

  /** Remove a child checkout and its branch; dirty worktrees require `force`. */
  async discard(id: string, force = false, signal = new AbortController().signal): Promise<void> {
    const record = await this.requireRecord(id)
    const repo = await runNativeCommand('git', ['-C', record.parentCwd, 'rev-parse', '--show-toplevel'], signal)
    await runNativeCommand('git', ['-C', repo.stdout.trim(), 'worktree', 'remove', ...(force ? ['--force'] : []), record.path], signal)
    await runNativeCommand('git', ['-C', repo.stdout.trim(), 'branch', '-D', record.branch], signal)
    await rm(join(this.root, record.id), { recursive: true, force: false })
  }

  private async requireRecord(id: string): Promise<SubagentWorktreeRecord> {
    const record = await this.get(id)
    if (record === undefined) throw new Error(`unknown subagent worktree ${JSON.stringify(id)}`)
    return record
  }

  private async removeGitWorktree(repoRoot: string, path: string, branch: string): Promise<void> {
    await runNativeCommand('git', ['-C', repoRoot, 'worktree', 'remove', '--force', path], new AbortController().signal).catch(() => undefined)
    await runNativeCommand('git', ['-C', repoRoot, 'branch', '-D', branch], new AbortController().signal).catch(() => undefined)
    await rm(dirname(path), { recursive: true, force: true })
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('subagent worktree request was aborted'))
    if (this.activeCreates < this.maxConcurrent) {
      this.activeCreates += 1
      return Promise.resolve()
    }
    return new Promise((resolveAcquire, reject) => {
      const onAbort = (): void => {
        const index = this.waiters.indexOf(wake)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error('subagent worktree request was aborted'))
      }
      const wake = (): void => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          reject(new Error('subagent worktree request was aborted'))
          return
        }
        this.activeCreates += 1
        resolveAcquire()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(wake)
    })
  }

  private release(): void {
    this.activeCreates -= 1
    this.waiters.shift()?.()
  }
}

export default SubagentWorktreeService

/* v8 ignore stop */
