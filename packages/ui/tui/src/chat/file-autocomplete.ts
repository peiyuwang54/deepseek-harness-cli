/**
 * Host-workspace discovery for TUI `@file` completion. The index contains
 * paths only: selected values remain ordinary prompt text and file contents
 * stay behind the model-facing `read` tool.
 *
 * @module @deepseek-ai/dsh-tui/chat/file-autocomplete
 */

import { lstat, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'

/** Default maximum file and directory candidates rendered for one query. */
export const DEFAULT_FILE_SEARCH_MAX_RESULTS = 20
/** Default maximum entries retained in one workspace search index. */
export const DEFAULT_FILE_SEARCH_MAX_ENTRIES = 10_000
/** Directory basenames omitted from traversal unless the deployment overrides them. */
export const DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES = ['.git', 'node_modules'] as const

/** Resolved limits and exclusions for one TUI workspace index. */
export interface FileSearchConfig {
  /** Maximum ranked candidates returned for one query. */
  maxResults: number
  /** Maximum indexed files and directories. */
  maxEntries: number
  /** Directory basenames never traversed or offered. */
  excludedDirectories: readonly string[]
  /** Apply project `.gitignore` and `.ignore` rules before offering candidates. */
  respectIgnoreFiles: boolean
}

/** One path-only completion candidate inside the session cwd. */
export interface FileSearchCandidate {
  /** User-facing path accepted by the normal prompt and filesystem tools. */
  path: string
  /** Directories keep completion open; files finish the mention. */
  kind: 'file' | 'directory'
}

/** Active `@` token ending at the editor cursor. */
export interface ActiveAtToken {
  /** Complete token replaced when the user accepts a completion. */
  prefix: string
  /** Path query after `@` or `@"`. */
  query: string
  /** Whether the user opened a quoted path. */
  quoted: boolean
}

interface IndexedPath extends FileSearchCandidate {}

interface RankedPath {
  candidate: FileSearchCandidate
  score: number
}

interface IndexGeneration {
  controller: AbortController
  promise: Promise<IndexedPath[]>
}

interface IgnoreScope {
  base: string
  matcher: Ignore
}

interface RootIgnoreContext {
  gitRoot: string | undefined
  scopes: readonly IgnoreScope[]
}

interface SearchDirectory {
  absolute: string
  relative: string
  scopes: readonly IgnoreScope[]
}

/**
 * Extract an `@path` or `@"path with spaces` token at the cursor. An `@`
 * inside another token, such as an email address, is not a completion trigger.
 * @param line - current editor line.
 * @param cursorCol - cursor column within that line.
 * @returns the active token, or `undefined` outside an `@` token.
 */
export function activeAtToken(line: string, cursorCol: number): ActiveAtToken | undefined {
  const beforeCursor = line.slice(0, cursorCol)
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor)
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true }
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor)
  if (plain?.[1] === undefined || plain[2] === undefined) return undefined
  return { prefix: plain[1], query: plain[2], quoted: false }
}

/**
 * Format a selected path as prompt text. Whitespace uses Pi's quoted
 * `@"path"` grammar; directories retain a trailing slash so completion can
 * descend another level.
 * @param candidate - selected file or directory.
 * @param preserveQuote - retain an explicitly opened quote even when unnecessary.
 * @returns the insertion value, or `undefined` for a path the editor grammar cannot represent safely.
 */
export function formatFileMention(
  candidate: FileSearchCandidate,
  preserveQuote: boolean,
): string | undefined {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  const quoted = preserveQuote || /\s/u.test(path)
  if (!quoted) return `@${path}`
  return `@"${path}"`
}

/**
 * Cancellable, reusable fuzzy index rooted at one agent working directory.
 * Directory-scoped queries list live state; bare fuzzy queries share one
 * bounded traversal until the `@` interaction ends or a tool result invalidates it.
 */
export class WorkspaceFileSearch {
  private readonly excludedDirectories: ReadonlySet<string>
  private generation: IndexGeneration | undefined
  private disposed = false

  constructor(
    private readonly root: string,
    private readonly config: FileSearchConfig,
  ) {
    if (!Number.isSafeInteger(config.maxResults) || config.maxResults <= 0) {
      throw new Error('file search maxResults must be a positive safe integer')
    }
    if (!Number.isSafeInteger(config.maxEntries) || config.maxEntries <= 0) {
      throw new Error('file search maxEntries must be a positive safe integer')
    }
    if (config.excludedDirectories.some(name => name.length === 0 || name.includes('/') || name.includes('\\'))) {
      throw new Error('file search excludedDirectories entries must be non-empty directory basenames')
    }
    this.excludedDirectories = new Set(config.excludedDirectories)
  }

  /**
   * Return ranked path candidates for the current token.
   * @param rawQuery - path text following `@` or `@"`.
   * @param signal - cancels this caller's wait without killing an index shared by a newer query.
   * @returns at most `maxResults` deterministic candidates.
   */
  async list(rawQuery: string, signal: AbortSignal): Promise<FileSearchCandidate[]> {
    signal.throwIfAborted()
    if (this.disposed) return []
    const query = rawQuery.replaceAll('\\', '/')
    const slash = query.lastIndexOf('/')
    if (query === '' || slash >= 0) {
      const directory = slash < 0 ? '' : query.slice(0, slash + 1)
      const fragment = slash < 0 ? '' : query.slice(slash + 1)
      return this.listDirectory(directory, fragment, signal)
    }
    const indexed = await waitForPromise(this.ensureIndex(), signal)
    return rankCandidates(
      indexed.filter(candidate => visibleForGlobalQuery(candidate.path, query)),
      query,
      this.config.maxResults,
    )
  }

  /** Discard the current index so the next bare query observes a fresh tree. */
  invalidate(): void {
    this.generation?.controller.abort(new Error('file search index invalidated'))
    this.generation = undefined
  }

  /** Abort traversal and make later queries return no candidates. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.invalidate()
  }

  private ensureIndex(): Promise<IndexedPath[]> {
    if (this.generation !== undefined) return this.generation.promise
    const controller = new AbortController()
    const generation = {
      controller,
      promise: Promise.resolve([] as IndexedPath[]),
    } satisfies IndexGeneration
    generation.promise = this.scanWorkspace(controller.signal).catch((error: unknown) => {
      /* v8 ignore next -- every owned abort clears `generation` synchronously; this only protects an unexpected scan failure */
      if (this.generation === generation) this.generation = undefined
      throw error
    })
    this.generation = generation
    return generation.promise
  }

  private async scanWorkspace(signal: AbortSignal): Promise<IndexedPath[]> {
    const indexed: IndexedPath[] = []
    const ignoreContext = await loadRootIgnoreContext(this.root, this.config.respectIgnoreFiles, signal)
    const directories: SearchDirectory[] = [{
      absolute: this.root,
      relative: '',
      scopes: ignoreContext.scopes,
    }]
    for (let cursor = 0; cursor < directories.length && indexed.length < this.config.maxEntries; cursor += 1) {
      signal.throwIfAborted()
      const directory = directories[cursor]
      /* v8 ignore next 3 -- cursor is bounded by this exact queue's length. */
      if (directory === undefined) {
        throw new Error('file search selected a missing directory')
      }
      const entries = await readDirectory(directory.absolute, signal)
      for (const entry of entries) {
        signal.throwIfAborted()
        const path = directory.relative === '' ? entry.name : `${directory.relative}/${entry.name}`
        const absolute = join(directory.absolute, entry.name)
        if (entry.isDirectory()) {
          if (this.excludedDirectories.has(entry.name)) continue
          if (ignoredByScopes(absolute, true, directory.scopes)) continue
          indexed.push({ path, kind: 'directory' })
          directories.push({
            absolute,
            relative: path,
            scopes: await extendIgnoreScopes(directory.scopes, absolute, ignoreContext.gitRoot, signal),
          })
        } else if (entry.isFile()) {
          if (ignoredByScopes(absolute, false, directory.scopes)) continue
          indexed.push({ path, kind: 'file' })
        }
        if (indexed.length >= this.config.maxEntries) break
      }
    }
    return indexed
  }

  private async listDirectory(
    displayDirectory: string,
    fragment: string,
    signal: AbortSignal,
  ): Promise<FileSearchCandidate[]> {
    if (displayDirectory.split('/').some(segment => this.excludedDirectories.has(segment))) return []
    const absolute = await resolveDisplayDirectory(this.root, displayDirectory, signal)
    if (absolute === undefined) return []
    const ignoreContext = await loadIgnoreContextForDirectory(
      this.root,
      absolute,
      this.config.respectIgnoreFiles,
      signal,
    )
    if (ignoreContext === undefined) return []
    const entries = await readDirectory(absolute, signal)
    const candidates: FileSearchCandidate[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !fragment.startsWith('.')) continue
      const entryAbsolute = join(absolute, entry.name)
      if (entry.isDirectory()) {
        if (this.excludedDirectories.has(entry.name)) continue
        if (ignoredByScopes(entryAbsolute, true, ignoreContext.scopes)) continue
        candidates.push({ path: `${displayDirectory}${entry.name}`, kind: 'directory' })
      } else if (entry.isFile()) {
        if (ignoredByScopes(entryAbsolute, false, ignoreContext.scopes)) continue
        candidates.push({ path: `${displayDirectory}${entry.name}`, kind: 'file' })
      }
    }
    return rankCandidates(candidates, fragment, this.config.maxResults)
  }
}

async function loadIgnoreContextForDirectory(
  root: string,
  target: string,
  respectIgnoreFiles: boolean,
  signal: AbortSignal,
): Promise<RootIgnoreContext | undefined> {
  const context = await loadRootIgnoreContext(root, respectIgnoreFiles, signal)
  let scopes = context.scopes
  for (const directory of descendantDirectories(root, target)) {
    if (ignoredByScopes(directory, true, scopes)) return undefined
    scopes = await extendIgnoreScopes(scopes, directory, context.gitRoot, signal)
  }
  return { gitRoot: context.gitRoot, scopes }
}

async function loadRootIgnoreContext(
  root: string,
  respectIgnoreFiles: boolean,
  signal: AbortSignal,
): Promise<RootIgnoreContext> {
  if (!respectIgnoreFiles) return { gitRoot: undefined, scopes: [] }
  const resolvedRoot = resolve(root)
  const gitRoot = await findGitRoot(resolvedRoot, signal)
  let scopes: readonly IgnoreScope[] = []
  if (gitRoot !== undefined) {
    const gitExclude = await loadGitExcludeScope(gitRoot, signal)
    if (gitExclude !== undefined) scopes = [...scopes, gitExclude]
    const parent = dirname(resolvedRoot)
    if (isAtOrInside(gitRoot, parent)) {
      for (const directory of inclusiveDirectories(gitRoot, parent)) {
        scopes = await extendIgnoreScopes(scopes, directory, gitRoot, signal)
      }
    }
  }
  scopes = await extendIgnoreScopes(scopes, resolvedRoot, gitRoot, signal)
  return { gitRoot, scopes }
}

async function extendIgnoreScopes(
  scopes: readonly IgnoreScope[],
  directory: string,
  gitRoot: string | undefined,
  signal: AbortSignal,
): Promise<readonly IgnoreScope[]> {
  const patterns: string[] = []
  if (gitRoot !== undefined && isAtOrInside(gitRoot, directory)) {
    const gitignore = await readIgnoreFile(join(directory, '.gitignore'), signal)
    if (gitignore !== undefined) patterns.push(gitignore)
  }
  const genericIgnore = await readIgnoreFile(join(directory, '.ignore'), signal)
  if (genericIgnore !== undefined) patterns.push(genericIgnore)
  if (patterns.length === 0) return scopes
  const matcher = ignore()
  for (const pattern of patterns) matcher.add(pattern)
  return [...scopes, { base: directory, matcher }]
}

async function loadGitExcludeScope(gitRoot: string, signal: AbortSignal): Promise<IgnoreScope | undefined> {
  const dotGit = join(gitRoot, '.git')
  let gitDirectory: string | undefined
  try {
    const status = await lstat(dotGit)
    signal.throwIfAborted()
    if (status.isFile()) {
      const pointer = await readFile(dotGit, { encoding: 'utf8', signal })
      const match = /^gitdir:\s*(.+)\s*$/imu.exec(pointer)
      if (match?.[1] !== undefined) gitDirectory = resolve(gitRoot, match[1])
    } else {
      gitDirectory = dotGit
    }
  } catch (_error: unknown) {
    /* v8 ignore next -- only a host race after `findGitRoot` can make this marker read fail after abort. */
    signal.throwIfAborted()
    // Missing or unreadable repository metadata only omits the optional
    // repository-local exclude source; normal project ignore files still apply.
  }
  if (gitDirectory === undefined) return undefined
  const patterns = await readIgnoreFile(join(gitDirectory, 'info', 'exclude'), signal)
  if (patterns === undefined) return undefined
  return { base: gitRoot, matcher: ignore().add(patterns) }
}

async function findGitRoot(start: string, signal: AbortSignal): Promise<string | undefined> {
  let directory = start
  while (true) {
    signal.throwIfAborted()
    try {
      await lstat(join(directory, '.git'))
      signal.throwIfAborted()
      return directory
    } catch (_error: unknown) {
      signal.throwIfAborted()
      // A missing or unreadable marker means this directory is not an
      // observable repository root; continue with its parent.
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

async function readIgnoreFile(path: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    return await readFile(path, { encoding: 'utf8', signal })
  } catch (_error: unknown) {
    signal.throwIfAborted()
    // Missing and unreadable ignore files contribute no rules; autocomplete
    // remains advisory over every readable subtree.
    return undefined
  }
}

function ignoredByScopes(absolute: string, directory: boolean, scopes: readonly IgnoreScope[]): boolean {
  let ignored = false
  for (const scope of scopes) {
    const scoped = relative(scope.base, absolute).split(sep).join('/')
    const result = scope.matcher.test(directory ? `${scoped}/` : scoped)
    if (result.ignored) ignored = true
    else if (result.unignored) ignored = false
  }
  return ignored
}

function inclusiveDirectories(start: string, target: string): string[] {
  const fromStart = relative(start, target)
  if (fromStart === '') return [start]
  const directories = [start]
  let current = start
  for (const segment of fromStart.split(sep)) {
    current = join(current, segment)
    directories.push(current)
  }
  return directories
}

function descendantDirectories(root: string, target: string): string[] {
  const directories = inclusiveDirectories(resolve(root), resolve(target))
  return directories.slice(1)
}

function isAtOrInside(base: string, target: string): boolean {
  const fromBase = relative(base, target)
  return fromBase === '' || (!fromBase.startsWith(`..${sep}`) && fromBase !== '..' && !isAbsolute(fromBase))
}

async function resolveDisplayDirectory(
  root: string,
  displayDirectory: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const resolvedRoot = resolve(root)
  const absolute = resolve(resolvedRoot, displayDirectory === '' ? '.' : displayDirectory)
  const fromRoot = relative(resolvedRoot, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return undefined
  /* v8 ignore next -- only Windows can produce a cross-volume absolute relative path */
  if (isAbsolute(fromRoot)) return undefined
  let current = resolvedRoot
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    signal.throwIfAborted()
    current = join(current, segment)
    try {
      const status = await lstat(current)
      signal.throwIfAborted()
      if (status.isSymbolicLink() || !status.isDirectory()) return undefined
    } catch (_error: unknown) {
      signal.throwIfAborted()
      return undefined
    }
  }
  return absolute
}

async function readDirectory(absolute: string, signal: AbortSignal) {
  signal.throwIfAborted()
  try {
    const entries = await readdir(absolute, { withFileTypes: true })
    signal.throwIfAborted()
    return entries.sort((left, right) => compareText(left.name, right.name))
  } catch (_error: unknown) {
    /* v8 ignore next -- resolution already observed a directory; this branch requires an abort during the immediate host listing race. */
    signal.throwIfAborted()
    // An unreadable/missing subtree contributes no candidates; other readable
    // branches remain useful and autocomplete is advisory.
    /* v8 ignore next -- this branch requires the directory to disappear or become unreadable after successful resolution. */
    return []
  }
}

function visibleForGlobalQuery(path: string, query: string): boolean {
  if (query.startsWith('.') || query.includes('/.')) return true
  return !path.split('/').some(segment => segment.startsWith('.'))
}

function rankCandidates(
  candidates: readonly FileSearchCandidate[],
  query: string,
  limit: number,
): FileSearchCandidate[] {
  const ranked: RankedPath[] = []
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query)
    if (score !== undefined) ranked.push({ candidate, score })
  }
  ranked.sort((left, right) =>
    right.score - left.score
    || kindRank(left.candidate.kind) - kindRank(right.candidate.kind)
    || (query === '' ? 0 : left.candidate.path.length - right.candidate.path.length)
    || compareText(left.candidate.path, right.candidate.path))
  return ranked.slice(0, limit).map(entry => entry.candidate)
}

function scoreCandidate(candidate: FileSearchCandidate, query: string): number | undefined {
  if (query === '') return 0
  const path = candidate.path.toLowerCase()
  const name = path.slice(path.lastIndexOf('/') + 1)
  const needle = query.toLowerCase()
  const directoryBonus = candidate.kind === 'directory' ? 25 : 0
  if (name === needle) return 1_000 + directoryBonus
  if (name.startsWith(needle)) return 900 + directoryBonus
  if (name.includes(needle)) return 700 + directoryBonus
  if (path.includes(needle)) return 500 + directoryBonus
  const subsequence = subsequenceScore(path, needle)
  return subsequence === undefined ? undefined : 300 + subsequence + directoryBonus
}

function subsequenceScore(target: string, query: string): number | undefined {
  let targetIndex = 0
  let gap = 0
  for (const character of query) {
    const found = target.indexOf(character, targetIndex)
    if (found < 0) return undefined
    gap += found - targetIndex
    targetIndex = found + 1
  }
  return Math.max(0, 100 - gap)
}

function kindRank(kind: FileSearchCandidate['kind']): number {
  return kind === 'directory' ? 0 : 1
}

function compareText(left: string, right: string): number {
  /* v8 ignore next -- entries and candidates are unique; host enumeration
   * order determines which comparison direction sort requests. */
  return left < right ? -1 : left > right ? 1 : 0
}

function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  /* v8 ignore next -- `list()` checks this signal immediately before its synchronous call into this helper */
  if (signal.aborted) return Promise.reject(errorReason(signal.reason, 'file search aborted'))
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => { rejectPromise(errorReason(signal.reason, 'file search aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        rejectPromise(errorReason(error, 'file search index failed'))
      },
    )
  })
}

function errorReason(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback, { cause: reason })
}
