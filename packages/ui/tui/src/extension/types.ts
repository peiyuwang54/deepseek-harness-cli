/**
 * Public interactive-extension contract for one mounted TUI front door.
 *
 * Plugins receive terminal-specific rendering primitives without access to
 * the live pi-tui tree, focus controller, overlay handles, or terminal
 * lifecycle. Registrations and open overlays remain owned by the calling
 * Cordis fiber.
 * @module @deepseek-ai/dsh-tui/extension/types
 */

/** Terminal component shape accepted from a trusted TUI extension. */
export interface TuiComponent {
  /**
   * Render this component for the supplied viewport width.
   * @param width - Available terminal columns.
   * @returns terminal lines owned by this component.
   */
  render(width: number): string[]
  /**
   * Handle one terminal input sequence while this component owns focus.
   * @param data - Raw terminal input sequence.
   */
  handleInput?(data: string): void
  /** Receive key-release events instead of having them filtered by the host. */
  wantsKeyRelease?: boolean
  /** Drop cached rendering derived from theme, size, or component state. */
  invalidate(): void
}

/** Optional focus state forwarded by the host to a component. */
export interface TuiFocusable {
  /** Whether the component currently owns terminal focus. */
  focused: boolean
}

/** Read-only semantic color roles supplied by the mounted TUI. */
export interface TuiTheme {
  /** Render ordinary foreground text. */
  readonly text: (value: string) => string
  /** Render trusted static brand art with the host's configured brand treatment. */
  readonly brand: (value: string) => string
  /** Render secondary information and low-emphasis hints, the one tone below `text`. */
  readonly dim: (value: string) => string
  /** Render the active accent role. */
  readonly accent: (value: string) => string
  /** Render a successful outcome. */
  readonly success: (value: string) => string
  /** Render a warning. */
  readonly warning: (value: string) => string
  /** Render an error. */
  readonly error: (value: string) => string
  /** Apply the host's bold role. */
  readonly bold: (value: string) => string
}

/** Current terminal viewport exposed without the mutable Terminal object. */
export interface TuiViewport {
  /** Terminal columns. */
  readonly columns: number
  /** Terminal rows. */
  readonly rows: number
}

/** Supported overlay anchor points. */
export type TuiOverlayAnchor =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center'

/** Terminal-edge spacing for an overlay. */
export interface TuiOverlayMargin {
  /** Rows reserved above the overlay. */
  readonly top?: number
  /** Columns reserved to the right of the overlay. */
  readonly right?: number
  /** Rows reserved below the overlay. */
  readonly bottom?: number
  /** Columns reserved to the left of the overlay. */
  readonly left?: number
}

/** Position and size constraints retained under TUI host ownership. */
export interface TuiOverlayOptions {
  /** Width in columns or as a percentage of terminal width. */
  readonly width?: number | `${number}%`
  /** Minimum width in columns. */
  readonly minWidth?: number
  /** Maximum height in rows or as a percentage of terminal height. */
  readonly maxHeight?: number | `${number}%`
  /** Overlay anchor; defaults to the terminal center. */
  readonly anchor?: TuiOverlayAnchor
  /** Terminal-edge spacing. */
  readonly margin?: number | TuiOverlayMargin
}

/** Capabilities available while an overlay component is queued or visible. */
export interface TuiOverlayHost {
  /**
   * Aborts when the request, caller fiber, overlay session, or TUI closes.
   * Extension work started for the overlay must cooperate with this signal.
   */
  readonly signal: AbortSignal
  /** Current viewport; a fresh immutable value is returned on every read. */
  readonly viewport: TuiViewport
  /** Semantic styles that follow terminal color-scheme changes. */
  readonly theme: TuiTheme
  /**
   * Escape control characters in untrusted display text.
   * @param value - text crossing into terminal presentation.
   * @returns a printable representation that cannot emit terminal controls.
   */
  display(value: string): string
  /** Invalidate the component and schedule one contained terminal redraw. */
  invalidate(): void
  /** Close this overlay normally; repeated calls are no-ops. */
  close(): void
}

/** One effect-owned request to create an interactive overlay. */
export interface TuiOverlayRequest {
  /**
   * Construct the component when this request reaches the front of the modal
   * queue. A throw closes the session with `reason: "error"`.
   */
  readonly create: (host: TuiOverlayHost) => TuiComponent & Partial<TuiFocusable>
  /** Host-owned position and size constraints. */
  readonly options?: TuiOverlayOptions
  /** Optional request cancellation in addition to caller and TUI ownership. */
  readonly signal?: AbortSignal
}

/** Stable reason an overlay stopped being queued or visible. */
export type TuiOverlayCloseReason =
  | 'closed'
  | 'aborted'
  | 'owner-disposed'
  | 'tui-disposed'
  | 'error'

/** Settled overlay outcome; component failures retain their original value. */
export type TuiOverlayOutcome =
  | { readonly reason: Exclude<TuiOverlayCloseReason, 'error'> }
  | { readonly reason: 'error'; readonly error: unknown }

/** Live state of an overlay operation. */
export type TuiOverlayState = 'queued' | 'active' | 'closed'

/** Handle returned to the extension that opened an overlay. */
export interface TuiOverlaySession {
  /** Current queue/display state. */
  readonly state: TuiOverlayState
  /** Settles exactly once after the overlay leaves the queue or display. */
  readonly closed: Promise<TuiOverlayOutcome>
  /**
   * Close the overlay normally and await its settled outcome.
   * @returns the same immutable value exposed through {@link closed}.
   */
  close(): Promise<TuiOverlayOutcome>
}
