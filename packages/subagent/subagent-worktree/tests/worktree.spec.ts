import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import { describe, expect, it } from 'vitest'
import WorktreeService from '../src/index.ts'

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await runNativeCommand('git', ['-C', cwd, ...args], new AbortController().signal)).stdout.trim()
}

async function repository(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-worktree-repo-'))
  await git(cwd, ['init', '-q'])
  await writeFile(join(cwd, 'README.md'), 'base\n')
  await git(cwd, ['add', 'README.md'])
  await runNativeCommand('git', ['-C', cwd, '-c', 'user.name=dsh-test', '-c', 'user.email=dsh@example.test', 'commit', '-qm', 'base'], new AbortController().signal)
  return cwd
}

async function mountManager(root: string) {
  const ctx = new Context()
  await ctx.plugin(WorktreeService, { root, maxConcurrent: 1 })
  return { ctx, manager: ctx.get('subagentWorktrees')! }
}

describe('@deepseek-ai/dsh-subagent-worktree', () => {
  it('creates a durable branch outside the parent checkout and lists its status', async () => {
    const repo = await repository()
    const root = await mkdtemp(join(tmpdir(), 'dsh-worktree-root-'))
    const { ctx, manager } = await mountManager(root)
    try {
      const record = await manager.create({ id: 'child-1', parentCwd: repo, signal: new AbortController().signal })
      expect(record.branch).toBe('dsh/subagent/child-1')
      expect(record.path).toBe(join(root, 'child-1', 'tree'))
      expect(await git(record.path, ['branch', '--show-current'])).toBe(record.branch)
      expect(await manager.list()).toEqual([record])
      expect(await manager.status('child-1')).toContain('##')
    } finally {
      await ctx.fiber.dispose()
      await rm(repo, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    }
  })

  it('merges only into an explicit clean target and then discards the child', async () => {
    const repo = await repository()
    const root = await mkdtemp(join(tmpdir(), 'dsh-worktree-root-'))
    const { ctx, manager } = await mountManager(root)
    try {
      const record = await manager.create({ id: 'child-2', parentCwd: repo, signal: new AbortController().signal })
      await writeFile(join(record.path, 'answer.txt'), 'child\n')
      await git(record.path, ['add', 'answer.txt'])
      await runNativeCommand('git', ['-C', record.path, '-c', 'user.name=dsh-test', '-c', 'user.email=dsh@example.test', 'commit', '-qm', 'child'], new AbortController().signal)
      await manager.merge('child-2', repo)
      expect(await readFile(join(repo, 'answer.txt'), 'utf8')).toBe('child\n')
      await manager.discard('child-2')
      expect(await manager.get('child-2')).toBeUndefined()
      expect(await git(repo, ['branch', '--list', record.branch])).toBe('')
    } finally {
      await ctx.fiber.dispose()
      await rm(repo, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a dirty target and requires force for a dirty child', async () => {
    const repo = await repository()
    const root = await mkdtemp(join(tmpdir(), 'dsh-worktree-root-'))
    const { ctx, manager } = await mountManager(root)
    try {
      const record = await manager.create({ id: 'child-3', parentCwd: repo, signal: new AbortController().signal })
      await writeFile(join(repo, 'dirty.txt'), 'target\n')
      await expect(manager.merge('child-3', repo)).rejects.toThrow('target checkout has uncommitted changes')
      await writeFile(join(record.path, 'child-dirty.txt'), 'child\n')
      await expect(manager.discard('child-3')).rejects.toThrow()
      await manager.discard('child-3', true)
    } finally {
      await ctx.fiber.dispose()
      await rm(repo, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    }
  })
})
