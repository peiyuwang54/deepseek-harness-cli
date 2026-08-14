/**
 * Mutable terminal-prompt value registry consumed by the TUI template renderer.
 * Values are trusted presentation fragments and may contain ANSI control sequences.
 * @module @deepseek-ai/dsh-tui/prompt
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { errorChain } from '@deepseek-ai/dsh-llm'

export const name = 'tui-prompt'

const VALUE_NAME = /^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/u

/** Handle owned by one prompt-value registration. */
export interface TuiPromptValueHandle {
  /**
   * Replace the current fragment and schedule a coalesced change notification
   * so the owning renderer redraws. Setting the current value again is a no-op.
   * @param value - Trusted ANSI-capable fragment, or `undefined` while unavailable.
   */
  set(value: string | undefined): void

  /** Unregister this value; subsequent {@link TuiPromptValueHandle.set} calls fail. */
  dispose(): void
}

interface RegisteredValue {
  value: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiPrompt: TuiPromptService
  }
}

/** Removes a change subscription registered with {@link TuiPromptService.subscribe}. */
export type TuiPromptUnsubscribe = () => void

/** One literal or variable token in a parsed TUI prompt template. */
export type TuiPromptTemplateToken =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'value'; readonly name: string }

/**
 * Parse a prompt template into immutable literal and value tokens.
 * @param template - Text containing `${name}` references.
 * @returns Tokens consumed by {@link renderTuiPromptTemplate}.
 */
export function parseTuiPromptTemplate(template: string): readonly TuiPromptTemplateToken[] {
  const tokens: TuiPromptTemplateToken[] = []
  const pattern = /\$\{([^}]*)\}/gu
  let offset = 0
  for (const match of template.matchAll(pattern)) {
    const index = match.index
    const name = match[1]
    /* v8 ignore next -- the sole capture always exists when this pattern matches. */
    if (name === undefined) continue
    if (index > offset) tokens.push(Object.freeze({ kind: 'literal', value: template.slice(offset, index) }))
    tokens.push(Object.freeze({ kind: 'value', name }))
    offset = index + match[0].length
  }
  if (offset < template.length) tokens.push(Object.freeze({ kind: 'literal', value: template.slice(offset) }))
  return Object.freeze(tokens)
}

/**
 * Interpolate one parsed prompt while removing horizontal separators adjacent
 * only to unavailable values.
 * @param tokens - Parsed template tokens.
 * @param resolve - Current value lookup.
 * @returns ANSI-capable rendered prompt text.
 */
export function renderTuiPromptTemplate(
  tokens: readonly TuiPromptTemplateToken[],
  resolve: (name: string) => string | undefined,
): string {
  const rendered: string[] = []
  let omitLeadingWhitespace = false
  for (const token of tokens) {
    if (token.kind === 'value') {
      const value = resolve(token.name)
      if (value === undefined) {
        omitLeadingWhitespace = true
      } else {
        rendered.push(value)
        omitLeadingWhitespace = false
      }
      continue
    }
    rendered.push(omitLeadingWhitespace ? token.value.replace(/^[\t ]+/u, '') : token.value)
    omitLeadingWhitespace = false
  }
  return rendered.join('')
}

/**
 * Context-global mutable values interpolated by TUI theme prompt templates.
 * A registration, mutation, or disposal schedules one coalesced notification to
 * the renderer subscribed with {@link TuiPromptService.subscribe}, so a value
 * that changes on its own schedule (not only in response to a UI event) still
 * redraws. Notification is a direct in-service callback, not a Cordis event.
 */
export class TuiPromptService extends Service {
  private readonly values = new Map<string, RegisteredValue>()
  // Per-subscription record identity, not callback identity: two fibers may
  // subscribe the same function, and disposing one must not remove the other's.
  private readonly listeners = new Set<{ readonly listener: () => unknown }>()
  private notificationQueued = false

  constructor(ctx: Context) {
    super(ctx, 'tuiPrompt')
  }

  /**
   * Register one globally unique template value under the calling Cordis effect.
   * @param name - Lowercase slash-separated template name.
   * @param initialValue - Initial trusted ANSI-capable fragment.
   * @returns A mutable handle whose disposal unregisters the name.
   */
  register(name: string, initialValue?: string): TuiPromptValueHandle {
    if (!VALUE_NAME.test(name)) {
      throw new TypeError(`TUI prompt value name "${name}" must match ${String(VALUE_NAME)}`)
    }
    if (this.values.has(name)) throw new Error(`TUI prompt value "${name}" is already registered`)

    const registered: RegisteredValue = { value: initialValue }
    let active = true
    const effectDisposer = this.ctx.effect(() => {
      this.values.set(name, registered)
      this.scheduleChange()
      // Cordis runs this cleanup at most once per effect, and deleting an
      // absent key is a no-op, so no re-entrancy guard is needed here; `active`
      // exists only to reject a late {@link TuiPromptValueHandle.set}.
      return () => {
        active = false
        this.values.delete(name)
        this.scheduleChange()
      }
    }, `tuiPrompt.register(${name})`)

    return Object.freeze({
      set: (value: string | undefined): void => {
        if (!active) throw new Error(`TUI prompt value "${name}" is disposed`)
        if (registered.value === value) return
        registered.value = value
        this.scheduleChange()
      },
      dispose: (): void => { void effectDisposer() },
    })
  }

  /**
   * Read a registered fragment without evaluating plugin code.
   * @param name - Exact registered template name.
   * @returns The current fragment, or `undefined` when unknown or unavailable.
   */
  get(name: string): string | undefined {
    return this.values.get(name)?.value
  }

  /**
   * Observe registration and value changes. The listener runs after a coalesced
   * microtask following any burst of mutations; the renderer re-reads current
   * values on that callback. The subscription is owned by the calling Cordis
   * effect, so it is removed when the subscriber's fiber disposes; the returned
   * disposer removes it early. Listener failures are contained — a synchronous
   * throw or a rejected returned promise cannot starve the other observers.
   * @param listener - Invoked once per coalesced change burst. Delivery does
   *   not wait on a returned promise; its rejection is only observed and logged,
   *   never left unhandled, so an async listener cannot order later observers.
   * @returns A disposer that removes the subscription.
   */
  subscribe(listener: () => unknown): TuiPromptUnsubscribe {
    const record = { listener }
    const disposeEffect = this.ctx.effect(() => {
      this.listeners.add(record)
      return () => { this.listeners.delete(record) }
    }, 'tuiPrompt.subscribe')
    return () => { void disposeEffect() }
  }

  /** Coalesce mutation bursts into one notification while containing each observer. */
  private scheduleChange(): void {
    if (this.notificationQueued) return
    this.notificationQueued = true
    queueMicrotask(() => {
      this.notificationQueued = false
      // Snapshot so a listener may subscribe/unsubscribe during delivery, but
      // re-check liveness: a listener that synchronously unsubscribes another
      // observer earlier in the same burst must silence it now, keeping the
      // subscription set authoritative during reentrant notification.
      for (const record of [...this.listeners]) {
        if (this.listeners.has(record)) this.notifyOne(record.listener)
      }
    })
  }

  /** Deliver one change notification, containing a synchronous throw or a rejected promise. */
  private notifyOne(listener: () => unknown): void {
    let returned: unknown
    try {
      returned = listener()
    } catch (error: unknown) {
      // errorChain never throws, even on a hostile toString/getter, so the
      // notification microtask can never escape to starve later observers.
      this.ctx.logger.warn(`tui-prompt change listener threw: ${errorChain(error)}`)
      return
    }
    // A listener may be async; contain a rejected promise the same as a throw.
    void Promise.resolve(returned).catch((error: unknown) => {
      this.ctx.logger.warn(`tui-prompt change listener rejected: ${errorChain(error)}`)
    })
  }
}

export default TuiPromptService
