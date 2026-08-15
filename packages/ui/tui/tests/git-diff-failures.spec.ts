import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { gitDiff } from '../src/chat/git-diff.ts'

interface FakeGitResponse {
  status?: number | null
  stdout?: string
  stderr?: string
  childSignal?: NodeJS.Signals | null
  error?: Error
  closeAfterError?: boolean
  errorAfterClose?: boolean
  pending?: boolean
}

const responses: FakeGitResponse[] = []

function installFakeGit(): void {
  spawnMock.mockImplementation(() => {
    const response = responses.shift()
    if (response === undefined) throw new Error('fake Git response queue exhausted')
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = vi.fn(() => {
      queueMicrotask(() => { child.emit('close', null, 'SIGTERM') })
      return true
    })
    if (response.pending !== true) {
      queueMicrotask(() => {
        if (response.stdout !== undefined) child.stdout.write(response.stdout)
        if (response.stderr !== undefined) child.stderr.write(response.stderr)
        if (response.error !== undefined) {
          child.emit('error', response.error)
          if (response.closeAfterError === true) child.emit('close', null, null)
          return
        }
        const status = Object.hasOwn(response, 'status') ? response.status : 0
        child.emit('close', status, response.childSignal ?? null)
        if (response.errorAfterClose === true) child.emit('error', new Error('late child error'))
      })
    }
    return child
  })
}

beforeEach(() => {
  responses.length = 0
  spawnMock.mockReset()
  installFakeGit()
})

async function expectGitFailure(queue: FakeGitResponse[], message: string): Promise<void> {
  responses.push(...queue)
  await expect(gitDiff('/workspace', 5_000, new AbortController().signal)).rejects.toThrow(message)
  expect(responses).toHaveLength(0)
}

describe('/diff Git failures', () => {
  it('accepts diff status one, de-duplicates filter drivers, and preserves untracked output', async () => {
    responses.push(
      { status: 0 },
      { status: 0, stdout: 'filter.z.process\0filter.a.clean\0filter.z.clean\0' },
      { status: 1, stdout: 'tracked\n' },
      { status: 0, stdout: 'new.txt\0' },
      { status: 1, stdout: 'untracked\n' },
    )

    await expect(gitDiff('/workspace', 5_000, new AbortController().signal))
      .resolves.toEqual({ isWorktree: true, text: 'tracked\nuntracked\n' })
    expect(responses).toHaveLength(0)
  })

  it('reports config, tracked, listing, and untracked command failures', async () => {
    await expectGitFailure([
      { status: 0 },
      { status: 2, stderr: 'bad config' },
    ], 'git config failed with status 2: bad config')
    await expectGitFailure([
      { status: 0 },
      { status: 1 },
      { status: 2, stderr: 'bad diff' },
    ], 'git diff failed with status 2: bad diff')
    await expectGitFailure([
      { status: 0 },
      { status: 1 },
      { status: 0 },
      { status: 2, stderr: 'bad listing' },
    ], 'git ls-files failed with status 2: bad listing')
    await expectGitFailure([
      { status: 0 },
      { status: 1 },
      { status: 0 },
      { status: 0, stdout: 'new.txt\0' },
      { status: 2 },
    ], 'git diff failed with status 2')
  })

  it('propagates spawn errors and ignores a later close from the failed child', async () => {
    responses.push({ error: new Error('spawn failed'), closeAfterError: true })
    await expect(gitDiff('/workspace', 5_000, new AbortController().signal))
      .rejects.toThrow('spawn failed')
  })

  it('ignores a child error emitted after a successful close', async () => {
    responses.push({ status: 2, errorAfterClose: true })
    await expect(gitDiff('/workspace', 5_000, new AbortController().signal))
      .resolves.toEqual({ isWorktree: false, text: '' })
  })

  it('reports timeout, cancellation, and signal-only termination', async () => {
    responses.push({ pending: true })
    await expect(gitDiff('/workspace', 1, new AbortController().signal))
      .rejects.toThrow('Git diff timed out after 1 ms.')

    const cancelled = new AbortController()
    responses.push({ pending: true })
    const cancelledResult = gitDiff('/workspace', 5_000, cancelled.signal)
    cancelled.abort('stop')
    await expect(cancelledResult).rejects.toThrow('Git diff cancelled.')

    const cancelledWithError = new AbortController()
    responses.push({ pending: true })
    const errorResult = gitDiff('/workspace', 5_000, cancelledWithError.signal)
    cancelledWithError.abort(new Error('cancel error'))
    await expect(errorResult).rejects.toThrow('cancel error')

    await expectGitFailure([
      { status: null, childSignal: 'SIGKILL' },
    ], 'Git diff ended from signal SIGKILL.')
    await expectGitFailure([
      { status: null },
    ], 'Git diff ended from signal unknown.')
  })

  it('normalizes a non-Error cancellation reason before process startup', async () => {
    const controller = new AbortController()
    controller.abort('stop')
    await expect(gitDiff('/workspace', 5_000, controller.signal))
      .rejects.toThrow('Git diff cancelled.')
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
