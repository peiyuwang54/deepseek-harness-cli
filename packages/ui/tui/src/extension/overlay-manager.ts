/**
 * Private bridge between the public TUI extension contract and pi-tui.
 *
 * The manager serializes modal ownership, guards extension callbacks, and
 * settles every queued or active operation before terminal teardown.
 * @module @deepseek-ai/dsh-tui/extension/overlay-manager
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiExtensionService } from '../index.ts'
import type {
  Component,
  Focusable,
} from '@earendil-works/pi-tui'
import type {
  TuiComponent,
  TuiFocusable,
  TuiOverlayCloseReason,
  TuiOverlayHost,
  TuiOverlayOutcome,
  TuiOverlayOptions,
  TuiOverlayRequest,
  TuiOverlaySession,
  TuiOverlayState,
  TuiTheme,
  TuiViewport,
} from './types.ts'

/** pi-tui operations retained by the front door instead of exposed to plugins. */
export interface TuiOverlayDriver {
  /** Current terminal viewport. */
  viewport(): TuiViewport
  /** Current semantic theme facade. */
  theme(): TuiTheme
  /** Escape text at the terminal display boundary. */
  display(value: string): string
  /** Mount one guarded modal and return its private focus/lifecycle handle. */
  show(component: Component, options: TuiOverlayOptions | undefined, placement: TuiOverlayPlacement): TuiModalHandle
  /** Invalidate the mounted UI and request a render. */
  invalidate(): void
  /** Report a contained extension failure. */
  reportError(error: unknown): void
}

type TuiOverlayPlacement = 'overlay' | 'inline'

interface TuiModalHandle {
  hide(): void
}

interface OverlayEntry {
  readonly request: TuiOverlayRequest
  readonly controller: AbortController
  readonly signal: AbortSignal
  readonly closed: Promise<TuiOverlayOutcome>
  readonly resolveClosed: (outcome: TuiOverlayOutcome) => void
  readonly session: TuiOverlaySession
  readonly placement: TuiOverlayPlacement
  state: TuiOverlayState
  component?: GuardedOverlayComponent
  handle?: TuiModalHandle
  removeRequestAbort?: () => void
  outcome?: TuiOverlayOutcome
  failing?: boolean
}

/** Turn a close reason into its immutable public outcome. */
function outcome(reason: Exclude<TuiOverlayCloseReason, 'error'>): TuiOverlayOutcome {
  return Object.freeze({ reason })
}

/** Retain only supported layout fields before a queued request returns to its caller. */
function retainOptions(options: TuiOverlayOptions): TuiOverlayOptions {
  return Object.freeze({
    ...options.width === undefined ? {} : { width: options.width },
    ...options.minWidth === undefined ? {} : { minWidth: options.minWidth },
    ...options.maxHeight === undefined ? {} : { maxHeight: options.maxHeight },
    ...options.anchor === undefined ? {} : { anchor: options.anchor },
    ...options.margin === undefined
      ? {}
      : {
        margin: typeof options.margin === 'object'
          ? Object.freeze({ ...options.margin })
          : options.margin,
      },
  })
}

/** Guard plugin component methods while preserving focus and key-release state. */
class GuardedOverlayComponent implements Component, Focusable {
  constructor(
    private readonly component: TuiComponent & Partial<TuiFocusable>,
    private readonly fail: (error: unknown) => void,
  ) {}

  get focused(): boolean {
    try {
      return this.component.focused ?? false
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  set focused(value: boolean) {
    try {
      if ('focused' in this.component) this.component.focused = value
    } catch (error) {
      this.fail(error)
    }
  }

  get wantsKeyRelease(): boolean {
    try {
      return this.component.wantsKeyRelease ?? false
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  render(width: number): string[] {
    try {
      return this.component.render(width)
    } catch (error) {
      this.fail(error)
      return []
    }
  }

  handleInput(data: string): void {
    try {
      this.component.handleInput?.(data)
    } catch (error) {
      this.fail(error)
    }
  }

  invalidate(): boolean {
    try {
      this.component.invalidate()
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }
}

/** FIFO modal owner for one mounted TUI. */
export class TuiOverlayManager {
  private readonly queue: OverlayEntry[] = []
  private active: OverlayEntry | undefined
  private accepting = true
  private disposeTask: Promise<void> | undefined

  constructor(private readonly driver: TuiOverlayDriver) {}

  /**
   * Whether one extension or built-in overlay currently owns terminal focus.
   * @returns `true` while an overlay is active.
   */
  hasActiveOverlay(): boolean {
    return this.active !== undefined
  }

  /** Reject new work while the TUI unloads dependent extension fibers. */
  beginShutdown(): void {
    this.accepting = false
  }

  /**
   * Queue one modal without assigning Cordis ownership.
   * @param request - component factory, constraints, and request signal.
   * @param placement - terminal overlay for extensions, or inline for the built-in question panel.
   * @returns an internal session that can close with an ownership reason.
   */
  open(request: TuiOverlayRequest, placement: TuiOverlayPlacement = 'overlay'): TuiOverlaySession & {
    closeWith(reason: Exclude<TuiOverlayCloseReason, 'error'>): Promise<TuiOverlayOutcome>
  } {
    if (!this.accepting) throw new Error('TUI is shutting down')
    const requestSignal = request.signal
    const retainedRequest: TuiOverlayRequest = Object.freeze({
      create: request.create,
      ...request.options === undefined ? {} : { options: retainOptions(request.options) },
      ...requestSignal === undefined ? {} : { signal: requestSignal },
    })
    const controller = new AbortController()
    const signal = requestSignal === undefined
      ? controller.signal
      : AbortSignal.any([requestSignal, controller.signal])
    const deferred = Promise.withResolvers<TuiOverlayOutcome>()
    const session: TuiOverlaySession & {
      closeWith(reason: Exclude<TuiOverlayCloseReason, 'error'>): Promise<TuiOverlayOutcome>
    } = {
      get state(): TuiOverlayState {
        return entry.state
      },
      closed: deferred.promise,
      close: () => this.close(entry, outcome('closed')),
      closeWith: (reason: Exclude<TuiOverlayCloseReason, 'error'>) =>
        this.close(entry, outcome(reason)),
    }
    const entry: OverlayEntry = {
      request: retainedRequest,
      controller,
      signal,
      closed: deferred.promise,
      resolveClosed: deferred.resolve,
      session,
      placement,
      state: 'queued',
    }
    if (requestSignal?.aborted === true) {
      void this.close(entry, outcome('aborted'))
      return session
    }
    if (requestSignal !== undefined) {
      const onAbort = (): void => { void this.close(entry, outcome('aborted')) }
      requestSignal.addEventListener('abort', onAbort, { once: true })
      entry.removeRequestAbort = () => { requestSignal.removeEventListener('abort', onAbort) }
    }
    this.queue.push(entry)
    this.activateNext()
    return session
  }

  /** Stop accepting work and settle every active or queued overlay. */
  dispose(): Promise<void> {
    if (this.disposeTask !== undefined) return this.disposeTask
    this.beginShutdown()
    const entries = [
      ...this.active === undefined ? [] : [this.active],
      ...this.queue,
    ]
    return this.disposeTask = Promise.all(
      entries.map(entry => this.close(entry, outcome('tui-disposed'))),
    ).then(() => {})
  }

  private activateNext(): void {
    if (!this.accepting || this.active !== undefined) return
    const entry = this.queue.shift()
    if (entry === undefined) return
    this.active = entry
    entry.state = 'active'
    const host = this.host(entry)
    let component: TuiComponent & Partial<TuiFocusable>
    try {
      component = entry.request.create(host)
    } catch (error) {
      this.fail(entry, error)
      return
    }
    if (this.active !== entry) return
    const guarded = new GuardedOverlayComponent(component, (error) => {
      this.fail(entry, error)
    })
    entry.component = guarded
    try {
      const handle = this.driver.show(guarded, entry.request.options, entry.placement)
      if (this.active !== entry) {
        this.hide(handle)
        return
      }
      entry.handle = handle
      this.driver.invalidate()
    } catch (error) {
      this.fail(entry, error)
    }
  }

  private host(entry: OverlayEntry): TuiOverlayHost {
    const driver = this.driver
    return Object.freeze({
      get signal(): AbortSignal {
        return entry.signal
      },
      get viewport(): TuiViewport {
        return Object.freeze({ ...driver.viewport() })
      },
      get theme(): TuiTheme {
        return driver.theme()
      },
      display: (value: string) => this.driver.display(value),
      invalidate: () => {
        if (this.active !== entry || entry.component === undefined || entry.failing === true) return
        if (!entry.component.invalidate() || this.active !== entry) return
        try {
          this.driver.invalidate()
        } catch (error) {
          this.fail(entry, error)
        }
      },
      close: () => { void this.close(entry, outcome('closed')) },
    })
  }

  private fail(entry: OverlayEntry, error: unknown): void {
    if (entry.state === 'closed' || entry.failing === true) return
    entry.failing = true
    this.report(error)
    queueMicrotask(() => {
      void this.close(entry, Object.freeze({ reason: 'error', error }))
    })
  }

  private report(error: unknown): void {
    try {
      this.driver.reportError(error)
    } catch {
      // Error reporting is a containment boundary, never a second failure path.
    }
  }

  private hide(handle: TuiModalHandle): void {
    try {
      handle.hide()
    } catch (error) {
      this.report(error)
    }
  }

  private close(entry: OverlayEntry, result: TuiOverlayOutcome): Promise<TuiOverlayOutcome> {
    if (entry.outcome !== undefined) return entry.closed
    entry.outcome = result
    entry.state = 'closed'
    entry.removeRequestAbort?.()
    delete entry.removeRequestAbort
    if (!entry.controller.signal.aborted) entry.controller.abort(result)
    const queuedIndex = this.queue.indexOf(entry)
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1)
    if (this.active === entry) {
      this.active = undefined
      if (entry.handle !== undefined) this.hide(entry.handle)
      delete entry.handle
    }
    delete entry.component
    entry.resolveClosed(result)
    try {
      this.driver.invalidate()
    } catch (error) {
      this.report(error)
    }
    queueMicrotask(() => { this.activateNext() })
    return entry.closed
  }
}

/** Cordis service whose method effects bind to the calling plugin fiber. */
export class TuiExtensionServiceImpl extends Service implements TuiExtensionService {
  constructor(
    ctx: Context,
    readonly agent: Agent,
    private readonly overlays: TuiOverlayManager,
  ) {
    super(ctx, 'tui')
  }

  /** @inheritdoc */
  openOverlay(request: TuiOverlayRequest): TuiOverlaySession {
    let operation: ReturnType<TuiOverlayManager['open']> | undefined
    const disposeOwner = this.ctx.effect(
      () => () => operation?.closeWith('owner-disposed'),
      'tui.openOverlay()',
    )
    try {
      operation = this.overlays.open(request)
    } catch (error) {
      void disposeOwner()
      throw error
    }
    void operation.closed.then(() => { void disposeOwner() })
    return operation
  }
}
