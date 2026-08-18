import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  createUserShellRunner,
  type UserShellRequest,
} from '../src/chat/user-shell.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fixture(cwd?: string): { ctx: Context; request: UserShellRequest } {
  const ctx = new Context()
  contexts.push(ctx)
  const id = SessionId(`shell-${contexts.length}`)
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    ...cwd === undefined ? {} : { cwd },
  })
  return {
    ctx,
    request: {
      command: 'printf hello',
      agent: { session } as Agent,
      signal: new AbortController().signal,
    },
  }
}

describe('TUI user shell runner', () => {
  it('reports a profile without a shell executor', async () => {
    const { ctx, request } = fixture('/workspace')
    await expect(createUserShellRunner(ctx)(request)).rejects.toThrow('unavailable in this profile')
  })

  it('rejects a confining executor without its policy owner', async () => {
    const { ctx, request } = fixture('/workspace')
    ctx.provide('shell', { sandboxMode: 'workspace-write' } as never)
    await expect(createUserShellRunner(ctx)(request)).rejects.toThrow('requires a sandbox policy')
  })

  it('runs under the current Session policy and detaches complete executor facts', async () => {
    const { ctx, request } = fixture('/workspace-link')
    const run = vi.fn().mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: 10_000,
      stdout: { text: 'hello\n', truncated: true, spillPath: '/tmp/stdout.log' },
      stderr: { text: '', truncated: false },
      sandbox: {
        mode: 'workspace-write',
        denied: false,
        enforcement: 'complete',
        runnerFailed: false,
      },
    })
    const resolve = vi.fn((value: object) => ({ ...value, timeoutMs: 10_000, stdoutMaxBytes: 1_000 }))
    ctx.provide('shell', { sandboxMode: 'workspace-write', resolve, run } as never)
    ctx.provide('sandboxPolicy', {
      resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: '/workspace-real', additionalWritableRoots: [] })),
    } as never)

    await expect(createUserShellRunner(ctx)(request)).resolves.toEqual({
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      stdout: { text: 'hello\n', truncated: true, spillPath: '/tmp/stdout.log' },
      stderr: { text: '', truncated: false },
      sandbox: {
        mode: 'workspace-write',
        denied: false,
        enforcement: 'complete',
        runnerFailed: false,
      },
    })
    expect(resolve).toHaveBeenCalledWith({
      command: 'printf hello',
      workdir: '/workspace-real',
      signal: request.signal,
      sandboxPolicy: { mode: 'workspace-write', workspaceRoot: '/workspace-real', additionalWritableRoots: [] },
    })
    expect(run).toHaveBeenCalledOnce()
  })

  it('omits unavailable optional sandbox facts from the durable result', async () => {
    const { ctx, request } = fixture('/workspace')
    ctx.provide('shell', {
      sandboxMode: 'read-only',
      resolve: vi.fn((value: unknown) => value),
      run: vi.fn().mockResolvedValue({
        exitCode: 1,
        signal: null,
        timedOut: false,
        aborted: false,
        stdout: { text: '', truncated: false },
        stderr: { text: 'denied', truncated: false },
        sandbox: { mode: 'read-only', denied: true },
      }),
    } as never)
    ctx.provide('sandboxPolicy', {
      resolve: vi.fn(() => ({ mode: 'read-only', workspaceRoot: '/workspace', additionalWritableRoots: [] })),
    } as never)

    await expect(createUserShellRunner(ctx)(request)).resolves.toMatchObject({
      sandbox: { mode: 'read-only', denied: true },
    })
  })

  it('uses the Session cwd or process cwd with an unconfined executor', async () => {
    const first = fixture('/project')
    const second = fixture()
    const result = {
      exitCode: null,
      signal: 'SIGTERM',
      timedOut: false,
      aborted: true,
      timeoutMs: 1,
      stdout: { text: '', truncated: false },
      stderr: { text: 'stopped', truncated: true, spillPath: '/tmp/stderr.log' },
    }
    const firstResolve = vi.fn((value: object) => ({ ...value, timeoutMs: 1, stdoutMaxBytes: 1 }))
    first.ctx.provide('shell', {
      resolve: firstResolve,
      run: vi.fn().mockResolvedValue(result),
    } as never)
    const secondResolve = vi.fn((value: object) => ({ ...value, timeoutMs: 1, stdoutMaxBytes: 1 }))
    second.ctx.provide('shell', {
      resolve: secondResolve,
      run: vi.fn().mockResolvedValue(result),
    } as never)

    const expected = {
      exitCode: null,
      signal: 'SIGTERM',
      timedOut: false,
      aborted: true,
      stdout: { text: '', truncated: false },
      stderr: { text: 'stopped', truncated: true, spillPath: '/tmp/stderr.log' },
    }
    await expect(createUserShellRunner(first.ctx)(first.request)).resolves.toEqual(expected)
    await expect(createUserShellRunner(second.ctx)(second.request)).resolves.toEqual(expected)
    expect(firstResolve.mock.calls[0]?.[0]).toMatchObject({ workdir: '/project' })
    expect(secondResolve.mock.calls[0]?.[0]).toMatchObject({ workdir: process.cwd() })
  })
})
