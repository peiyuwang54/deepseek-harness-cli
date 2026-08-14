/**
 * Terminal answerer for the approval capability. The security policy and
 * durable audit pair remain owned by ApprovalService; this module only queues
 * presentation and returns one human outcome for the exact mounted agent.
 * @module @deepseek-ai/dsh-tui/chat/approvals
 */

import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  ApprovalOutcome,
  ApprovalRequest,
} from '@deepseek-ai/dsh-user-approval'
import { displayText } from '../components/text.ts'
import type { Palette } from '../components/theme.ts'
import type { TuiOverlaySession } from '../extension/types.ts'
import type { ChatChannelDeps } from './channel.ts'

const ALLOW = 'Allow once'
const REJECT = 'Reject'

/** Collaborators used by the approval queue. */
export interface ApprovalQueueDeps extends ChatChannelDeps {
  readonly agent: Agent
  approvalMaxHeight(): number
}

/** Lifecycle handle for the mounted approval answerer. */
export interface ApprovalQueue {
  /** Allow the active approval exactly once; false means no request is pending. */
  approveActive(): boolean
  /** Arm one retry of the most recently rejected matching request. */
  approveRecentRejection(): boolean
  /** Whether an approval request currently owns the dialog. */
  hasActive(): boolean
  /** Settle active and queued requests as cancelled during terminal shutdown. */
  cancelAll(): void
  /** Remove the scoped `approval/request` listener. */
  unregister(): void
}

interface PendingApproval {
  readonly request: ApprovalRequest
  readonly resolve: (outcome: ApprovalOutcome) => void
  readonly onAbort: () => void
  overlay: TuiOverlaySession | undefined
  settled: boolean
}

/** Focusable, terminal-bounded view for one approval request. */
class ApprovalDialog implements Component, Focusable {
  focused = false
  private selected = 0

  constructor(
    private readonly request: ApprovalRequest,
    private readonly maxHeight: () => number,
    private readonly palette: Palette,
    private readonly decide: (outcome: ApprovalOutcome) => void,
  ) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
      this.selected = this.selected === 0 ? 1 : 0
      return
    }
    if (matchesKey(data, Key.enter)) {
      this.decide(this.selected === 0 ? 'allowed-once' : 'rejected')
      return
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.decide('cancelled')
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 4)
    const lines: string[] = [
      this.palette.bold(this.palette.warning('Approval required')),
      ...wrapTextWithAnsi(`Tool: ${displayText(this.request.toolName)}`, innerWidth),
    ]
    if (this.request.reason !== undefined) {
      lines.push('', ...wrapTextWithAnsi(displayText(this.request.reason), innerWidth))
    }
    if (this.request.callId !== undefined) {
      lines.push(this.palette.dim(`Call: ${displayText(this.request.callId)}`))
    }
    lines.push('')
    for (const [index, option] of [ALLOW, REJECT].entries()) {
      const marker = index === this.selected ? '›' : ' '
      const label = `${marker} ${index + 1}. ${option}`
      lines.push(index === this.selected
        ? this.palette.bold(this.palette.accent(label))
        : label)
    }
    lines.push('', this.palette.dim('↑/↓ choose • Enter decide • Esc cancel'))
    const bounded = lines.slice(0, Math.max(1, this.maxHeight()))
    return bounded.map((line) => {
      const value = truncateToWidth(line, innerWidth, '…')
      const padding = ' '.repeat(Math.max(0, innerWidth - visibleWidth(value)))
      return `  ${value}${padding}  `
    })
  }
}

/**
 * Register one agent-scoped FIFO approval answerer.
 * @param deps - mounted TUI collaborators and exact agent ownership.
 * @returns queue lifecycle used by channel shutdown.
 */
export function createApprovalQueue(deps: ApprovalQueueDeps): ApprovalQueue {
  const queue: PendingApproval[] = []
  let active: PendingApproval | undefined
  let accepting = true
  let lastRejected: Pick<ApprovalRequest, 'toolName' | 'reason'> | undefined
  let retryApproval: Pick<ApprovalRequest, 'toolName' | 'reason'> | undefined

  const settle = (pending: PendingApproval, outcome: ApprovalOutcome): void => {
    if (pending.settled) return
    pending.settled = true
    pending.request.signal?.removeEventListener('abort', pending.onAbort)
    const overlay = pending.overlay
    pending.overlay = undefined
    if (active === pending) active = undefined
    else {
      const index = queue.indexOf(pending)
      if (index >= 0) queue.splice(index, 1)
    }
    if (outcome === 'rejected') {
      lastRejected = {
        toolName: pending.request.toolName,
        ...pending.request.reason === undefined ? {} : { reason: pending.request.reason },
      }
    }
    pending.resolve(outcome)
    void overlay?.close()
    startNext()
    deps.requestRender()
  }

  const startNext = (): void => {
    if (!accepting || active !== undefined || deps.isDisposed()) return
    const pending = queue.shift()
    if (pending === undefined) return
    active = pending
    const overlay = deps.overlayManager.open({
      ...pending.request.signal === undefined ? {} : { signal: pending.request.signal },
      create: () => new ApprovalDialog(
        pending.request,
        () => deps.approvalMaxHeight(),
        deps.palette,
        (outcome) => { settle(pending, outcome) },
      ),
      options: {
        width: Math.min(88, deps.resolved.questionDialogWidth),
        maxHeight: deps.resolved.questionDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    })
    pending.overlay = overlay
    void overlay.closed.then((result) => {
      if (pending.settled) return
      settle(pending, result.reason === 'error' ? 'unavailable' : 'cancelled')
    })
    deps.requestRender()
  }

  const unregister = deps.agent.ctx.on('approval/request', (request, next) => {
    if (request.agent !== deps.agent) return next()
    if (!accepting) return Promise.resolve('unavailable')
    if (request.signal?.aborted === true) return Promise.resolve('cancelled')
    if (retryApproval !== undefined) {
      const grant = retryApproval
      retryApproval = undefined
      if (request.toolName === grant.toolName && request.reason === grant.reason) {
        lastRejected = undefined
        return Promise.resolve('allowed-once')
      }
    }
    return new Promise<ApprovalOutcome>((resolve) => {
      const pending: PendingApproval = {
        request,
        resolve,
        settled: false,
        overlay: undefined,
        onAbort: () => { settle(pending, 'cancelled') },
      }
      request.signal?.addEventListener('abort', pending.onAbort, { once: true })
      queue.push(pending)
      startNext()
    })
  })

  return {
    approveActive(): boolean {
      if (active === undefined) return false
      settle(active, 'allowed-once')
      return true
    },
    approveRecentRejection(): boolean {
      if (lastRejected === undefined) return false
      retryApproval = lastRejected
      lastRejected = undefined
      return true
    },
    hasActive: () => active !== undefined,
    cancelAll(): void {
      accepting = false
      const pending = [
        ...active === undefined ? [] : [active],
        ...queue,
      ]
      active = undefined
      queue.splice(0)
      for (const request of pending) settle(request, 'cancelled')
    },
    unregister,
  }
}
