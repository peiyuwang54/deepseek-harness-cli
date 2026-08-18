/** Local-image draft admission for the terminal composer. */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AttachmentError,
  type AttachmentStore,
  type ImageAttachmentRef,
  type ImageMediaType,
  type SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/** In-memory bytes before send, or the durable reference retained for local history replay. */
export type TuiImageDraft = {
  readonly id: number
  readonly placeholder: string
  readonly input: SaveImageAttachment
  readonly attachment?: never
} | {
  readonly id: number
  readonly placeholder: string
  readonly input?: never
  readonly attachment: ImageAttachmentRef
}

/** A pasted path resolved against the immutable session working directory. */
export interface PastedImagePath {
  readonly path: string
  readonly mediaType: ImageMediaType
}

/**
 * Resolve one pasted PNG/JPEG/WebP/GIF path without touching the filesystem.
 * @param pasted - Complete bracketed-paste text.
 * @param cwd - Session working directory used for relative paths.
 * @param platform - Host path rules; exposed for cross-platform tests.
 * @returns normalized path and declared media type, or `undefined` for ordinary text.
 */
export function resolvePastedImagePath(
  pasted: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): PastedImagePath | undefined {
  if (pasted.includes('\n') || pasted.includes('\r')) return undefined
  const trimmed = pasted.trim()
  if (trimmed === '') return undefined
  const quoted = (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  let candidate = quoted ? trimmed.slice(1, -1) : trimmed
  if (candidate.startsWith('file:')) {
    try {
      candidate = fileURLToPath(new URL(candidate), { windows: platform === 'win32' })
    } catch (_invalidFileUrl) {
      return undefined
    }
  } else if (platform !== 'win32') {
    candidate = candidate.replace(/\\([\\ "'])/gu, '$1')
  }
  if (candidate === '~') candidate = homedir()
  else if (candidate.startsWith('~/') || candidate.startsWith('~\\')) {
    candidate = resolve(homedir(), candidate.slice(2))
  }
  const path = platform === 'win32'
    ? (win32.isAbsolute(candidate) ? win32.normalize(candidate) : win32.resolve(cwd, candidate))
    : (isAbsolute(candidate) ? resolve(candidate) : resolve(cwd, candidate))
  const mediaType = IMAGE_MEDIA_TYPES[extname(path).toLocaleLowerCase()]
  return mediaType === undefined ? undefined : { path, mediaType }
}

/**
 * Read and validate one candidate without persisting it.
 * @param store - authoritative image validator.
 * @param candidate - normalized local image path.
 * @param id - composer-local placeholder identity.
 * @returns an in-memory draft ready for batch persistence at send time.
 */
export async function loadTuiImageDraft(
  store: AttachmentStore,
  candidate: PastedImagePath,
  id: number,
): Promise<TuiImageDraft> {
  const input = {
    data: new Uint8Array(await readFile(candidate.path)),
    mediaType: candidate.mediaType,
    name: basename(candidate.path),
  }
  await store.validateImage(input)
  return { id, placeholder: `[Image #${String(id)}]`, input }
}

/**
 * Select unique image drafts whose intact placeholders remain in the submitted text.
 * @param text - submitted composer text.
 * @param drafts - all live and history-retained drafts.
 * @returns selected drafts in placeholder order.
 */
export function selectedTuiImageDrafts(
  text: string,
  drafts: ReadonlyMap<number, TuiImageDraft>,
): TuiImageDraft[] {
  const selected: TuiImageDraft[] = []
  const seen = new Set<number>()
  for (const match of text.matchAll(/\[Image #(\d+)\]/gu)) {
    const id = Number(match[1])
    const draft = drafts.get(id)
    if (draft !== undefined && !seen.has(id)) {
      seen.add(id)
      selected.push(draft)
    }
  }
  return selected
}

/**
 * Persist every unsaved selected draft after validating the whole new-image batch.
 * @param store - durable attachment store.
 * @param drafts - selected drafts in prompt order.
 * @returns selected drafts with durable references replacing in-memory bytes.
 */
export async function saveTuiImageDrafts(
  store: AttachmentStore,
  drafts: readonly TuiImageDraft[],
): Promise<TuiImageDraft[]> {
  if (drafts.length > store.imageLimits.maxImagesPerMessage) {
    throw new AttachmentError('Prompt exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
  }
  const pending = drafts.filter((draft): draft is Extract<TuiImageDraft, { input: SaveImageAttachment }> =>
    draft.input !== undefined)
  const references = await store.saveImages(pending.map(draft => draft.input))
  let pendingIndex = 0
  return drafts.map((draft) => {
    if (draft.attachment !== undefined) return draft
    const attachment = references[pendingIndex]
    if (attachment === undefined) throw new Error('attachment batch result omitted an image')
    pendingIndex += 1
    return { id: draft.id, placeholder: draft.placeholder, attachment }
  })
}

/**
 * Replace selected placeholders with durable image blocks while preserving text order.
 * @param text - parsed user text containing image placeholders.
 * @param drafts - saved drafts selected from that text.
 * @returns ordered model content with each known placeholder converted once.
 */
export function tuiImageContent(text: string, drafts: readonly TuiImageDraft[]): ContentBlock[] {
  const byPlaceholder = new Map(drafts.map(draft => [draft.placeholder, draft]))
  const used = new Set<string>()
  const content: ContentBlock[] = []
  let cursor = 0
  for (const match of text.matchAll(/\[Image #\d+\]/gu)) {
    const index = match.index
    const placeholder = match[0]
    const draft = byPlaceholder.get(placeholder)
    if (draft === undefined || draft.attachment === undefined || used.has(placeholder)) continue
    const before = text.slice(cursor, index)
    if (before !== '') content.push({ type: 'text', text: before })
    content.push({ type: 'image', attachment: draft.attachment })
    used.add(placeholder)
    cursor = index + placeholder.length
  }
  const after = text.slice(cursor)
  if (after !== '') content.push({ type: 'text', text: after })
  return content
}
