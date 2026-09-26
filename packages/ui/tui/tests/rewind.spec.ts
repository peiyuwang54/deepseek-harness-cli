import { execFileSync } from 'node:child_process'
import { readFile, lstat, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShadowWorkspace, createRewindController } from '../src/chat/rewind.ts'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-rewind-'))
  roots.push(root)
  return root
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

type ToolsExecuteListener = (
  exec: { agent: unknown; parent: unknown; signal: { aborted: boolean } },
  next: () => Promise<unknown>,
) => Promise<unknown>

/** Minimal controller wiring that reaches the pre-turn checkpoint without a mounted TUI. */
function rewindControllerHarness(workspace: string, limits: { maxFileBytes: number; maxTotalBytes: number }) {
  const notices: string[] = []
  const events: { type: string; data: unknown; seq: number }[] = []
  let listener: ToolsExecuteListener | undefined
  const session = {
    header: { cwd: workspace },
    events,
    append(type: string, data: unknown) {
      const event = { type, data, seq: events.length + 1 }
      events.push(event)
      return event
    },
  }
  const agent = { session }
  const controller = createRewindController({
    ctx: {
      on(event: string, candidate: ToolsExecuteListener) {
        if (event === 'tools/execute') listener = candidate
        return () => {}
      },
      sessions: { flush: () => Promise.resolve(true) },
    },
    agent,
    runtime: {},
    resolved: {
      rewindGitTimeoutMs: 10_000,
      rewindMaxFileBytes: limits.maxFileBytes,
      rewindMaxTotalBytes: limits.maxTotalBytes,
    },
    palette: {},
    overlayManager: {},
    appendNotice: (message: string) => { notices.push(message) },
    agentStatus: () => 'idle',
    releaseTerminal: () => {},
    restoreTerminal: () => {},
    requestRender: () => {},
  } as never)
  return {
    notices,
    controller,
    checkpoint: async (): Promise<void> => {
      if (listener === undefined) throw new Error('tools/execute listener was not registered')
      await listener({ agent, parent: undefined, signal: { aborted: false } }, () => Promise.resolve({ content: [], isError: false }))
    },
  }
}

describe('ShadowWorkspace', () => {
  it('restores tracked and untracked files without touching real Git metadata or ignored files', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    const home = join(root, 'home')
    git(root, ['init', '--quiet', workspace])
    await writeFile(join(workspace, '.gitignore'), 'ignored.txt\n')
    await writeFile(join(workspace, 'tracked.txt'), 'before\n')
    await writeFile(join(workspace, 'untracked.txt'), 'untracked before\n')
    await writeFile(join(workspace, 'ignored.txt'), 'ignored before\n')
    git(workspace, ['add', '.gitignore', 'tracked.txt'])
    git(workspace, ['commit', '--quiet', '-m', 'real history'])
    const realHead = git(workspace, ['rev-parse', 'HEAD'])
    const realIndex = await readFile(join(workspace, '.git', 'index'))

    const shadow = await ShadowWorkspace.create(workspace, {
      dshHome: home,
      timeoutMs: 10_000,
      maxFileBytes: 1024 * 1024,
      maxTotalBytes: 8 * 1024 * 1024,
    })
    const before = await shadow.capture()
    expect(before).toMatch(/^[0-9a-f]{40,64}$/u)

    await writeFile(join(workspace, 'tracked.txt'), 'after\n')
    await writeFile(join(workspace, 'untracked.txt'), 'untracked after\n')
    await writeFile(join(workspace, 'created.txt'), 'created after\n')
    await writeFile(join(workspace, 'ignored.txt'), 'ignored after\n')
    const after = await shadow.capture()
    expect(after).not.toBe(before)

    const safety = await shadow.restore(before)
    expect(safety).toBe(after)
    await expect(readFile(join(workspace, 'tracked.txt'), 'utf8')).resolves.toBe('before\n')
    await expect(readFile(join(workspace, 'untracked.txt'), 'utf8')).resolves.toBe('untracked before\n')
    await expect(readFile(join(workspace, 'created.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(workspace, 'ignored.txt'), 'utf8')).resolves.toBe('ignored after\n')
    expect(git(workspace, ['rev-parse', 'HEAD'])).toBe(realHead)
    expect(await readFile(join(workspace, '.git', 'index'))).toEqual(realIndex)
  })

  it.skipIf(process.platform === 'win32')('stores symbolic links without following their targets', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    git(root, ['init', '--quiet', workspace])
    await writeFile(join(workspace, 'target.txt'), 'target\n')
    await symlink('target.txt', join(workspace, 'link.txt'))
    const shadow = await ShadowWorkspace.create(workspace, {
      dshHome: join(root, 'home'),
      timeoutMs: 10_000,
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
    })
    const before = await shadow.capture()
    await unlink(join(workspace, 'link.txt'))
    await writeFile(join(workspace, 'link.txt'), 'replacement\n')
    await shadow.restore(before)
    expect((await lstat(join(workspace, 'link.txt'))).isSymbolicLink()).toBe(true)
    await expect(readFile(join(workspace, 'link.txt'), 'utf8')).resolves.toBe('target\n')
  })

  it('fails closed before snapshotting a file above the configured limit', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    git(root, ['init', '--quiet', workspace])
    await writeFile(join(workspace, 'large.bin'), '12345')
    const shadow = await ShadowWorkspace.create(workspace, {
      dshHome: join(root, 'home'),
      timeoutMs: 10_000,
      maxFileBytes: 4,
      maxTotalBytes: 10,
    })
    await expect(shadow.capture()).rejects.toThrow(/per-file limit/u)
  })
})

describe('rewind checkpoint failures', () => {
  it('runs the tool and reports a failed checkpoint once', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    vi.stubEnv('DSH_HOME', join(root, 'home'))
    await writeFile(join(workspace, 'large.bin'), '12345')
    const harness = rewindControllerHarness(workspace, { maxFileBytes: 4, maxTotalBytes: 1024 })

    await expect(harness.checkpoint()).resolves.toBeUndefined()
    expect(harness.notices).toHaveLength(1)
    expect(harness.notices[0]).toContain('Workspace checkpoint failed')
    expect(harness.notices[0]).toContain('exceeds the per-file limit')

    await harness.checkpoint()
    expect(harness.notices).toHaveLength(1)

    await unlink(join(workspace, 'large.bin'))
    await harness.checkpoint()
    expect(harness.notices).toHaveLength(1)

    await writeFile(join(workspace, 'large.bin'), '12345')
    await harness.checkpoint()
    expect(harness.notices).toHaveLength(2)
    harness.controller.dispose()
  })

  it('runs a direct shell when the checkpoint fails', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    vi.stubEnv('DSH_HOME', join(root, 'home'))
    await writeFile(join(workspace, 'large.bin'), '12345')
    const harness = rewindControllerHarness(workspace, { maxFileBytes: 4, maxTotalBytes: 1024 })

    await expect(harness.controller.checkpointDirectShell()).resolves.toBeUndefined()
    expect(harness.notices).toHaveLength(1)
    expect(harness.notices[0]).toContain('Workspace checkpoint failed')
    harness.controller.dispose()
  })
})
