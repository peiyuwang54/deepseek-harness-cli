import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { createApprovalQueue } from '../src/chat/approvals.ts'
import { createPalette } from '../src/components/theme.ts'
import { resolveTuiConfig } from '../src/config.ts'
import type { TuiOverlayOutcome, TuiOverlayRequest, TuiOverlaySession } from '../src/extension/types.ts'

function overlaySession(): TuiOverlaySession {
  const deferred = Promise.withResolvers<TuiOverlayOutcome>()
  let closed = false
  return {
    state: 'active',
    closed: deferred.promise,
    close: async () => {
      if (!closed) {
        closed = true
        deferred.resolve({ reason: 'closed' })
      }
      return deferred.promise
    },
  }
}

async function approvalContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)
  return ctx
}

function testAgent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  const agent = {
    id: session.id,
    options: {},
    session,
    status: 'running',
    ctx,
    inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  } satisfies Agent
  ctx.agents.register(agent)
  return agent
}

interface CapturedOverlay {
  readonly component: ReturnType<TuiOverlayRequest['create']>
  readonly session: TuiOverlaySession
}

function overlayCapture(): {
  readonly opened: CapturedOverlay[]
  readonly open: ReturnType<typeof vi.fn<(request: TuiOverlayRequest) => TuiOverlaySession>>
} {
  const opened: CapturedOverlay[] = []
  const open = vi.fn((request: TuiOverlayRequest) => {
    const session = overlaySession()
    opened.push({
      component: request.create({} as never),
      session,
    })
    return session
  })
  return { opened, open }
}

function approvalQueue(ctx: Context, agent: Agent, capture: ReturnType<typeof overlayCapture>) {
  return createApprovalQueue({
    ctx,
    agent,
    resolved: resolveTuiConfig({ theme: { color: false } }),
    palette: createPalette(false),
    overlayManager: { open: capture.open } as never,
    requestRender() {},
    isDisposed: () => false,
    approvalMaxHeight: () => 12,
  })
}

function sendKey(overlay: CapturedOverlay, data: string): void {
  if (overlay.component.handleInput === undefined) {
    throw new Error('approval overlay is not focusable')
  }
  overlay.component.handleInput(data)
}

function overlayText(overlay: CapturedOverlay): string {
  return overlay.component.render(80).join('\n')
}

function expectAuditPairs(session: Session, outcomes: readonly ApprovalOutcome[]): void {
  const asked = session.events.filter(
    (event): event is SessionEvent<'approval/asked'> => event.type === 'approval/asked',
  )
  const decided = session.events.filter(
    (event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided',
  )
  expect(asked).toHaveLength(outcomes.length)
  expect(decided).toHaveLength(outcomes.length)
  expect(decided.map(event => event.data.id)).toEqual(asked.map(event => event.data.id))
  expect(decided.map(event => event.data.outcome)).toEqual(outcomes)
  expect(new Set(asked.map(event => event.data.id)).size).toBe(outcomes.length)
}

describe('TUI approval queue', () => {
  it('cancels an active request and every queued request without promoting an escapee', async () => {
    const ctx = await approvalContext()
    const agent = testAgent(ctx, 'approval-tui')
    const session = agent.session
    const open = vi.fn((_request: TuiOverlayRequest) => overlaySession())
    const queue = createApprovalQueue({
      ctx,
      agent,
      resolved: resolveTuiConfig({ theme: { color: false } }),
      palette: createPalette(false),
      overlayManager: { open } as never,
      requestRender() {},
      isDisposed: () => false,
      approvalMaxHeight: () => 12,
    })

    const outcomes = [
      ctx.approval.request({ agent, toolName: 'bash' }),
      ctx.approval.request({ agent, toolName: 'write' }),
      ctx.approval.request({ agent, toolName: 'network' }),
    ]
    await vi.waitFor(() => { expect(open).toHaveBeenCalledTimes(1) })
    queue.cancelAll()

    await expect(Promise.all(outcomes)).resolves.toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ])
    expect(open).toHaveBeenCalledTimes(1)
    expectAuditPairs(session, ['cancelled', 'cancelled', 'cancelled'])

    queue.unregister()
    await ctx.fiber.dispose()
  })

  it('promotes approvals in FIFO order and maps Enter, Down+Enter, and Escape to closed outcomes', async () => {
    const ctx = await approvalContext()
    const agent = testAgent(ctx, 'approval-fifo')
    const capture = overlayCapture()
    const queue = approvalQueue(ctx, agent, capture)

    const outcomes = [
      ctx.approval.request({ agent, toolName: 'first-tool' }),
      ctx.approval.request({ agent, toolName: 'second-tool' }),
      ctx.approval.request({ agent, toolName: 'third-tool' }),
    ]
    await vi.waitFor(() => { expect(capture.open).toHaveBeenCalledTimes(1) })
    expect(overlayText(capture.opened[0]!)).toContain('Tool: first-tool')

    sendKey(capture.opened[0]!, '\r')
    await vi.waitFor(() => { expect(capture.open).toHaveBeenCalledTimes(2) })
    expect(overlayText(capture.opened[1]!)).toContain('Tool: second-tool')

    sendKey(capture.opened[1]!, '\x1b[B')
    expect(capture.open).toHaveBeenCalledTimes(2)
    expect(overlayText(capture.opened[1]!)).toContain('› 2. Reject')
    sendKey(capture.opened[1]!, '\r')
    await vi.waitFor(() => { expect(capture.open).toHaveBeenCalledTimes(3) })
    expect(overlayText(capture.opened[2]!)).toContain('Tool: third-tool')

    sendKey(capture.opened[2]!, '\x1b')
    await expect(Promise.all(outcomes)).resolves.toEqual([
      'allowed-once',
      'rejected',
      'cancelled',
    ])
    expectAuditPairs(agent.session, ['allowed-once', 'rejected', 'cancelled'])

    queue.unregister()
    await ctx.fiber.dispose()
  })

  it('cancels an aborted active approval and promotes the next queued request', async () => {
    const ctx = await approvalContext()
    const agent = testAgent(ctx, 'approval-abort')
    const capture = overlayCapture()
    const queue = approvalQueue(ctx, agent, capture)
    const controller = new AbortController()

    const aborted = ctx.approval.request({
      agent,
      toolName: 'aborted-tool',
      signal: controller.signal,
    })
    const promoted = ctx.approval.request({ agent, toolName: 'promoted-tool' })
    await vi.waitFor(() => { expect(capture.open).toHaveBeenCalledTimes(1) })
    expect(overlayText(capture.opened[0]!)).toContain('Tool: aborted-tool')

    controller.abort()
    await expect(aborted).resolves.toBe('cancelled')
    await vi.waitFor(() => { expect(capture.open).toHaveBeenCalledTimes(2) })
    expect(overlayText(capture.opened[1]!)).toContain('Tool: promoted-tool')
    sendKey(capture.opened[1]!, '\r')

    await expect(promoted).resolves.toBe('allowed-once')
    expectAuditPairs(agent.session, ['cancelled', 'allowed-once'])

    queue.unregister()
    await ctx.fiber.dispose()
  })

  it('keeps approval dialogs and audit pairs isolated to their exact agents', async () => {
    const ctx = await approvalContext()
    const firstAgent = testAgent(ctx, 'approval-scope-first')
    const secondAgent = testAgent(ctx, 'approval-scope-second')
    const firstCapture = overlayCapture()
    const secondCapture = overlayCapture()
    const firstQueue = approvalQueue(ctx, firstAgent, firstCapture)
    const secondQueue = approvalQueue(ctx, secondAgent, secondCapture)

    const secondOutcome = ctx.approval.request({
      agent: secondAgent,
      toolName: 'second-agent-tool',
    })
    await vi.waitFor(() => { expect(secondCapture.open).toHaveBeenCalledTimes(1) })
    expect(firstCapture.open).not.toHaveBeenCalled()
    expect(overlayText(secondCapture.opened[0]!)).toContain('Tool: second-agent-tool')

    const firstOutcome = ctx.approval.request({
      agent: firstAgent,
      toolName: 'first-agent-tool',
    })
    await vi.waitFor(() => { expect(firstCapture.open).toHaveBeenCalledTimes(1) })
    expect(secondCapture.open).toHaveBeenCalledTimes(1)
    expect(overlayText(firstCapture.opened[0]!)).toContain('Tool: first-agent-tool')

    sendKey(secondCapture.opened[0]!, '\r')
    sendKey(firstCapture.opened[0]!, '\x1b[B')
    sendKey(firstCapture.opened[0]!, '\r')
    await expect(Promise.all([firstOutcome, secondOutcome])).resolves.toEqual([
      'rejected',
      'allowed-once',
    ])
    expectAuditPairs(firstAgent.session, ['rejected'])
    expectAuditPairs(secondAgent.session, ['allowed-once'])

    firstQueue.unregister()
    secondQueue.unregister()
    await ctx.fiber.dispose()
  })
})
