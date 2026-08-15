import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activeAtToken,
  formatFileMention,
  WorkspaceFileSearch,
} from '../src/chat/file-autocomplete.ts'

const searches: WorkspaceFileSearch[] = []
const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-autocomplete-'))
  roots.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, '.hidden'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'ignored-package'), { recursive: true })
  await writeFile(join(root, 'README.md'), 'readme')
  await writeFile(join(root, 'src', 'tui.spec.ts'), 'test')
  await writeFile(join(root, 'src', 'terminal-view.ts'), 'view')
  await writeFile(join(root, 'docs', 'design notes.md'), 'design')
  await writeFile(join(root, '.hidden', 'secret.txt'), 'hidden')
  await writeFile(join(root, 'node_modules', 'ignored-package', 'index.js'), 'ignored')
  try {
    await symlink(join(root, 'src', 'tui.spec.ts'), join(root, 'linked-test.ts'))
  } catch {
    // Windows may deny symlink creation without Developer Mode; the product
    // still skips every non-file/non-directory Dirent on platforms that expose one.
  }
  return root
}

function search(root: string, overrides: Partial<ConstructorParameters<typeof WorkspaceFileSearch>[1]> = {}): WorkspaceFileSearch {
  const instance = new WorkspaceFileSearch(root, {
    maxResults: overrides.maxResults ?? 20,
    maxEntries: overrides.maxEntries ?? 10_000,
    excludedDirectories: overrides.excludedDirectories ?? ['.git', 'node_modules'],
    respectIgnoreFiles: overrides.respectIgnoreFiles ?? true,
  })
  searches.push(instance)
  return instance
}

afterEach(async () => {
  for (const instance of searches.splice(0)) instance.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('TUI file autocomplete grammar', () => {
  it('recognizes boundary and quoted mentions without treating emails as references', () => {
    expect(activeAtToken('@src/tu', 7)).toEqual({ prefix: '@src/tu', query: 'src/tu', quoted: false })
    expect(activeAtToken('read @"docs/design n', 20)).toEqual({
      prefix: '@"docs/design n',
      query: 'docs/design n',
      quoted: true,
    })
    expect(activeAtToken('mail a@b.test', 13)).toBeUndefined()
    expect(activeAtToken('done @src/x" next', 17)).toBeUndefined()
  })

  it('formats files, directories, quotes, and rejects unsafe editor values', () => {
    expect(formatFileMention({ path: 'src/index.ts', kind: 'file' }, false)).toBe('@src/index.ts')
    expect(formatFileMention({ path: 'src', kind: 'directory' }, false)).toBe('@src/')
    expect(formatFileMention({ path: 'docs/design notes.md', kind: 'file' }, false))
      .toBe('@"docs/design notes.md"')
    expect(formatFileMention({ path: 'README.md', kind: 'file' }, true)).toBe('@"README.md"')
    expect(formatFileMention({ path: 'bad\nname', kind: 'file' }, false)).toBeUndefined()
    expect(formatFileMention({ path: 'bad "name".md', kind: 'file' }, false)).toBeUndefined()
    expect(formatFileMention({ path: 'bad"name.md', kind: 'file' }, false)).toBeUndefined()
  })
})

describe('WorkspaceFileSearch', () => {
  it('lists live directory levels, descends, quotes spaces, and filters hidden/excluded entries', async () => {
    const root = await workspace()
    const files = search(root)
    const signal = new AbortController().signal

    expect(await files.list('', signal)).toEqual([
      { path: 'docs', kind: 'directory' },
      { path: 'src', kind: 'directory' },
      { path: 'README.md', kind: 'file' },
    ])
    expect(await files.list('src/', signal)).toEqual([
      { path: 'src/terminal-view.ts', kind: 'file' },
      { path: 'src/tui.spec.ts', kind: 'file' },
    ])
    expect(await files.list('src/ts', signal)).toEqual([
      { path: 'src/tui.spec.ts', kind: 'file' },
      { path: 'src/terminal-view.ts', kind: 'file' },
    ])
    expect(await files.list('docs/design n', signal)).toEqual([
      { path: 'docs/design notes.md', kind: 'file' },
    ])
    expect(await files.list('node_modules/', signal)).toEqual([])
    expect(await files.list('.hidden/', signal)).toEqual([
      { path: '.hidden/secret.txt', kind: 'file' },
    ])
    const absoluteSrc = `${join(root, 'src').replaceAll('\\', '/')}/`
    expect(await files.list(`${absoluteSrc}tui`, signal)).toEqual([
      { path: `${absoluteSrc}tui.spec.ts`, kind: 'file' },
      { path: `${absoluteSrc}terminal-view.ts`, kind: 'file' },
    ])
    expect(await files.list('~/.dsh-file-autocomplete-missing/', signal)).toEqual([])
    expect(await files.list('../', signal)).toEqual([])
    expect(await files.list('README.md/', signal)).toEqual([])
  })

  it('does not traverse directory symlinks during direct completion', async () => {
    const root = await workspace()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-file-autocomplete-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'outside-secret.txt'), 'secret')
    await symlink(
      outside,
      join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const files = search(root)
    const signal = new AbortController().signal

    expect(await files.list('escape/', signal)).toEqual([])
    expect(await files.list('escape/outside', signal)).toEqual([])
  })

  it('ranks basename and subsequence fuzzy matches across the bounded workspace index', async () => {
    const root = await workspace()
    await writeFile(join(root, 'src', 'tspc-helper.ts'), 'helper')
    const files = search(root, { maxResults: 2 })
    const signal = new AbortController().signal

    expect(await files.list('tspc', signal)).toEqual([
      { path: 'src/tspc-helper.ts', kind: 'file' },
      { path: 'src/tui.spec.ts', kind: 'file' },
    ])
    expect(await files.list('README.md', signal)).toEqual([
      { path: 'README.md', kind: 'file' },
    ])
    expect(await files.list('terminal', signal)).toEqual([
      { path: 'src/terminal-view.ts', kind: 'file' },
    ])
    expect(await files.list('secret', signal)).toEqual([])
    expect(await files.list('.hidden', signal)).toEqual([
      { path: '.hidden', kind: 'directory' },
      { path: '.hidden/secret.txt', kind: 'file' },
    ])
  })

  it('applies repository, nested, generic, and negated ignore rules to direct and fuzzy results', async () => {
    const root = await workspace()
    await mkdir(join(root, '.git', 'info'), { recursive: true })
    await mkdir(join(root, 'generated'), { recursive: true })
    await writeFile(join(root, '.git', 'info', 'exclude'), 'excluded-by-repo.txt\n')
    await writeFile(join(root, '.gitignore'), 'generated/\n*.log\n!keep.log\n')
    await writeFile(join(root, '.ignore'), 'docs/private.txt\n')
    await writeFile(join(root, 'src', '.gitignore'), 'generated.ts\n')
    await writeFile(join(root, 'generated', 'output.ts'), 'generated')
    await writeFile(join(root, 'drop.log'), 'drop')
    await writeFile(join(root, 'keep.log'), 'keep')
    await writeFile(join(root, 'excluded-by-repo.txt'), 'excluded')
    await writeFile(join(root, 'docs', 'private.txt'), 'private')
    await writeFile(join(root, 'src', 'generated.ts'), 'generated')
    const files = search(root)
    const signal = new AbortController().signal

    expect(await files.list('', signal)).toEqual([
      { path: 'docs', kind: 'directory' },
      { path: 'src', kind: 'directory' },
      { path: 'README.md', kind: 'file' },
      { path: 'keep.log', kind: 'file' },
    ])
    expect(await files.list('src/', signal)).toEqual([
      { path: 'src/terminal-view.ts', kind: 'file' },
      { path: 'src/tui.spec.ts', kind: 'file' },
    ])
    expect(await files.list('generated/', signal)).toEqual([])
    expect(await files.list('private', signal)).toEqual([])
    expect(await files.list('generated', signal)).toEqual([])
    expect(await files.list('keep.log', signal)).toEqual([
      { path: 'keep.log', kind: 'file' },
    ])
  })

  it('can expose ignored paths and reloads ignore files after invalidation', async () => {
    const root = await workspace()
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, '.gitignore'), 'fresh-file.ts\n')
    await writeFile(join(root, 'fresh-file.ts'), 'fresh')
    const signal = new AbortController().signal
    const respected = search(root)
    const unfiltered = search(root, { respectIgnoreFiles: false })

    expect(await respected.list('fresh-file', signal)).toEqual([])
    expect(await unfiltered.list('fresh-file', signal)).toEqual([
      { path: 'fresh-file.ts', kind: 'file' },
    ])
    await writeFile(join(root, '.gitignore'), '')
    expect(await respected.list('fresh-file', signal)).toEqual([])
    respected.invalidate()
    expect(await respected.list('fresh-file', signal)).toEqual([
      { path: 'fresh-file.ts', kind: 'file' },
    ])
  })

  it('inherits parent repository rules and follows worktree git-directory pointers', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-file-autocomplete-repository-'))
    roots.push(repository)
    const root = join(repository, 'packages', 'app')
    const gitDirectory = await mkdtemp(join(tmpdir(), 'dsh-file-autocomplete-gitdir-'))
    roots.push(gitDirectory)
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(gitDirectory, 'info'), { recursive: true })
    await writeFile(join(repository, '.git'), `gitdir: ${gitDirectory}\n`)
    await writeFile(join(repository, '.gitignore'), 'packages/app/from-parent.ts\n')
    await writeFile(join(gitDirectory, 'info', 'exclude'), 'packages/app/from-exclude.ts\n')
    await writeFile(join(root, 'from-parent.ts'), 'parent')
    await writeFile(join(root, 'from-exclude.ts'), 'exclude')
    await writeFile(join(root, 'visible.ts'), 'visible')
    const files = search(root)
    const signal = new AbortController().signal

    expect(await files.list('from-', signal)).toEqual([])
    expect(await files.list('visible', signal)).toEqual([
      { path: 'visible.ts', kind: 'file' },
    ])

    await writeFile(join(repository, '.git'), 'not-a-git-directory-pointer\n')
    files.invalidate()
    expect(await files.list('from-exclude', signal)).toEqual([
      { path: 'from-exclude.ts', kind: 'file' },
    ])
  })

  it('invalidates cached traversal, enforces the entry cap, and settles disposal', async () => {
    const root = await workspace()
    const capped = search(root, { maxEntries: 2 })
    const signal = new AbortController().signal
    expect(await capped.list('README', signal)).toEqual([
      { path: 'README.md', kind: 'file' },
    ])

    const files = search(root)
    expect(await files.list('fresh-file', signal)).toEqual([])
    await writeFile(join(root, 'fresh-file.ts'), 'fresh')
    expect(await files.list('fresh-file', signal)).toEqual([])
    files.invalidate()
    expect(await files.list('fresh-file', signal)).toEqual([
      { path: 'fresh-file.ts', kind: 'file' },
    ])
    files.dispose()
    expect(await files.list('fresh-file', signal)).toEqual([])
    files.dispose()
  })

  it('cancels individual callers, skips missing directories, and validates limits', async () => {
    const root = await workspace()
    expect(() => search(root, { maxResults: 0 })).toThrow('maxResults')
    expect(() => search(root, { maxEntries: 1.5 })).toThrow('maxEntries')
    expect(() => search(root, { excludedDirectories: ['nested/name'] })).toThrow('basenames')

    const files = search(root)
    expect(await files.list('missing/', new AbortController().signal)).toEqual([])

    const preAborted = new AbortController()
    preAborted.abort(new Error('pre-aborted'))
    await expect(files.list('tui', preAborted.signal)).rejects.toThrow('pre-aborted')

    files.invalidate()
    const running = new AbortController()
    const pending = files.list('tui', running.signal)
    running.abort(new Error('superseded'))
    await expect(pending).rejects.toThrow('superseded')

    files.invalidate()
    const nonErrorAbort = new AbortController()
    const nonErrorPending = files.list('tui', nonErrorAbort.signal)
    nonErrorAbort.abort('cancelled')
    await expect(nonErrorPending).rejects.toThrow('file search aborted')
  })
})
