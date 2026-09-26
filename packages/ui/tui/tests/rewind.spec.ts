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
    expect(before.commit).toMatch(/^[0-9a-f]{40,64}$/u)
    expect(before.excluded).toEqual([])

    await writeFile(join(workspace, 'tracked.txt'), 'after\n')
    await writeFile(join(workspace, 'untracked.txt'), 'untracked after\n')
    await writeFile(join(workspace, 'created.txt'), 'created after\n')
    await writeFile(join(workspace, 'ignored.txt'), 'ignored after\n')
    const after = await shadow.capture()
    expect(after.commit).not.toBe(before.commit)

    const safety = await shadow.restore(before.commit)
    expect(safety).toBe(after.commit)
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
    await shadow.restore(before.commit)
    expect((await lstat(join(workspace, 'link.txt'))).isSymbolicLink()).toBe(true)
    await expect(readFile(join(workspace, 'link.txt'), 'utf8')).resolves.toBe('target\n')
  })

  it('excludes a file above the per-file limit and leaves it untouched by restore', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    git(root, ['init', '--quiet', workspace])
    await writeFile(join(workspace, 'small.txt'), 'ab')
    const shadow = await ShadowWorkspace.create(workspace, {
      dshHome: join(root, 'home'),
      timeoutMs: 10_000,
      maxFileBytes: 4,
      maxTotalBytes: 1024,
    })
    const before = await shadow.capture()
    expect(before.excluded).toEqual([])

    await writeFile(join(workspace, 'small.txt'), 'cd')
    await writeFile(join(workspace, 'large.bin'), '12345')
    const after = await shadow.capture()
    expect(after.commit).not.toBe(before.commit)
    expect(after.excluded).toEqual([{ path: 'large.bin', bytes: 5, reason: 'per-file' }])

    await shadow.restore(before.commit)
    await expect(readFile(join(workspace, 'small.txt'), 'utf8')).resolves.toBe('ab')
    await expect(readFile(join(workspace, 'large.bin'), 'utf8')).resolves.toBe('12345')
  })

  it('commits an empty tree when the whole workspace is excluded', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    git(root, ['init', '--quiet', workspace])
    await writeFile(join(workspace, 'huge.bin'), '0123456789')
    const shadow = await ShadowWorkspace.create(workspace, {
      dshHome: join(root, 'home'),
      timeoutMs: 10_000,
      maxFileBytes: 4,
      maxTotalBytes: 1024,
    })
    const captured = await shadow.capture()
    expect(captured.commit).toMatch(/^[0-9a-f]{40,64}$/u)
    expect(captured.excluded).toEqual([{ path: 'huge.bin', bytes: 10, reason: 'per-file' }])
  })

  it('excludes a file beyond the aggregate limit', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    git(root, ['init', '--quiet', workspace])
    await writeFile(join(workspace, 'a.txt'), 'aaaa')
    await writeFile(join(workspace, 'b.txt'), 'bbbb')
    const shadow = await ShadowWorkspace.create(workspace, {
      dshHome: join(root, 'home'),
      timeoutMs: 10_000,
      maxFileBytes: 1024,
      maxTotalBytes: 6,
    })
    const captured = await shadow.capture()
    expect(captured.excluded).toHaveLength(1)
    expect(captured.excluded[0]).toMatchObject({ bytes: 4, reason: 'aggregate' })
  })

  it('stages the deletion of a tracked file that is gone', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    git(root, ['init', '--quiet', workspace])
    await writeFile(join(workspace, 'gone.txt'), 'gone')
    const shadow = await ShadowWorkspace.create(workspace, {
      dshHome: join(root, 'home'),
      timeoutMs: 10_000,
      maxFileBytes: 1024,
      maxTotalBytes: 1024,
    })
    const before = await shadow.capture()
    await unlink(join(workspace, 'gone.txt'))
    const after = await shadow.capture()
    expect(after.commit).not.toBe(before.commit)
    await shadow.restore(before.commit)
    await expect(readFile(join(workspace, 'gone.txt'), 'utf8')).resolves.toBe('gone')
  })

  it('leaves an excluded file that a shadow commit once tracked untouched by restore', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    git(root, ['init', '--quiet', workspace])
    await writeFile(join(workspace, 'data.bin'), 'small')
    const shadow = await ShadowWorkspace.create(workspace, {
      dshHome: join(root, 'home'),
      timeoutMs: 10_000,
      maxFileBytes: 8,
      maxTotalBytes: 1024,
    })
    const before = await shadow.capture()
    expect(before.excluded).toEqual([])

    await writeFile(join(workspace, 'data.bin'), 'far too large')
    await writeFile(join(workspace, 'other.txt'), 'other')
    const after = await shadow.capture()
    expect(after.excluded).toEqual([{ path: 'data.bin', bytes: 13, reason: 'per-file' }])

    await shadow.restore(before.commit)
    await expect(readFile(join(workspace, 'data.bin'), 'utf8')).resolves.toBe('far too large')
    await expect(readFile(join(workspace, 'other.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('rewind checkpoint notices', () => {
  it('reports an excluded file once and re-reports after the exclusion ends', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    vi.stubEnv('DSH_HOME', join(root, 'home'))
    await writeFile(join(workspace, 'large.bin'), '0123456789')
    const harness = rewindControllerHarness(workspace, { maxFileBytes: 4, maxTotalBytes: 1024 })

    await harness.checkpoint()
    expect(harness.notices).toEqual([
      'Workspace checkpoint skipped 1 file over the size limit; /rewind will leave it untouched: large.bin',
    ])
    await harness.checkpoint()
    expect(harness.notices).toHaveLength(1)

    await writeFile(join(workspace, 'small.txt'), 'ab')
    await harness.checkpoint()
    expect(harness.notices).toHaveLength(1)

    await unlink(join(workspace, 'large.bin'))
    await harness.checkpoint()
    expect(harness.notices).toHaveLength(1)

    await writeFile(join(workspace, 'large.bin'), '0123456789')
    await harness.checkpoint()
    expect(harness.notices).toHaveLength(2)
    harness.controller.dispose()
  })

  it('summarizes more than three excluded files', async () => {
    const root = await tempRoot()
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    vi.stubEnv('DSH_HOME', join(root, 'home'))
    for (const name of ['a.bin', 'b.bin', 'c.bin', 'd.bin', 'e.bin']) {
      await writeFile(join(workspace, name), '0123456789')
    }
    const harness = rewindControllerHarness(workspace, { maxFileBytes: 4, maxTotalBytes: 1024 })
    await harness.checkpoint()
    expect(harness.notices).toEqual([
      'Workspace checkpoint skipped 5 files over the size limit; /rewind will leave them untouched: a.bin, b.bin, c.bin and 2 more',
    ])
    harness.controller.dispose()
  })
})
