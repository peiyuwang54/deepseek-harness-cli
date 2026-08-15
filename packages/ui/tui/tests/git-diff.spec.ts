import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitDiff } from '../src/chat/git-diff.ts'

const roots: string[] = []

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-git-diff-'))
  roots.push(root)
  return root
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('/diff Git inspection', () => {
  it('combines tracked and untracked changes without executing configured filters', async () => {
    const root = await temporaryDirectory()
    git(root, 'init', '-q')
    git(root, 'config', 'user.name', 'TUI test')
    git(root, 'config', 'user.email', 'tui@example.invalid')
    await writeFile(join(root, '.gitattributes'), 'tracked.txt filter=unsafe\n')
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n')
    await writeFile(join(root, 'tracked.txt'), 'before\n')
    git(root, 'add', '.gitattributes', '.gitignore', 'tracked.txt')
    git(root, 'commit', '-m', 'seed')
    git(root, 'config', 'filter.unsafe.clean', 'dsh-filter-must-not-run')
    git(root, 'config', 'filter.unsafe.process', 'dsh-filter-must-not-run')
    git(root, 'config', 'filter.unsafe.required', 'true')
    await writeFile(join(root, 'tracked.txt'), 'after\n')
    await writeFile(join(root, 'new file.txt'), 'untracked\n')
    await writeFile(join(root, 'ignored.txt'), 'ignored\n')

    const result = await gitDiff(root, 5_000, new AbortController().signal)

    expect(result.isWorktree).toBe(true)
    expect(result.text).toContain('diff --git a/tracked.txt b/tracked.txt')
    expect(result.text).toContain('-before')
    expect(result.text).toContain('+after')
    expect(result.text).toContain('new file.txt')
    expect(result.text).toContain('+untracked')
    expect(result.text).not.toContain('ignored.txt')
  })

  it('distinguishes a directory outside Git from process startup failures', async () => {
    const root = await temporaryDirectory()
    await expect(gitDiff(root, 5_000, new AbortController().signal))
      .resolves.toEqual({ isWorktree: false, text: '' })
    await expect(gitDiff(join(root, 'missing'), 5_000, new AbortController().signal))
      .rejects.toThrow()
  })

  it('rejects a command that was cancelled before Git starts', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled by test'))
    await expect(gitDiff('/workspace', 5_000, controller.signal))
      .rejects.toThrow('cancelled by test')
  })
})
