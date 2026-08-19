import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  createTuiProcessHandoff,
  relocatableExecArguments,
  relocatableNodeOptions,
  replacementArguments,
  withoutResumeArgument,
  type TuiProcessHandoffInternals,
} from '../src/tui-handoff.ts'

class FakeChild extends EventEmitter {}

function boundaries(child: FakeChild, order: string[]): TuiProcessHandoffInternals {
  return {
    execPath: '/runtime/node',
    execArgv: [],
    scriptPath: '/install/dsh.js',
    cwd: () => '/old/workspace',
    chdir: vi.fn((path: string) => { order.push(`chdir:${path}`) }),
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    resolveExecModule: vi.fn(specifier => `/resolved/${specifier}/index.mjs`),
    execve: undefined,
    spawn: vi.fn((_command, _args, _options) => {
      order.push('spawn')
      return child as unknown as ChildProcess
    }),
    stderr: { write: vi.fn() },
  }
}

function shutdown(order: string[], failure?: Error) {
  return {
    shutdown: vi.fn(async () => {
      order.push('shutdown')
      if (failure !== undefined) throw failure
    }),
    interrupt: vi.fn((code: number) => { order.push(`interrupt:${String(code)}`) }),
  }
}

describe('TUI process handoff', () => {
  it('replaces either resume spelling without consuming unrelated app flags', () => {
    expect(withoutResumeArgument(['--resume', 'old', '--future', 'yes', '--resume=older']))
      .toEqual(['--future', 'yes'])
    expect(replacementArguments({
      profile: 'tui',
      patchFiles: ['./local.yml', '/fixed.yml'],
      args: ['--resume=old', '--future'],
    }, { sessionId: SessionId('next') }, '/work')).toEqual([
      '--profile', 'tui',
      '--patch', resolve('/work/local.yml'),
      '--patch', resolve('/fixed.yml'),
      '--future',
      '--resume', 'next',
    ])
  })

  it('makes source-launch preload flags independent of the replacement cwd', () => {
    const resolveModule = vi.fn((specifier: string) => `/dependencies/${specifier}/index.mjs`)
    expect(relocatableExecArguments([
      '--import', 'tsx/esm',
      '--inspect',
      '--loader=./loader.mjs',
      '--import=file:///fixed/preload.mjs',
      '-r', './instrumentation.cjs',
      '--require=instrumentation-package',
    ], '/old/workspace', resolveModule)).toEqual([
      '--import', pathToFileURL('/dependencies/tsx/esm/index.mjs').href,
      '--inspect',
      `--loader=${pathToFileURL('/old/workspace/loader.mjs').href}`,
      '--import=file:///fixed/preload.mjs',
      '-r', resolve('/old/workspace/instrumentation.cjs'),
      '--require=/dependencies/instrumentation-package/index.mjs',
    ])
    expect(resolveModule).toHaveBeenCalledTimes(2)
    expect(resolveModule).toHaveBeenCalledWith('tsx/esm', '/old/workspace')
    expect(resolveModule).toHaveBeenCalledWith('instrumentation-package', '/old/workspace')
  })

  it('relocates NODE_OPTIONS preloads while preserving quoted values and other flags', () => {
    const resolveModule = vi.fn((specifier: string) => `/dependencies/${specifier}/index.mjs`)
    expect(relocatableNodeOptions(
      '--trace-warnings --import tsx/env --require "./instrumentation files/preload.cjs"',
      '/old/workspace',
      resolveModule,
    )).toBe([
      '--trace-warnings',
      '--import', pathToFileURL('/dependencies/tsx/env/index.mjs').href,
      '--require', JSON.stringify(resolve('/old/workspace/instrumentation files/preload.cjs')),
    ].join(' '))
    expect(() => relocatableNodeOptions('--require "unterminated', '/old/workspace', resolveModule))
      .toThrow('unmatched double quote')
  })

  it('uses execve when available with an absolute entry, pristine environment, and argv zero', async () => {
    const order: string[] = []
    const child = new FakeChild()
    const internals = boundaries(child, order)
    internals.scriptPath = './source/bin.ts'
    internals.execArgv = ['--import', 'tsx/esm']
    const stderr = { write: vi.fn() }
    internals.stderr = stderr
    const execFailure = new Error('execve test boundary')
    internals.execve = vi.fn(() => {
      order.push('execve')
      throw execFailure
    })
    const lifecycle = shutdown(order)
    const beginReplacement = vi.fn(() => { order.push('begin') })
    const prepareSupervisor = vi.fn()
    const host = createTuiProcessHandoff({
      profile: 'tui',
      patchFiles: ['./overlay.yml'],
      args: [],
      environment: {
        ORIGINAL: 'yes',
        NODE_OPTIONS: '--require ./environment-preload.cjs',
        OMIT: undefined,
      },
      shutdown: lifecycle,
      beginReplacement,
      prepareSupervisor,
    }, internals)

    await expect(host.start('/new/workspace')).rejects.toBe(execFailure)

    expect(order).toEqual(['begin', 'shutdown', 'chdir:/new/workspace', 'execve', 'interrupt:1'])
    expect(lifecycle.shutdown).toHaveBeenCalledWith(1)
    expect(internals.execve).toHaveBeenCalledWith('/runtime/node', [
      '/runtime/node',
      '--import', pathToFileURL('/resolved/tsx/esm/index.mjs').href,
      resolve('/old/workspace/source/bin.ts'),
      '--profile', 'tui',
      '--patch', resolve('/old/workspace/overlay.yml'),
    ], {
      ORIGINAL: 'yes',
      NODE_OPTIONS: `--require ${resolve('/old/workspace/environment-preload.cjs')}`,
    })
    expect(internals.spawn).not.toHaveBeenCalled()
    expect(beginReplacement).toHaveBeenCalledOnce()
    expect(prepareSupervisor).not.toHaveBeenCalled()
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('execve test boundary'))
  })

  it('falls back to one foreground child, preserving runtime flags, TTYs, and exit status', async () => {
    const order: string[] = []
    const child = new FakeChild()
    const internals = boundaries(child, order)
    internals.execArgv = ['--conditions=development']
    const lifecycle = shutdown(order)
    const host = createTuiProcessHandoff({
      profile: 'tui',
      patchFiles: ['./overlay.yml'],
      args: ['--resume', 'old'],
      environment: { SAFE_ORIGINAL: 'yes', OMIT: undefined },
      shutdown: lifecycle,
      beginReplacement: () => { order.push('begin') },
      prepareSupervisor: () => { order.push('supervisor') },
    }, internals)

    void host.handoff(SessionId('next'), '/new/workspace')
    await vi.waitFor(() => { expect(internals.spawn).toHaveBeenCalledOnce() })

    expect(order).toEqual(['begin', 'shutdown', 'supervisor', 'spawn'])
    expect(internals.stat).toHaveBeenCalledWith('/new/workspace')
    expect(lifecycle.shutdown).toHaveBeenCalledWith(1)
    expect(internals.spawn).toHaveBeenCalledWith('/runtime/node', [
      '--conditions=development',
      resolve('/install/dsh.js'),
      '--profile', 'tui',
      '--patch', resolve('/old/workspace/overlay.yml'),
      '--resume', 'next',
    ], {
      cwd: '/new/workspace',
      env: { SAFE_ORIGINAL: 'yes' },
      stdio: 'inherit',
      shell: false,
    })
    child.emit('exit', 7, null)
    expect(lifecycle.interrupt).toHaveBeenCalledWith(7)
  })

  it('starts a fresh workspace without retaining the old resume identity', async () => {
    const order: string[] = []
    const child = new FakeChild()
    const internals = boundaries(child, order)
    const host = createTuiProcessHandoff({
      profile: 'custom-tui',
      patchFiles: [],
      args: ['--resume=old'],
      environment: {},
      shutdown: shutdown(order),
    }, internals)

    void host.start('/workspace/fresh')
    await vi.waitFor(() => { expect(internals.spawn).toHaveBeenCalledOnce() })
    expect(internals.spawn).toHaveBeenCalledWith('/runtime/node', [
      resolve('/install/dsh.js'), '--profile', 'custom-tui',
    ], expect.objectContaining({ cwd: '/workspace/fresh' }))
  })

  it('rejects concurrent handoffs and permits a retry after pre-commit validation fails', async () => {
    const order: string[] = []
    const child = new FakeChild()
    const internals = boundaries(child, order)
    let releaseValidation!: () => void
    internals.stat = vi.fn(() => new Promise<{ isDirectory(): boolean }>((resolve) => {
      releaseValidation = () => { resolve({ isDirectory: () => false }) }
    }))
    const lifecycle = shutdown(order)
    const host = createTuiProcessHandoff({
      profile: 'tui', patchFiles: [], args: [], environment: {}, shutdown: lifecycle,
    }, internals)

    const first = host.start('/not-a-directory')
    await vi.waitFor(() => { expect(internals.stat).toHaveBeenCalledOnce() })
    await expect(host.start('/racing-workspace')).rejects.toThrow('already in progress')
    releaseValidation()
    await expect(first).rejects.toThrow('not a directory')
    expect(lifecycle.shutdown).not.toHaveBeenCalled()

    internals.stat = vi.fn(async () => ({ isDirectory: () => true }))
    void host.start('/valid-workspace')
    await vi.waitFor(() => { expect(internals.spawn).toHaveBeenCalledOnce() })
    await expect(host.start('/late-workspace')).rejects.toThrow('already in progress')
    expect(internals.spawn).toHaveBeenCalledOnce()
  })

  it('turns post-commit disposal and child-start failures into a fatal status', async () => {
    const disposeOrder: string[] = []
    const disposeChild = new FakeChild()
    const disposeInternals = boundaries(disposeChild, disposeOrder)
    const disposeFailure = new Error('dispose failed')
    const disposeLifecycle = shutdown(disposeOrder, disposeFailure)
    const disposeHost = createTuiProcessHandoff({
      profile: 'tui', patchFiles: [], args: [], environment: {}, shutdown: disposeLifecycle,
    }, disposeInternals)
    await expect(disposeHost.start('/workspace')).rejects.toBe(disposeFailure)
    expect(disposeLifecycle.interrupt).toHaveBeenCalledWith(1)
    expect(disposeInternals.spawn).not.toHaveBeenCalled()

    const spawnOrder: string[] = []
    const spawnChild = new FakeChild()
    const spawnInternals = boundaries(spawnChild, spawnOrder)
    const spawnStderr = { write: vi.fn() }
    spawnInternals.stderr = spawnStderr
    const spawnLifecycle = shutdown(spawnOrder)
    const spawnHost = createTuiProcessHandoff({
      profile: 'tui', patchFiles: [], args: [], environment: {}, shutdown: spawnLifecycle,
    }, spawnInternals)
    const pending = spawnHost.start('/workspace')
    await vi.waitFor(() => { expect(spawnInternals.spawn).toHaveBeenCalledOnce() })
    const spawnFailure = new Error('spawn failed')
    spawnChild.emit('error', spawnFailure)
    await expect(pending).rejects.toBe(spawnFailure)
    expect(spawnLifecycle.interrupt).toHaveBeenCalledWith(1)
    expect(spawnStderr.write).toHaveBeenCalledWith(expect.stringContaining('spawn failed'))
  })

  it('maps an unavailable child signal number to failure instead of NaN', async () => {
    const order: string[] = []
    const child = new FakeChild()
    const internals = boundaries(child, order)
    const lifecycle = shutdown(order)
    const host = createTuiProcessHandoff({
      profile: 'tui', patchFiles: [], args: [], environment: {}, shutdown: lifecycle,
    }, internals)

    void host.start('/workspace')
    await vi.waitFor(() => { expect(internals.spawn).toHaveBeenCalledOnce() })
    child.emit('exit', null, 'SIG_NOT_REAL')
    expect(lifecycle.interrupt).toHaveBeenCalledWith(1)
  })
})
