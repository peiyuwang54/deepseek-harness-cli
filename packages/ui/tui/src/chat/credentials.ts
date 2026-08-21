/**
 * DeepSeek API-key onboarding and management for the terminal channel.
 * @module @deepseek-ai/dsh-tui/chat/credentials
 */

import type { CredentialInfo, CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { errorChain, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import { ActionDialog, CredentialDialog } from '../components/dialogs.ts'
import type { TuiOverlaySession } from '../extension/types.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'
import { tuiCredentialCopy, type TuiLocale } from './language.ts'

const DEEPSEEK_API_KEY = 'DEEPSEEK_API_KEY' as CredentialRef

/** Collaborators for the TUI credential controller. */
export interface CredentialsControllerDeps extends ChatChannelDeps, ChannelNotice {
  /** Current terminal locale. */
  locale(): TuiLocale
  /** Whether the selected route needs the DeepSeek credential. */
  shouldPrompt(): boolean
}

/** DeepSeek credential controller for one terminal channel. */
export interface CredentialsController {
  /** Queue `/credentials`; values are accepted only through the masked dialog. */
  queueCommand(raw: string): void
  /** Prompt once at startup when the selected DeepSeek route has no key. */
  promptOnFirstUse(): void
  /** Prompt after a model switch when the new route needs the missing key. */
  promptIfMissing(): void
  /** Close a credential-owned overlay during shutdown. */
  clearOverlay(): void
}

/** Build the credential surfaces over the shared write-only provider. */
export function createCredentialsController(deps: CredentialsControllerDeps): CredentialsController {
  const { ctx, resolved, palette, overlayManager } = deps
  let overlay: TuiOverlaySession | undefined
  let operations = Promise.resolve()
  let startupChecked = false

  const credentials = (): CredentialProvider | undefined => ctx.get('credentials')
  const closeOverlay = (): void => { void overlay?.close() }
  const trackOverlay = (session: TuiOverlaySession): void => {
    overlay = session
    void session.closed.then(() => {
      if (overlay === session) overlay = undefined
    })
    deps.requestRender()
  }

  const reportFailure = (error: unknown): void => {
    if (deps.isDisposed()) return
    const copy = tuiCredentialCopy(deps.locale())
    deps.appendNotice(`${copy.failed}: ${errorChain(error)}`, 'error')
  }

  const openPrompt = (firstUse: boolean): void => {
    const copy = tuiCredentialCopy(deps.locale())
    closeOverlay()
    const session = overlayManager.open({
      create: host => new CredentialDialog({
        title: firstUse ? copy.connectTitle : copy.title,
        detail: firstUse ? copy.connectDetail : copy.updateDetail,
        inputHint: copy.inputHint,
        savingHint: copy.savingHint,
        submit: async (raw) => {
          const checked = normalizeApiKey(raw)
          if (!checked.ok) return checked.reason === 'empty' ? copy.empty : copy.illegalCharacters
          const provider = credentials()
          if (provider === undefined) return copy.unavailable
          try {
            await provider.set(DEEPSEEK_API_KEY, checked.value)
          } catch (error) {
            return `${copy.failed}: ${errorChain(error)}`
          }
          if (!deps.isDisposed()) deps.appendNotice(copy.saved)
          void session.close()
          return undefined
        },
        cancel: () => { void session.close() },
        requestRender: () => { host.invalidate() },
      }, palette),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    trackOverlay(session)
  }

  const removeSaved = async (): Promise<void> => {
    const copy = tuiCredentialCopy(deps.locale())
    const provider = credentials()
    if (provider === undefined) {
      deps.appendNotice(copy.unavailable, 'warning')
      return
    }
    await provider.unset(DEEPSEEK_API_KEY)
    if (!deps.isDisposed()) deps.appendNotice(copy.removed)
  }

  const confirmRemove = (): void => {
    const copy = tuiCredentialCopy(deps.locale())
    closeOverlay()
    const session = overlayManager.open({
      create: () => new ActionDialog(
        copy.confirmRemove,
        [
          { value: 'remove', label: copy.remove },
          { value: 'cancel', label: copy.cancel },
        ],
        2,
        palette,
        (value) => {
          void session.close()
          if (value === 'remove') {
            operations = operations.then(removeSaved).catch(reportFailure)
          }
        },
        () => { void session.close() },
        'cancel',
        copy.moveSelectClose,
        false,
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    trackOverlay(session)
  }

  const showStatus = (info: CredentialInfo): void => {
    const copy = tuiCredentialCopy(deps.locale())
    const status = info.configured ? copy.configured : copy.missing
    const source = info.source === undefined ? '' : `${copy.source}: ${info.source}`
    const choices = [
      { value: 'status', label: status, ...source === '' ? {} : { description: source } },
      ...info.writable
        ? [{ value: 'set', label: info.configured ? copy.replace : copy.configure }]
        : [],
      ...info.writable && info.source === 'file'
        ? [{ value: 'unset', label: copy.remove }]
        : [],
      { value: 'close', label: copy.close },
    ]
    closeOverlay()
    const session = overlayManager.open({
      create: () => new ActionDialog(
        copy.title,
        choices,
        choices.length,
        palette,
        (value) => {
          void session.close()
          if (value === 'set') openPrompt(false)
          else if (value === 'unset') confirmRemove()
        },
        () => { void session.close() },
        undefined,
        copy.moveSelectClose,
        false,
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    }, 'composer')
    trackOverlay(session)
  }

  const describe = async (): Promise<CredentialInfo | undefined> => {
    const copy = tuiCredentialCopy(deps.locale())
    const provider = credentials()
    if (provider === undefined) {
      deps.appendNotice(copy.unavailable, 'warning')
      return undefined
    }
    return provider.describe(DEEPSEEK_API_KEY)
  }

  const handleCommand = async (raw: string): Promise<void> => {
    const copy = tuiCredentialCopy(deps.locale())
    const argument = raw.trim().toLowerCase()
    if (argument !== '' && argument !== 'status' && argument !== 'set' && argument !== 'unset') {
      deps.appendNotice(copy.usage, 'warning')
      return
    }
    const info = await describe()
    if (info === undefined || deps.isDisposed()) return
    if (argument === '' || argument === 'status') {
      showStatus(info)
      return
    }
    if (!info.writable) {
      deps.appendNotice(copy.readOnly, 'warning')
      return
    }
    if (argument === 'set') {
      openPrompt(false)
      return
    }
    if (info.source !== 'file') {
      deps.appendNotice(copy.missing, 'warning')
      return
    }
    confirmRemove()
  }

  return {
    queueCommand(raw: string): void {
      operations = operations.then(() => handleCommand(raw)).catch(reportFailure)
    },
    promptOnFirstUse(): void {
      if (startupChecked) return
      startupChecked = true
      this.promptIfMissing()
    },
    promptIfMissing(): void {
      operations = operations.then(async () => {
        if (!deps.shouldPrompt()) return
        const provider = credentials()
        if (provider === undefined) return
        const info = await provider.describe(DEEPSEEK_API_KEY)
        if (!deps.isDisposed() && !info.configured && info.writable) openPrompt(true)
      }).catch(reportFailure)
    },
    clearOverlay(): void {
      overlay = undefined
    },
  }
}
