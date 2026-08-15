import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  detectExternalImports,
  externalImportMatches,
  formatExternalImportResult,
  importExternalSetup,
  parseExternalImportRequest,
} from '../src/chat/external-import.ts'

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-external-import-'))
  temporaryRoots.push(root)
  return root
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('/import local setup', () => {
  it('detects compatible Claude setup by user and project scope and copies every selected batch', async () => {
    const root = await temporaryRoot()
    const home = join(root, 'home')
    const dshHome = join(root, 'dsh-home')
    const project = join(root, 'project')
    const cwd = join(project, 'packages', 'app')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(cwd, { recursive: true })
    await write(join(home, '.claude', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review changes\n---\nReview.')
    await write(join(home, '.claude', 'skills', 'format.md'), '---\nname: format\ndescription: Format files\n---\nFormat.')
    await write(join(project, '.claude', 'skills', 'test', 'SKILL.md'), '---\nname: test\ndescription: Test changes\n---\nTest.')
    await write(join(home, '.claude', 'CLAUDE.md'), 'global instructions')
    await write(join(project, '.claude', 'CLAUDE.md'), 'project instructions')
    await write(join(project, 'CLAUDE.md'), 'already read natively')

    const candidates = await detectExternalImports({ source: 'claude', cwd, home, dshHome })
    expect(candidates.map(item => [item.kind, item.transfers.length])).toEqual([
      ['user-skills', 2],
      ['project-skills', 1],
      ['user-instructions', 1],
      ['project-instructions', 1],
    ])

    const result = await importExternalSetup(candidates)
    expect(result).toEqual({ imported: 5, skipped: 0, failures: [] })
    await expect(readFile(join(home, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8')).resolves.toContain('Review changes')
    await expect(readFile(join(home, '.agents', 'skills', 'format.md'), 'utf8')).resolves.toContain('Format files')
    await expect(readFile(join(project, '.agents', 'skills', 'test', 'SKILL.md'), 'utf8')).resolves.toContain('Test changes')
    await expect(readFile(join(dshHome, 'AGENTS.md'), 'utf8')).resolves.toBe('global instructions')
    await expect(readFile(join(project, 'AGENTS.md'), 'utf8')).resolves.toBe('project instructions')
    await expect(readFile(join(project, 'CLAUDE.md'), 'utf8')).resolves.toBe('already read natively')
  })

  it('retains a destination created after detection and reports the race as skipped', async () => {
    const root = await temporaryRoot()
    const home = join(root, 'home')
    const dshHome = join(root, 'dsh-home')
    const project = join(root, 'project')
    await mkdir(join(project, '.git'), { recursive: true })
    await write(join(home, '.codex', 'skills', 'review.md'), 'source')
    const candidates = await detectExternalImports({ source: 'codex', cwd: project, home, dshHome })
    await write(join(home, '.agents', 'skills', 'review.md'), 'keep me')

    const result = await importExternalSetup(candidates)
    expect(result).toEqual({ imported: 0, skipped: 1, failures: [] })
    await expect(readFile(join(home, '.agents', 'skills', 'review.md'), 'utf8')).resolves.toBe('keep me')
  })

  it('parses direct source/category requests and formats a bounded result', () => {
    expect(parseExternalImportRequest('')).toEqual({})
    expect(parseExternalImportRequest('CLAUDE skills')).toEqual({ source: 'claude', kind: 'skills' })
    expect(parseExternalImportRequest('codex all extra')).toBe('Usage: /import [claude|codex] [all|skills|instructions]')
    expect(externalImportMatches({
      id: 'claude:user-skills',
      source: 'claude',
      kind: 'user-skills',
      label: 'User skills',
      description: '1 item',
      transfers: [],
    }, 'skills')).toBe(true)
    expect(formatExternalImportResult('claude', {
      imported: 2,
      skipped: 1,
      failures: ['broken: unreadable'],
    })).toBe([
      'Claude Code import complete · 2 imported · 1 retained',
      '- Failed: broken: unreadable',
      'Imported setup applies to new chats; current project CLAUDE.md files already work without importing.',
    ].join('\n'))
  })
})
