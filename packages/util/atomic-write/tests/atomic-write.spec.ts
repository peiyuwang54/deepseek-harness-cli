import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withFileLock, writeFileAtomic } from '../src/index.ts'

const state = vi.hoisted(() => ({
  afterClaim: undefined as (() => Promise<void>) | undefined,
  claimFailure: undefined as string | undefined,
  failLockCreateWithEPERM: false,
  failLockRemoval: false,
  failClaimRemoval: false,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: (async (...args: Parameters<typeof actual.rm>) => {
      const path = String(args[0])
      if (state.failClaimRemoval && path.includes('.lock.takeover-')) {
        throw Object.assign(new Error('EBUSY: injected claim removal failure'), { code: 'EBUSY' })
      }
      if (state.failLockRemoval && path.endsWith('.lock')) {
        throw Object.assign(new Error('EBUSY: injected lock removal failure'), { code: 'EBUSY' })
      }
      return actual.rm(...args)
    }),
    writeFile: (async (path: unknown, ...rest: never[]) => {
      if (String(path).includes('.lock.takeover-')) {
        if (state.claimFailure !== undefined) {
          throw Object.assign(new Error(`${state.claimFailure}: injected claim failure`), { code: state.claimFailure })
        }
        await (actual.writeFile as (path: unknown, ...args: never[]) => Promise<void>)(path, ...rest)
        await state.afterClaim?.()
        return
      }
      if (state.failLockCreateWithEPERM && String(path).endsWith('.lock')) {
        state.failLockCreateWithEPERM = false
        throw Object.assign(new Error('EPERM: injected exclusive-create failure'), { code: 'EPERM' })
      }
      return (actual.writeFile as (path: unknown, ...args: never[]) => Promise<void>)(path, ...rest)
    }) as typeof actual.writeFile,
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  state.afterClaim = undefined
  state.claimFailure = undefined
  state.failLockCreateWithEPERM = false
  state.failLockRemoval = false
  state.failClaimRemoval = false
})

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-atomic-write-'))
}

const EXITED_PID = 2_000_000_000

function record(pid: number): string {
  return `${String(pid)}\n`
}

function probeExited(pids: readonly number[] = [EXITED_PID], responses = Infinity): void {
  const kill = process.kill.bind(process)
  let remaining = responses
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (!pids.includes(pid)) return kill(pid, signal)
    if (remaining <= 0) return true
    remaining -= 1
    throw Object.assign(new Error('ESRCH: injected'), { code: 'ESRCH' })
  })
}

describe('writeFileAtomic', () => {
  it('creates the file and its parents with exactly the stated mode', async () => {
    const dir = await scratch()
    const target = join(dir, 'nested', 'deep', 'doc.yaml')
    await writeFileAtomic(target, 'a: 1\n', { mode: 0o600, dirMode: 0o700 })
    expect(await readFile(target, 'utf8')).toBe('a: 1\n')
    if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('replaces existing content and narrows a wider-permission file to the stated mode', async () => {
    const dir = await scratch()
    const target = join(dir, 'doc.yaml')
    await writeFile(target, 'old', { mode: 0o644 })
    await writeFileAtomic(target, 'new', { mode: 0o600 })
    expect(await readFile(target, 'utf8')).toBe('new')
    if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('replaces a symlinked target itself without writing through to the referent', async () => {
    const dir = await scratch()
    const victim = join(dir, 'victim')
    await writeFile(victim, 'victim-content')
    const target = join(dir, 'doc.yaml')
    await symlink(victim, target)
    await writeFileAtomic(target, 'replaced', { mode: 0o600 })
    expect((await lstat(target)).isSymbolicLink()).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('replaced')
    expect(await readFile(victim, 'utf8')).toBe('victim-content')
  })

  it('leaves no temp sibling and rethrows when the rename fails', async () => {
    const dir = await scratch()
    const target = join(dir, 'occupied')
    await mkdir(target)
    await expect(writeFileAtomic(target, 'content', { mode: 0o600 })).rejects.toThrow()
    expect((await readdir(dir)).filter(entry => entry.includes('.tmp'))).toEqual([])
  })
})

describe('withFileLock', () => {
  it('retries EPERM only when the lock path currently exists', async () => {
    const dir = await scratch()
    const target = join(dir, 'document')
    const lockPath = `${target}.lock`
    await writeFile(lockPath, 'holder\n')
    const release = setTimeout(() => { void rm(lockPath, { force: true }) }, 50)
    state.failLockCreateWithEPERM = true
    let called = false

    try {
      await withFileLock(target, async () => { called = true })
    } finally {
      clearTimeout(release)
    }
    expect(called).toBe(true)
  })

  it('preserves EPERM when no lock path exists', async () => {
    const dir = await scratch()
    const operation = vi.fn(async () => {})
    state.failLockCreateWithEPERM = true

    await expect(withFileLock(join(dir, 'document'), operation)).rejects.toMatchObject({ code: 'EPERM' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('rejects an invalid parent hierarchy before running the operation', async () => {
    const dir = await scratch()
    const parent = join(dir, 'not-a-directory')
    await writeFile(parent, 'occupied')
    let called = false

    await expect(withFileLock(join(parent, 'document'), async () => {
      called = true
    })).rejects.toThrow(/ENOENT|ENOTDIR|not a directory/i)
    expect(called).toBe(false)
  })

  it('takes over a lock whose holder exited', async () => {
    probeExited()
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))

    await expect(withFileLock(target, async () => readFile(`${target}.lock`, 'utf8'), { waitMs: 0 }))
      .resolves.toBe(record(process.pid))
  })

  it.skipIf(process.platform === 'win32')('takes over the lock of a process that really exited', async () => {
    const dir = await scratch()
    const target = join(dir, 'document')
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await once(child, 'exit')
    await writeFile(`${target}.lock`, record(child.pid as number))

    await expect(withFileLock(target, async () => 'acquired', { waitMs: 0 })).resolves.toBe('acquired')
  })

  it('serializes contenders taking over the same exited holder', async () => {
    probeExited()
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))
    let active = 0
    let overlapped = false

    await Promise.all(Array.from({ length: 8 }, () => withFileLock(target, async () => {
      active += 1
      overlapped ||= active > 1
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
    }, { waitMs: 2_000 })))

    expect(overlapped).toBe(false)
  })

  it.each([
    ['a live holder', record(process.ppid)],
    ['this process', record(process.pid)],
    ['an empty record', ''],
    ['an incomplete record', '12'],
    ['a non-PID record', 'holder\n'],
    ['a process group', record(0)],
    ['a PID beyond int32', '2147483648\n'],
    ['a PID beyond safe integers', '99999999999999999999\n'],
  ])('waits for %s', async (_label, held) => {
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, held)
    const operation = vi.fn(async () => {})

    await expect(withFileLock(target, operation, { waitMs: 25 })).rejects.toThrow(/timed out waiting/u)
    expect(operation).not.toHaveBeenCalled()
    expect(await readFile(`${target}.lock`, 'utf8')).toBe(held)
  })

  it('waits when the holder exists under another user', async () => {
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))
    const kill = process.kill.bind(process)
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === EXITED_PID) throw Object.assign(new Error('EPERM: injected'), { code: 'EPERM' })
      return kill(pid, signal)
    })

    await expect(withFileLock(target, async () => {}, { waitMs: 25 })).rejects.toThrow(/timed out waiting/u)
  })

  it('waits for a lock it cannot read', async () => {
    const dir = await scratch()
    const target = join(dir, 'document')
    await mkdir(`${target}.lock`)

    await expect(withFileLock(target, async () => {}, { waitMs: 25 })).rejects.toThrow(/timed out waiting/u)
  })

  it('leaves an exited lock to the contender holding its claim', async () => {
    probeExited()
    const dir = await scratch()
    const target = join(dir, 'document')
    const held = record(EXITED_PID)
    await writeFile(`${target}.lock`, held)
    const claim = `${target}.lock.takeover-${createHash('sha256').update(held).digest('hex').slice(0, 16)}`
    await writeFile(claim, 'claimed\n')

    await expect(withFileLock(target, async () => {}, { waitMs: 25 })).rejects.toThrow(/timed out waiting/u)
    expect(await readFile(`${target}.lock`, 'utf8')).toBe(held)
  })

  it('treats an EPERM claim refusal as contention', async () => {
    probeExited()
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))
    state.claimFailure = 'EPERM'

    await expect(withFileLock(target, async () => {}, { waitMs: 25 })).rejects.toThrow(/timed out waiting/u)
  })

  it('surfaces a non-contention claim failure', async () => {
    probeExited()
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))
    state.claimFailure = 'EIO'

    await expect(withFileLock(target, async () => {})).rejects.toMatchObject({ code: 'EIO' })
  })

  it('keeps a lock replaced after the exited holder was claimed', async () => {
    probeExited()
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))
    state.afterClaim = async () => {
      state.afterClaim = undefined
      await rm(`${target}.lock`)
      await writeFile(`${target}.lock`, record(process.pid))
    }

    await expect(withFileLock(target, async () => {}, { waitMs: 25 })).rejects.toThrow(/timed out waiting/u)
    expect(await readFile(`${target}.lock`, 'utf8')).toBe(record(process.pid))
  })

  it('keeps a lock when the exited PID becomes live after the claim', async () => {
    probeExited([EXITED_PID], 1)
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))

    await expect(withFileLock(target, async () => {}, { waitMs: 25 })).rejects.toThrow(/timed out waiting/u)
    expect(await readFile(`${target}.lock`, 'utf8')).toBe(record(EXITED_PID))
  })

  it('waits when the exited holder lock cannot be removed', async () => {
    probeExited()
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))
    state.failLockRemoval = true

    await expect(withFileLock(target, async () => {}, { waitMs: 25 })).rejects.toThrow(/timed out waiting/u)
  })

  it('does not fail takeover when the obsolete claim cannot be removed', async () => {
    probeExited()
    const dir = await scratch()
    const target = join(dir, 'document')
    await writeFile(`${target}.lock`, record(EXITED_PID))
    state.failClaimRemoval = true

    await expect(withFileLock(target, async () => 'acquired', { waitMs: 0 })).resolves.toBe('acquired')
    expect((await readdir(dir)).some(entry => entry.includes('.lock.takeover-'))).toBe(true)
  })
})
