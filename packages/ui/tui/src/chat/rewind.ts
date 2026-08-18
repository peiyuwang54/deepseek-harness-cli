/** Isolated workspace snapshots and conversation rewind for the interactive TUI. */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  lstat,
  mkdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { ActionDialog, type ActionDialogChoice } from '../components/dialogs.ts'
import { contentText } from '../components/content.ts'
import type { TuiRuntime } from '../runtime.ts'
import type { TuiOverlaySession } from '../extension/types.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'

/** Kind of filesystem checkpoint recorded in the Session log. */
type WorkspaceCheckpointKind = 'pre-turn' | 'direct-shell' | 'restore-safety'

/** Durable reference to one commit in the workspace's isolated shadow repository. */
interface WorkspaceCheckpointEventData {
  /** Commit object in the shadow repository. */
  readonly commit: string
  /** Human-authored message whose turn had not mutated the workspace yet. */
  readonly userSeq?: number
  /** Why this checkpoint was created. */
  readonly kind: WorkspaceCheckpointKind
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only reference to a workspace snapshot stored outside the real project repository. */
    'tui/workspace-checkpoint': WorkspaceCheckpointEventData
  }
}

interface GitResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/** Testable no-shell process boundary for isolated Git commands. */
export type RewindGitRunner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly timeoutMs: number },
) => Promise<GitResult>

const defaultGitRunner: RewindGitRunner = (command, args, options) => new Promise((resolvePromise, reject) => {
  execFile(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (error === null) {
      resolvePromise({ stdout, stderr, exitCode: 0 })
      return
    }
    const code = typeof error.code === 'number' ? error.code : undefined
    if (code !== undefined) {
      resolvePromise({ stdout, stderr, exitCode: code })
      return
    }
    reject(new Error(error.message, { cause: error }))
  })
})

/** Limits and optional process seam for one shadow workspace repository. */
export interface ShadowWorkspaceOptions {
  readonly timeoutMs: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly dshHome?: string
  readonly git?: RewindGitRunner
}

function safeGitEnvironment(globalConfig: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'GIT_DIR' || key === 'GIT_WORK_TREE' || key === 'GIT_INDEX_FILE'
      || key === 'GIT_OBJECT_DIRECTORY' || key === 'GIT_ALTERNATE_OBJECT_DIRECTORIES'
      || key === 'GIT_CEILING_DIRECTORIES' || key === 'GIT_CONFIG_GLOBAL'
      || key === 'GIT_CONFIG_SYSTEM' || key === 'GIT_CONFIG_NOSYSTEM') continue
    env[key] = value
  }
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = globalConfig
  env.GIT_AUTHOR_NAME = 'DeepSeek Harness'
  env.GIT_AUTHOR_EMAIL = 'checkpoint@deepseek.local'
  env.GIT_COMMITTER_NAME = 'DeepSeek Harness'
  env.GIT_COMMITTER_EMAIL = 'checkpoint@deepseek.local'
  return env
}

function parseNullList(value: string): string[] {
  return value.split('\0').filter(path => path !== '')
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

/**
 * A Git object store whose index and refs live below `$DSH_HOME`, while its
 * work tree is the active workspace. It never reads or writes the project's
 * `.git` directory.
 */
export class ShadowWorkspace {
  readonly workspace: string
  readonly root: string
  private readonly repository: string
  private readonly hooks: string
  private readonly attributes: string
  private readonly globalConfig: string
  private readonly git: RewindGitRunner
  private readonly env: NodeJS.ProcessEnv
  private initialized = false
  private operation: Promise<unknown> = Promise.resolve()

  private constructor(workspace: string, root: string, private readonly options: ShadowWorkspaceOptions) {
    this.workspace = workspace
    this.root = root
    this.repository = join(root, 'repo.git')
    this.hooks = join(root, 'hooks')
    this.attributes = join(root, 'global.attributes')
    this.globalConfig = join(root, 'global.gitconfig')
    this.git = options.git ?? defaultGitRunner
    this.env = safeGitEnvironment(this.globalConfig)
  }

  /**
   * Resolve the canonical workspace and its stable shadow-repository location.
   * @param workspace - workspace directory used by tools.
   * @param options - process and admission limits.
   * @returns an uninitialized shadow workspace.
   */
  static async create(workspace: string, options: ShadowWorkspaceOptions): Promise<ShadowWorkspace> {
    const canonical = await realpath(resolve(workspace))
    const key = createHash('sha256').update(canonical).digest('hex')
    const home = resolveDshHome(options.dshHome)
    return new ShadowWorkspace(canonical, join(home, 'workspace-checkpoints', 'v1', key), options)
  }

  private baseArgs(): string[] {
    return [
      `--git-dir=${this.repository}`,
      `--work-tree=${this.workspace}`,
      '-c', `core.hooksPath=${this.hooks}`,
      '-c', 'commit.gpgSign=false',
      '-c', 'core.autocrlf=false',
      '-c', `core.attributesFile=${this.attributes}`,
    ]
  }

  private async raw(args: readonly string[]): Promise<GitResult> {
    return this.git('git', args, {
      cwd: this.workspace,
      env: this.env,
      timeoutMs: this.options.timeoutMs,
    })
  }

  private async command(args: readonly string[], accepted: readonly number[] = [0]): Promise<GitResult> {
    const result = await this.raw([...this.baseArgs(), ...args])
    if (!accepted.includes(result.exitCode)) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`
      throw new Error(`workspace checkpoint Git command failed: ${detail}`)
    }
    return result
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.root, { recursive: true })
    await mkdir(this.hooks, { recursive: true })
    await writeFile(this.globalConfig, '', { flag: 'a' })
    await writeFile(this.attributes, '', { flag: 'a' })
    try {
      await access(join(this.repository, 'HEAD'))
    } catch {
      const result = await this.raw(['init', '--bare', this.repository])
      if (result.exitCode !== 0) {
        throw new Error(`workspace checkpoint repository initialization failed: ${result.stderr.trim()}`)
      }
    }
    const exclude = ['/.git/']
    if (isWithin(this.workspace, this.root)) {
      const nested = relative(this.workspace, this.root).split(sep).join('/')
      if (nested !== '') exclude.push(`/${nested}/`)
    }
    await writeFile(join(this.repository, 'info', 'exclude'), `${exclude.join('\n')}\n`)
    this.initialized = true
  }

  private async preflight(): Promise<void> {
    const listed = await this.command(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    let total = 0
    for (const path of parseNullList(listed.stdout)) {
      const target = this.resolveTrackedPath(path)
      let stat
      try {
        stat = await lstat(target)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      if (stat.isSymbolicLink()) continue
      if (!stat.isFile()) {
        throw new Error(`workspace checkpoint does not support special or nested-repository entry: ${path}`)
      }
      if (stat.size > this.options.maxFileBytes) {
        throw new Error(`workspace checkpoint refused ${path}: ${stat.size} bytes exceeds the per-file limit`)
      }
      total += stat.size
      if (total > this.options.maxTotalBytes) {
        throw new Error(`workspace checkpoint refused the workspace: ${total} bytes exceeds the aggregate limit`)
      }
    }
  }

  private resolveTrackedPath(path: string): string {
    if (path === '' || path.includes('\0') || isAbsolute(path)) {
      throw new Error('workspace checkpoint encountered an invalid tracked path')
    }
    const target = resolve(this.workspace, path)
    if (!isWithin(this.workspace, target) || target === this.workspace) {
      throw new Error(`workspace checkpoint path escapes the workspace: ${path}`)
    }
    return target
  }

  private async assertNoSymlinkParent(path: string): Promise<void> {
    const target = this.resolveTrackedPath(path)
    let current = dirname(target)
    const parents: string[] = []
    while (current !== this.workspace) {
      if (!isWithin(this.workspace, current)) throw new Error(`workspace checkpoint path escapes the workspace: ${path}`)
      parents.push(current)
      current = dirname(current)
    }
    for (const parent of parents.reverse()) {
      try {
        if ((await lstat(parent)).isSymbolicLink()) {
          throw new Error(`workspace checkpoint refused a path below symbolic-link directory: ${path}`)
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }

  private async captureNow(): Promise<string> {
    await this.ensureInitialized()
    await this.preflight()
    await this.command(['add', '--all', '--', '.'])
    const head = await this.command(['rev-parse', '--verify', 'HEAD'], [0, 128])
    if (head.exitCode === 0) {
      const changed = await this.command(['diff', '--cached', '--quiet'], [0, 1])
      if (changed.exitCode === 0) return head.stdout.trim()
    }
    await this.command(['commit', '--quiet', '--allow-empty', '-m', 'DeepSeek workspace checkpoint'])
    const committed = (await this.command(['rev-parse', 'HEAD'])).stdout.trim()
    if (!/^[0-9a-f]{40,64}$/u.test(committed)) throw new Error('workspace checkpoint produced an invalid commit id')
    return committed
  }

  /**
   * Capture every non-ignored regular file and symbolic link without changing
   * the real repository's refs or index.
   * @returns the stable shadow commit id; unchanged trees reuse the prior id.
   */
  capture(): Promise<string> {
    const task = this.operation.then(() => this.captureNow())
    this.operation = task.catch(() => undefined)
    return task
  }

  private async treePaths(commit: string): Promise<string[]> {
    const result = await this.command(['ls-tree', '-r', '-z', '--name-only', commit])
    return parseNullList(result.stdout)
  }

  private async removeTrackedPath(path: string): Promise<void> {
    const target = this.resolveTrackedPath(path)
    await this.assertNoSymlinkParent(path)
    try {
      const stat = await lstat(target)
      if (stat.isDirectory() && !stat.isSymbolicLink()) return
      await unlink(target)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return
    }
    let parent = dirname(target)
    while (parent !== this.workspace) {
      try {
        await rmdir(parent)
      } catch {
        break
      }
      parent = dirname(parent)
    }
  }

  private async restoreNow(commit: string): Promise<string> {
    if (!/^[0-9a-f]{40,64}$/u.test(commit)) throw new Error('invalid workspace checkpoint id')
    await this.ensureInitialized()
    await this.command(['cat-file', '-e', `${commit}^{commit}`])
    const safety = await this.captureNow()
    const [currentPaths, targetPaths] = await Promise.all([this.treePaths(safety), this.treePaths(commit)])
    for (const path of new Set([...currentPaths, ...targetPaths])) await this.assertNoSymlinkParent(path)
    const targetSet = new Set(targetPaths)
    for (const path of currentPaths) {
      if (!targetSet.has(path)) await this.removeTrackedPath(path)
    }
    await this.command(['read-tree', commit])
    await this.command(['checkout-index', '--all', '--force'])
    return safety
  }

  /**
   * Restore one shadow commit after first capturing the current workspace.
   * @param commit - validated commit previously returned by {@link capture}.
   * @returns the safety commit for the pre-restore workspace.
   */
  restore(commit: string): Promise<string> {
    const task = this.operation.then(() => this.restoreNow(commit))
    this.operation = task.catch(() => undefined)
    return task
  }
}

interface RewindCandidate {
  readonly userSeq: number
  readonly label: string
  readonly boundary?: number
  readonly checkpoint?: WorkspaceCheckpointEventData
}

/** Collaborators for workspace checkpointing and `/rewind` process handoff. */
export interface RewindControllerDeps extends ChatChannelDeps, ChannelNotice {
  readonly agent: Agent
  readonly runtime: TuiRuntime
  agentStatus(): AgentStatus
  releaseTerminal(): void
  restoreTerminal(): void
}

/** TUI-facing checkpoint and rewind operations. */
export interface RewindController {
  /** Open the historical-message selector. */
  show(defaultFilesOnly?: boolean): string | undefined
  /** Capture the current workspace before a direct human shell command. */
  checkpointDirectShell(): Promise<void>
  /** Stop tool interception and close owned overlays. */
  dispose(): void
}

function humanMessages(events: readonly SessionEvent[]): SessionEvent<'user/message'>[] {
  return events.filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message' && event.data.source.kind === 'user')
}

function priorTurnBoundary(events: readonly SessionEvent[], userSeq: number): number | undefined {
  const turnStart = events.slice(0, userSeq + 1).findLast(event => event.type === 'turn/start')
  if (turnStart === undefined) return undefined
  return events.slice(0, turnStart.seq).findLast(event => event.type === 'turn/end')?.seq
}

function checkpointFor(
  events: readonly SessionEvent[],
  userSeq: number,
  latest = false,
): WorkspaceCheckpointEventData | undefined {
  const matching = events.filter(event =>
    event.type === 'tui/workspace-checkpoint'
    && event.data.userSeq === userSeq)
  const event = latest
    ? matching.findLast(event => event.type === 'tui/workspace-checkpoint')
    : matching.find(event => event.type === 'tui/workspace-checkpoint' && event.data.kind === 'pre-turn')
  return event?.type === 'tui/workspace-checkpoint' ? event.data : undefined
}

function messageLabel(event: SessionEvent<'user/message'>): string {
  const compact = contentText(event.data.content).replace(/\s+/gu, ' ').trim()
  const text = compact === '' ? '(attachment-only message)' : compact
  return text.length <= 72 ? text : `${text.slice(0, 69)}…`
}

/** Build one controller for the currently mounted Agent and workspace. */
export function createRewindController(deps: RewindControllerDeps): RewindController {
  const { ctx, agent, runtime, resolved, palette, overlayManager } = deps
  let disposed = false
  let shadow: Promise<ShadowWorkspace> | undefined
  let messageOverlay: TuiOverlaySession | undefined
  let modeOverlay: TuiOverlaySession | undefined
  let handoffInFlight = false

  const workspace = (): string => agent.session.header.cwd ?? process.cwd()
  const store = (): Promise<ShadowWorkspace> => {
    shadow ??= ShadowWorkspace.create(workspace(), {
      timeoutMs: resolved.rewindGitTimeoutMs,
      maxFileBytes: resolved.rewindMaxFileBytes,
      maxTotalBytes: resolved.rewindMaxTotalBytes,
    })
    return shadow
  }

  const latestHumanSeq = (): number | undefined => humanMessages(agent.session.events).at(-1)?.seq

  const appendCheckpoint = async (kind: WorkspaceCheckpointKind, userSeq?: number, force = false): Promise<void> => {
    if (!force && userSeq !== undefined && checkpointFor(agent.session.events, userSeq) !== undefined) return
    const commit = await (await store()).capture()
    if (disposed) return
    agent.session.append('tui/workspace-checkpoint', {
      commit,
      kind,
      ...userSeq === undefined ? {} : { userSeq },
    })
    await ctx.sessions.flush(agent.session)
  }

  const disposeTool = ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    if (exec.agent === agent && exec.parent === undefined) {
      await appendCheckpoint('pre-turn', latestHumanSeq())
      if (exec.signal.aborted) return next()
    }
    return next()
  })

  const candidates = (latestCheckpoint = false): RewindCandidate[] => humanMessages(agent.session.events).map((event) => {
    const boundary = priorTurnBoundary(agent.session.events, event.seq)
    const checkpoint = checkpointFor(agent.session.events, event.seq, latestCheckpoint)
    return {
      userSeq: event.seq,
      label: messageLabel(event),
      ...boundary === undefined ? {} : { boundary },
      ...checkpoint === undefined ? {} : { checkpoint },
    }
  }).filter(candidate => candidate.boundary !== undefined || candidate.checkpoint !== undefined)

  const perform = async (candidate: RewindCandidate, mode: 'conversation' | 'files' | 'both'): Promise<void> => {
    const files = mode !== 'conversation'
    const conversation = mode !== 'files'
    if (files && candidate.checkpoint === undefined) throw new Error('this message has no workspace checkpoint')
    if (conversation && candidate.boundary === undefined) throw new Error('this message has no completed prior turn boundary')
    if (conversation && runtime.handoffResume === undefined) throw new Error('this host cannot switch sessions in place')
    if (handoffInFlight) throw new Error('a rewind is already in progress')
    handoffInFlight = true
    let terminalReleased = false
    let childId: SessionId | undefined
    try {
      if (files && candidate.checkpoint !== undefined) {
        const safety = await (await store()).restore(candidate.checkpoint.commit)
        if (!disposed) {
          const userSeq = latestHumanSeq()
          agent.session.append('tui/workspace-checkpoint', {
            commit: safety,
            kind: 'restore-safety',
            ...userSeq === undefined ? {} : { userSeq },
          })
          await ctx.sessions.flush(agent.session)
        }
      }
      if (!conversation) {
        if (!disposed) deps.appendNotice('Workspace restored. The pre-restore state remains available as a safety checkpoint.')
        return
      }
      const child = ctx.sessions.fork(agent.session, candidate.boundary)
      childId = child.id
      if (!await ctx.sessions.flush(child)) throw new Error('no session persistence checkpoint accepted the rewind')
      await ctx.sessions.flush(agent.session)
      if (disposed) return
      await runtime.terminal.drainInput(100, 20)
      deps.releaseTerminal()
      terminalReleased = true
      await runtime.handoffResume?.(child.id, workspace())
      throw new Error('rewind host returned without replacing the process')
    } catch (error: unknown) {
      if (!disposed) {
        if (terminalReleased) deps.restoreTerminal()
        const retained = childId === undefined ? '' : `Rewound session ${childId} remains available. `
        deps.appendNotice(`${retained}Rewind failed: ${errorChain(error)}`, 'error')
      }
    } finally {
      handoffInFlight = false
    }
  }

  const showModes = (candidate: RewindCandidate, defaultFilesOnly: boolean): void => {
    void modeOverlay?.close()
    const choices: ActionDialogChoice[] = [
      ...(candidate.boundary === undefined ? [] : [{
        value: 'conversation', label: 'Conversation only', description: 'fork history before this message',
      }]),
      ...(candidate.checkpoint === undefined ? [] : [{
        value: 'files', label: 'Files only', description: 'restore the workspace before this message',
      }]),
      ...(candidate.boundary === undefined || candidate.checkpoint === undefined ? [] : [{
        value: 'both', label: 'Conversation and files', description: 'restore both to before this message',
      }]),
    ]
    const session = overlayManager.open({
      create: () => new ActionDialog(
        'Choose what to rewind',
        choices,
        choices.length,
        palette,
        (value) => {
          void session.close()
          if (value === 'conversation' || value === 'files' || value === 'both') void perform(candidate, value)
        },
        () => { void session.close() },
        defaultFilesOnly && candidate.checkpoint !== undefined ? 'files' : undefined,
      ),
      options: { width: resolved.modelDialogWidth, maxHeight: resolved.modelDialogMaxHeight, anchor: 'center', margin: 1 },
    }, 'composer')
    modeOverlay = session
    void session.closed.then(() => { if (modeOverlay === session) modeOverlay = undefined })
    deps.requestRender()
  }

  return {
    show(defaultFilesOnly = false): string | undefined {
      if (deps.agentStatus() !== 'idle') return '/rewind requires the current turn to finish or be cancelled first.'
      if (handoffInFlight) return 'A rewind is already in progress.'
      const rows = candidates(defaultFilesOnly)
      if (rows.length === 0) return 'No restorable user messages have workspace checkpoints or completed prior turns.'
      void messageOverlay?.close()
      const session = overlayManager.open({
        create: () => new ActionDialog(
          defaultFilesOnly ? 'Restore files from before a message' : 'Rewind to before a message',
          rows.map(row => ({
            value: String(row.userSeq),
            label: row.label,
            description: [row.boundary === undefined ? undefined : 'conversation', row.checkpoint === undefined ? undefined : 'files']
              .filter((part): part is string => part !== undefined).join(' + '),
          })),
          Math.min(rows.length, resolved.maxResumeOptions),
          palette,
          (value) => {
            void session.close()
            const candidate = rows.find(row => row.userSeq === Number(value))
            if (candidate !== undefined) showModes(candidate, defaultFilesOnly)
          },
          () => { void session.close() },
        ),
        options: { width: resolved.modelDialogWidth, maxHeight: resolved.modelDialogMaxHeight, anchor: 'center', margin: 1 },
      }, 'composer')
      messageOverlay = session
      void session.closed.then(() => { if (messageOverlay === session) messageOverlay = undefined })
      deps.requestRender()
      return undefined
    },
    async checkpointDirectShell(): Promise<void> {
      await appendCheckpoint('direct-shell', latestHumanSeq(), true)
    },
    dispose(): void {
      disposed = true
      disposeTool()
      void messageOverlay?.close()
      void modeOverlay?.close()
    },
  }
}
