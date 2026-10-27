/** Exercises the shipped shim without a release executable or npm registry. */
import { EventEmitter, once } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const shimSource = readFileSync(resolve(import.meta.dirname, 'dsh-npm-shim.js'), 'utf8')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('npm shim lifecycle', () => {
  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'])('restores default %s handling before terminating itself', (signal) => {
    // Model POSIX delivery on every host; Windows process.kill does not run signal listeners.
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    const shimProcess = processFixture()
    shimProcess.kill.mockImplementation((_pid: number, received: string) => {
      expect(shimProcess.listenerCount(received)).toBe(0)
    })
    loadShim(child, shimProcess)
    shimProcess.emit(signal)
    expect(child.kill).toHaveBeenCalledWith(signal)
    child.emit('exit', null, signal)
    expect(shimProcess.kill).toHaveBeenCalledWith(123, signal)
  })

  it('reports asynchronous spawn errors and exits with code 1', () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    const shimProcess = processFixture()
    const logger = { error: vi.fn() }
    loadShim(child, shimProcess, logger)
    child.emit('error', new Error('permission denied'))
    expect(logger.error).toHaveBeenCalledWith('deepseek-harness-cli: failed to start /fake/executable: permission denied')
    expect(shimProcess.exit).toHaveBeenCalledWith(1)
  })

  it.each([0, 7])('passes arguments, stdio, and child exit code %i through the installed entry', (code) => {
    const { entry } = fixture()
    const result = spawnSync(process.execPath, [entry, '-e', `console.log(process.argv[1]); process.exit(${code})`, 'two words'], {
      encoding: 'utf8', timeout: 10_000,
    })
    expect(result.status).toBe(code)
    expect(result.stdout.trim()).toBe('two words')
    expect(result.stderr).toBe('')
  }, 15_000)

  it('reports spawn failures in one line and exits unsuccessfully', () => {
    const { entry, executable } = fixture(false)
    writeFileSync(executable, 'invalid executable', { mode: 0o644 })
    const result = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 10_000 })
    expect(result.status).toBe(1)
    expect(result.stderr.trim()).toMatch(/^deepseek-harness-cli: failed to start .+: .+$/)
    expect(result.stderr.trim().split(/\r?\n/)).toHaveLength(1)
  })

  it.skipIf(process.platform === 'win32')('terminates with the child signal on POSIX', async () => {
    const { entry } = fixture()
    const child = spawn(process.execPath, [entry, '-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      await once(child.stdout, 'data')
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      expect(await exited).toEqual([null, 'SIGTERM'])
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await exited
      }
    }
  }, 10_000)
})

function processFixture() {
  return Object.assign(new EventEmitter(), {
    platform: 'linux', arch: 'x64', argv: ['node', 'shim'], pid: 123,
    exit: vi.fn(), kill: vi.fn<(_pid: number, received: string) => void>(),
  })
}

function loadShim(child: EventEmitter, shimProcess: object, logger: Pick<Console, 'error'> = console): void {
  const executableSource = shimSource
    .replace(/^#!.*\n/, '')
    .replace(/^import .*\n/gm, '')
    .replace('import.meta.url', JSON.stringify('file:///shim.js'))
  runInNewContext(executableSource, {
    process: shimProcess,
    console: logger,
    spawn: () => child,
    createRequire: () => ({ resolve: () => '/fake/executable' }),
  })
}

function fixture(withExecutable = true): { entry: string; executable: string } {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-shim-'))
  temporaryDirectories.push(directory)
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}')
  const entry = join(directory, 'shim.js')
  copyFileSync(resolve(import.meta.dirname, 'dsh-npm-shim.js'), entry)
  const os = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'win' : 'linux'
  const bin = join(directory, 'node_modules', '@peiyu_wang', `deepseek-harness-cli-${os}-${process.arch}`, 'bin')
  mkdirSync(bin, { recursive: true })
  const executable = join(bin, process.platform === 'win32' ? 'deepseek-harness-cli.exe' : 'deepseek-harness-cli')
  if (withExecutable) copyFileSync(process.execPath, executable)
  return { entry, executable }
}
