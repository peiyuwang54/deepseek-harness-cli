import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, posix, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentStore, ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import {
  loadTuiImageDraft,
  resolvePastedImagePath,
  saveTuiImageDrafts,
  selectedTuiImageDrafts,
  tuiImageContent,
  type TuiImageDraft,
} from '../src/chat/image-attachments.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function pending(id: number, byte = id): TuiImageDraft {
  return {
    id,
    placeholder: `[Image #${String(id)}]`,
    input: { data: Uint8Array.of(byte), mediaType: 'image/png', name: `${String(id)}.png` },
  }
}

function saved(id: number): TuiImageDraft {
  return {
    id,
    placeholder: `[Image #${String(id)}]`,
    attachment: {
      attachmentId: `attachment-${String(id)}` as never,
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      name: `${String(id)}.png`,
    },
  }
}

describe('TUI image attachments', () => {
  it('normalizes quoted, escaped, file-URL, tilde, relative, and Windows paths', () => {
    expect(resolvePastedImagePath('"assets/one image.PNG"', '/workspace')).toEqual({
      path: resolve('/workspace/assets/one image.PNG'), mediaType: 'image/png',
    })
    expect(resolvePastedImagePath('assets/one\\ image.jpg', '/workspace', 'linux')).toEqual({
      path: posix.resolve('/workspace/assets/one image.jpg'), mediaType: 'image/jpeg',
    })
    const filePath = resolve('/tmp/a.webp')
    expect(resolvePastedImagePath(pathToFileURL(filePath).href, '/workspace')).toEqual({
      path: filePath, mediaType: 'image/webp',
    })
    expect(resolvePastedImagePath('~/a.gif', '/workspace')).toEqual({
      path: join(homedir(), 'a.gif'), mediaType: 'image/gif',
    })
    expect(resolvePastedImagePath('C:\\Users\\A\\a.jpeg', 'C:\\repo', 'win32')).toEqual({
      path: win32.normalize('C:\\Users\\A\\a.jpeg'), mediaType: 'image/jpeg',
    })
    expect(resolvePastedImagePath('notes.txt', '/workspace')).toBeUndefined()
    expect(resolvePastedImagePath('a.png\nb.png', '/workspace')).toBeUndefined()
    expect(resolvePastedImagePath('file://%zz', '/workspace')).toBeUndefined()
    expect(resolvePastedImagePath('   ', '/workspace')).toBeUndefined()
  })

  it('selects unique intact placeholders in text order', () => {
    const drafts = new Map([[1, pending(1)], [2, pending(2)]])
    expect(selectedTuiImageDrafts('[Image #2] x [Image #1] [Image #2] [Image #9]', drafts)
      .map(draft => draft.id)).toEqual([2, 1])
  })

  it('loads and validates one local image draft before batch persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-image-test-'))
    roots.push(root)
    const path = join(root, 'image.png')
    await writeFile(path, Buffer.from([1, 2, 3]))
    const validateImage = vi.fn(async () => {})
    const draft = await loadTuiImageDraft(
      { validateImage } as unknown as AttachmentStore,
      { path, mediaType: 'image/png' },
      4,
    )
    expect(draft).toEqual({
      id: 4,
      placeholder: '[Image #4]',
      input: { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', name: 'image.png' },
    })
    expect(validateImage).toHaveBeenCalledOnce()
    expect(await readFile(path)).toEqual(Buffer.from([1, 2, 3]))
  })

  it('persists only pending drafts and retains durable history references', async () => {
    const saveImages = vi.fn((inputs: readonly SaveImageAttachment[]) => Promise.resolve(inputs.map(input => ({
      attachmentId: `saved-${String(input.data[0])}` as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: 1,
      width: 1,
      height: 1,
      name: input.name,
    }))))
    const result = await saveTuiImageDrafts({
      imageLimits: {
        maxImageBytes: 2, maxImagesPerMessage: 3, maxMessageImageBytes: 3,
        maxImagePixels: 4, mediaTypes: ['image/png'],
      },
      saveImages,
    } as never, [saved(1), pending(2)])
    expect(saveImages).toHaveBeenCalledOnce()
    expect(saveImages.mock.calls[0]?.[0]).toMatchObject([{ name: '2.png' }])
    expect(result).toMatchObject([
      { attachment: { attachmentId: 'attachment-1' } },
      { attachment: { attachmentId: 'saved-2' } },
    ])
  })

  it('enforces the final message count and converts each placeholder once', async () => {
    const store = {
      imageLimits: {
        maxImageBytes: 2, maxImagesPerMessage: 1, maxMessageImageBytes: 2,
        maxImagePixels: 4, mediaTypes: ['image/png'],
      },
      validateImage: vi.fn(() => Promise.resolve()),
      saveImage: vi.fn(() => Promise.reject(new Error('unused'))),
    } as never
    await expect(saveTuiImageDrafts(store, [saved(1), saved(2)]))
      .rejects.toMatchObject({ code: 'TOO_MANY_IMAGES' })

    const one = saved(1)
    expect(tuiImageContent('before [Image #1] after [Image #1] tail', [one])).toEqual([
      { type: 'text', text: 'before ' },
      { type: 'image', attachment: one.attachment },
      { type: 'text', text: ' after [Image #1] tail' },
    ])
    expect(tuiImageContent('plain text', [])).toEqual([{ type: 'text', text: 'plain text' }])
  })
})
