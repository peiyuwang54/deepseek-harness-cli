/** Local setup import from compatible coding-agent directories. */

import { constants } from 'node:fs'
import { copyFile, cp, lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Coding-agent setup understood by the local importer. */
export type ExternalImportSource = 'claude' | 'codex'

/** Importable setup category exposed by `/import`. */
type ExternalImportKind =
  | 'user-skills'
  | 'project-skills'
  | 'user-instructions'
  | 'project-instructions'

interface ExternalImportTransfer {
  readonly sourcePath: string
  readonly destinationPath: string
  readonly directory: boolean
}

/** One independently selectable import batch. */
export interface ExternalImportCandidate {
  /** Stable source/category identifier used by the selector. */
  readonly id: string
  /** External coding agent that owns the source files. */
  readonly source: ExternalImportSource
  /** Setup category copied by this batch. */
  readonly kind: ExternalImportKind
  /** Short selector label. */
  readonly label: string
  /** Source count and destination summary. */
  readonly description: string
  /** Exact non-overwriting file copies in this batch. */
  readonly transfers: readonly ExternalImportTransfer[]
}

/** Filesystem locations used by import detection. */
export interface ExternalImportOptions {
  /** Source product to inspect. */
  readonly source: ExternalImportSource
  /** Active session directory used to find the nearest Git project root. */
  readonly cwd: string
  /** OS home override for tests or embeddings. */
  readonly home?: string
  /** Harness home override; defaults through the shared `$DSH_HOME` resolver. */
  readonly dshHome?: string
  /** Cancellation for filesystem detection. */
  readonly signal?: AbortSignal
}

/** Outcome of copying selected setup without overwriting existing files. */
export interface ExternalImportResult {
  /** Files or skill bundles copied successfully. */
  readonly imported: number
  /** Destinations that appeared after detection and were retained. */
  readonly skipped: number
  /** Source entries that could not be copied. */
  readonly failures: readonly string[]
}

/** Embedding boundary for external setup detection and copying. */
export interface ExternalImportGateway {
  /** Detect selectable batches for one external product. */
  detect(options: ExternalImportOptions): Promise<ExternalImportCandidate[]>
  /** Copy selected batches without overwriting existing destinations. */
  execute(candidates: readonly ExternalImportCandidate[], signal: AbortSignal): Promise<ExternalImportResult>
}

/** Production local-filesystem implementation of the setup import boundary. */
export const localExternalImportGateway: ExternalImportGateway = {
  detect: detectExternalImports,
  execute: importExternalSetup,
}

/** Parsed direct-import request; no `kind` means open the item selector. */
export interface ExternalImportRequest {
  /** Source selected explicitly by the user. */
  readonly source?: ExternalImportSource
  /** Category selected for immediate import. */
  readonly kind?: 'all' | 'skills' | 'instructions'
}

/** Convert a supported source id to its product label. */
export function externalImportSourceLabel(source: ExternalImportSource): string {
  return source === 'claude' ? 'Claude Code' : 'Codex'
}

/** Parse `/import [claude|codex] [all|skills|instructions]`. */
export function parseExternalImportRequest(rawInput: string): ExternalImportRequest | string {
  const words = rawInput.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  if (words.length === 0) return {}
  const source = words.shift()
  if (source !== 'claude' && source !== 'codex') {
    return 'Usage: /import [claude|codex] [all|skills|instructions]'
  }
  const kind = words.shift()
  if (kind === undefined) return { source }
  if (kind !== 'all' && kind !== 'skills' && kind !== 'instructions') {
    return 'Usage: /import [claude|codex] [all|skills|instructions]'
  }
  if (words.length > 0) return 'Usage: /import [claude|codex] [all|skills|instructions]'
  return { source, kind }
}

/** Whether a candidate belongs to one direct-import category. */
export function externalImportMatches(
  candidate: ExternalImportCandidate,
  kind: NonNullable<ExternalImportRequest['kind']>,
): boolean {
  if (kind === 'all') return true
  return kind === 'skills' ? candidate.kind.endsWith('-skills') : candidate.kind.endsWith('-instructions')
}

async function pathType(path: string): Promise<'file' | 'directory' | 'other' | 'missing'> {
  try {
    const metadata = await lstat(path)
    if (metadata.isFile()) return 'file'
    if (metadata.isDirectory()) return 'directory'
    return 'other'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

async function findProjectRoot(cwd: string, signal: AbortSignal | undefined): Promise<string> {
  let current = resolve(cwd)
  while (true) {
    signal?.throwIfAborted()
    if (await pathType(join(current, '.git')) !== 'missing') return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

async function compatibleSkillTransfers(
  sourceRoot: string,
  destinationRoot: string,
  signal: AbortSignal | undefined,
): Promise<ExternalImportTransfer[]> {
  let entries
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const transfers: ExternalImportTransfer[] = []
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    signal?.throwIfAborted()
    const sourcePath = join(sourceRoot, entry.name)
    const destinationPath = join(destinationRoot, entry.name)
    if (await pathType(destinationPath) !== 'missing') continue
    if (entry.isFile() && entry.name.endsWith('.md')) {
      transfers.push({ sourcePath, destinationPath, directory: false })
      continue
    }
    if (!entry.isDirectory()) continue
    if (await pathType(join(sourcePath, 'SKILL.md')) !== 'file') continue
    transfers.push({ sourcePath, destinationPath, directory: true })
  }
  return transfers
}

async function instructionTransfer(
  sourcePath: string,
  destinationPath: string,
): Promise<ExternalImportTransfer[]> {
  if (await pathType(sourcePath) !== 'file' || await pathType(destinationPath) !== 'missing') return []
  return [{ sourcePath, destinationPath, directory: false }]
}

function candidate(
  source: ExternalImportSource,
  kind: ExternalImportKind,
  label: string,
  destination: string,
  transfers: readonly ExternalImportTransfer[],
): ExternalImportCandidate | undefined {
  if (transfers.length === 0) return undefined
  const noun = transfers.length === 1 ? 'item' : 'items'
  return {
    id: `${source}:${kind}`,
    source,
    kind,
    label,
    description: `${String(transfers.length)} ${noun} → ${destination}`,
    transfers,
  }
}

/**
 * Detect compatible external skills and instruction files whose destinations do not exist.
 * Project-root `CLAUDE.md` already works natively and is therefore not offered for copying.
 * @param options - Source and filesystem roots to inspect.
 * @returns Independently selectable, non-empty import batches.
 */
export async function detectExternalImports(options: ExternalImportOptions): Promise<ExternalImportCandidate[]> {
  const { source, signal } = options
  const home = resolve(options.home ?? homedir())
  const dshHome = resolveDshHome(options.dshHome)
  const projectRoot = await findProjectRoot(options.cwd, signal)
  const sourceDirectory = source === 'claude' ? '.claude' : '.codex'
  const sourceInstruction = source === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'
  const userSkillDestination = join(home, '.agents', 'skills')
  const projectSkillDestination = join(projectRoot, '.agents', 'skills')
  const candidates = [
    candidate(
      source,
      'user-skills',
      'User skills',
      userSkillDestination,
      await compatibleSkillTransfers(join(home, sourceDirectory, 'skills'), userSkillDestination, signal),
    ),
    candidate(
      source,
      'project-skills',
      'Project skills',
      projectSkillDestination,
      await compatibleSkillTransfers(join(projectRoot, sourceDirectory, 'skills'), projectSkillDestination, signal),
    ),
    candidate(
      source,
      'user-instructions',
      'User instructions',
      join(dshHome, 'AGENTS.md'),
      await instructionTransfer(join(home, sourceDirectory, sourceInstruction), join(dshHome, 'AGENTS.md')),
    ),
    candidate(
      source,
      'project-instructions',
      'Project instructions',
      join(projectRoot, 'AGENTS.md'),
      await instructionTransfer(
        join(projectRoot, sourceDirectory, sourceInstruction),
        join(projectRoot, 'AGENTS.md'),
      ),
    ),
  ]
  signal?.throwIfAborted()
  return candidates.filter((value): value is ExternalImportCandidate => value !== undefined)
}

async function validatePortableTree(path: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const type = await pathType(path)
  if (type === 'file') return
  if (type !== 'directory') throw new Error(`unsupported filesystem entry: ${basename(path)}`)
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isDirectory()) {
      throw new Error(`symbolic links and special files are not imported: ${entry.name}`)
    }
    await validatePortableTree(join(path, entry.name), signal)
  }
}

async function copyTransfer(transfer: ExternalImportTransfer, signal: AbortSignal): Promise<'imported' | 'skipped'> {
  signal.throwIfAborted()
  await validatePortableTree(transfer.sourcePath, signal)
  await mkdir(dirname(transfer.destinationPath), { recursive: true })
  if (!transfer.directory) {
    try {
      await copyFile(transfer.sourcePath, transfer.destinationPath, constants.COPYFILE_EXCL)
      return 'imported'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'skipped'
      throw error
    }
  }
  try {
    await cp(transfer.sourcePath, transfer.destinationPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    })
    return 'imported'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'skipped'
    await rm(transfer.destinationPath, { recursive: true, force: true })
    throw error
  }
}

/**
 * Copy selected batches while retaining every destination that already exists.
 * @param candidates - Batches chosen from the latest detection result.
 * @param signal - Cancellation for validation and copies.
 * @returns Imported, skipped, and failed transfer counts.
 */
export async function importExternalSetup(
  candidates: readonly ExternalImportCandidate[],
  signal: AbortSignal = new AbortController().signal,
): Promise<ExternalImportResult> {
  let imported = 0
  let skipped = 0
  const failures: string[] = []
  for (const selected of candidates) {
    for (const transfer of selected.transfers) {
      try {
        const outcome = await copyTransfer(transfer, signal)
        if (outcome === 'imported') imported += 1
        else skipped += 1
      } catch (error) {
        if (signal.aborted) throw error
        failures.push(`${basename(transfer.sourcePath)}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return { imported, skipped, failures }
}

/** Render one transcript summary for an external setup import. */
export function formatExternalImportResult(source: ExternalImportSource, result: ExternalImportResult): string {
  const lines = [
    `${externalImportSourceLabel(source)} import complete · ${String(result.imported)} imported · ${String(result.skipped)} retained`,
    ...result.failures.map(failure => `- Failed: ${failure}`),
    'Imported setup applies to new chats; current project CLAUDE.md files already work without importing.',
  ]
  return lines.join('\n')
}
