import { access, readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  editInExternalEditor,
  externalEditorInvocation,
  MissingExternalEditorError,
  resolveExternalEditorCommand,
  type ExternalEditorHost,
} from '../src/chat/external-editor.ts'

describe('external editor', () => {
  it('prefers VISUAL, falls back to EDITOR, and rejects an empty setup', () => {
    expect(resolveExternalEditorCommand({ VISUAL: ' code --wait ', EDITOR: 'vim' })).toBe('code --wait')
    expect(resolveExternalEditorCommand({ VISUAL: ' ', EDITOR: ' nano ' })).toBe('nano')
    expect(() => resolveExternalEditorCommand({ VISUAL: '', EDITOR: ' ' }))
      .toThrow(MissingExternalEditorError)
  })

  it('uses the platform environment-variable syntax without embedding the path', () => {
    expect(externalEditorInvocation('code --wait', 'darwin')).toBe('code --wait "$DSH_EDITOR_FILE"')
    expect(externalEditorInvocation('code --wait', 'win32')).toBe('code --wait "%DSH_EDITOR_FILE%"')
  })

  it('round-trips the saved draft and removes its temporary directory', async () => {
    let draftPath = ''
    const run = vi.fn<ExternalEditorHost['run']>(async (command, environment) => {
      expect(command).toBe('editor --wait "$DSH_EDITOR_FILE"')
      draftPath = environment.DSH_EDITOR_FILE ?? ''
      expect(await readFile(draftPath, 'utf8')).toBe('seed text')
      await writeFile(draftPath, 'edited text\n', 'utf8')
    })
    const result = await editInExternalEditor('seed text', {
      environment: { VISUAL: 'editor --wait' },
      platform: 'linux',
      run,
    })
    expect(result).toBe('edited text\n')
    expect(run).toHaveBeenCalledOnce()
    await expect(access(draftPath)).rejects.toThrow()
  })

  it('removes its temporary directory after the editor fails', async () => {
    let draftPath = ''
    const failure = new Error('editor crashed')
    await expect(editInExternalEditor('seed', {
      environment: { EDITOR: 'editor' },
      platform: 'linux',
      async run(_command, environment) {
        draftPath = environment.DSH_EDITOR_FILE ?? ''
        throw failure
      },
    })).rejects.toBe(failure)
    await expect(access(draftPath)).rejects.toThrow()
  })
})
