/**
 * Shared collaborator surface every chat-channel sub-controller receives from
 * `createTuiChat`. Each controller's own `*Deps` extends {@link ChatChannelDeps}
 * (and {@link ChannelNotice} when it reports outcomes) with the extra services
 * it needs. Value collaborators (`ctx`, `resolved`, `palette`, `overlayManager`)
 * are stable for the channel's life; the callbacks stay on the object so a
 * controller always calls the channel's current implementation.
 * @module @deepseek-ai/dsh-tui/chat/channel
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TuiOverlayManager } from '../extension/overlay-manager.ts'
import type { Palette } from '../components/theme.ts'
import type { ResolvedTuiConfig } from '../config.ts'

/** Collaborators shared by every chat-channel sub-controller. */
export interface ChatChannelDeps {
  readonly ctx: Context
  readonly resolved: ResolvedTuiConfig
  readonly palette: Palette
  readonly overlayManager: TuiOverlayManager
  /** Redraw the channel. */
  requestRender(): void
  /** Whether the channel has begun shutting down. */
  isDisposed(): boolean
}

/** Append a channel notice line; controllers that report outcomes mix this in. */
export interface ChannelNotice {
  appendNotice(message: string, kind?: 'info' | 'warning' | 'error'): void
}
