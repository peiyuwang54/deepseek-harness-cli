/** Agent/Session adapter shared by interactive, resume, and exec modes. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type Agent,
  type AgentHandle,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { effectiveApprovalPolicy, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { TerminalCliOverrides } from './startup.ts'

/** Result of one explicitly owned prompt-to-idle interval. */
export interface CliTurnOutcome {
  text: string
  reason: TurnEndReason | undefined
}

/**
 * Last assistant text and last turn boundary within one owned event interval.
 * @param events - complete live Session log.
 * @param firstSeq - first sequence number owned by this submitted prompt.
 * @returns the visible final text and terminal turn reason in that interval.
 */
export function summarizeTurn(events: readonly SessionEvent[], firstSeq: number): CliTurnOutcome {
  let started = false
  let text = ''
  let reason: TurnEndReason | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const visible = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (visible !== '') text = visible
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Merge only explicit CLI model fields over a complete base selection. */
function withOverrides(base: ModelSelection, values: TerminalCliOverrides): ModelSelection {
  const provider = values.provider ?? base.provider
  const model = values.model ?? base.model
  const routeUnchanged = provider === base.provider && model === base.model
  return {
    provider,
    model,
    ...values.reasoningEffort !== undefined
      ? { reasoningEffort: ReasoningEffortId(values.reasoningEffort) }
      : !routeUnchanged || base.reasoningEffort === undefined ? {} : { reasoningEffort: base.reasoningEffort },
  }
}

/** Resolve the next-request selection from logged state, defaults, and CLI overrides. */
function selectionFor(agent: Agent, defaults: () => ModelSelection, values: TerminalCliOverrides): ModelSelection {
  const logged = agent.session.requestHeader()?.config
  const base: ModelSelection = logged === undefined
    ? defaults()
    : {
      provider: logged.provider,
      model: logged.model,
      ...logged.reasoningEffort === undefined ? {} : { reasoningEffort: logged.reasoningEffort },
    }
  return withOverrides(base, values)
}

/** Install the live logged/default/CLI precedence inside an unpublished Agent. */
function installSelection(agentCtx: Context, defaults: () => ModelSelection, values: TerminalCliOverrides): void {
  const agent = agentCtx.agent
  if (agent === undefined) throw new Error('terminal-cli: Agent setup has no scoped Agent')
  let picked: ModelSelection | undefined
  const selection: ModelSelectionRef = {
    get current(): ModelSelection {
      return picked ?? selectionFor(agent, defaults, values)
    },
    set current(next: ModelSelection | undefined) {
      picked = next
    },
    assembled: undefined,
  }
  installModelSelection(agentCtx, selection)
}

/** Resolve a resume id and reject non-root or cross-workspace adoption. */
async function resolveResumeId(ctx: Context, requested: string | undefined, cwd: string): Promise<SessionId> {
  const headers = await ctx.sessionPersistence.list()
  const candidates = headers
    .filter(header => header.origin !== 'subagent' && header.cwd === cwd)
    .sort((left, right) => right.createdAt - left.createdAt || String(right.id).localeCompare(String(left.id)))
  if (requested === undefined) {
    for (const candidate of candidates) {
      if (candidate.agentPreset !== undefined) continue
      const inspected = await ctx.sessionPersistence.inspect(candidate.id)
      if (resolveSessionPreset({ header: inspected.meta, events: inspected.events }) === undefined) {
        return candidate.id
      }
    }
    throw new Error(`no resumable Session was found in ${cwd}`)
  }
  const header = headers.find(candidate => candidate.id === requested)
  if (header === undefined) throw new Error(`Session ${JSON.stringify(requested)} was not found`)
  if (header.origin === 'subagent') {
    throw new Error(`Session ${JSON.stringify(requested)} belongs to a subagent and cannot be resumed as a terminal root`)
  }
  if (header.cwd !== cwd) {
    throw new Error(`Session ${JSON.stringify(requested)} belongs to ${header.cwd ?? '<no cwd>'}; relaunch with -C for that workspace`)
  }
  let agentPreset = header.agentPreset
  if (agentPreset === undefined) {
    const inspected = await ctx.sessionPersistence.inspect(header.id)
    agentPreset = resolveSessionPreset({ header: inspected.meta, events: inspected.events })
  }
  if (agentPreset !== undefined) {
    throw new Error(
      `Session ${JSON.stringify(requested)} uses Agent preset ${JSON.stringify(agentPreset)} and cannot be resumed by the terminal CLI profile`,
    )
  }
  return header.id
}

/** Apply independent CLI permission knobs after Session initialization pinned its defaults. */
function applyPermissionOverrides(agent: Agent, values: TerminalCliOverrides): void {
  if (values.sandbox !== undefined && effectiveSandboxMode(agent.session.events) !== values.sandbox) {
    setSandboxMode(agent.session, values.sandbox)
  }
  if (values.approval !== undefined && effectiveApprovalPolicy(agent.session.events) !== values.approval) {
    setApprovalPolicy(agent.session, values.approval)
  }
}

/** Normalize arbitrary dependency rejections before they cross the CLI boundary. */
function lifecycleError(value: unknown, operation: string): Error {
  return value instanceof Error ? value : new Error(`${operation} rejected: ${String(value)}`, { cause: value })
}

/** An owned live Session with a narrow turn/flush/dispose interface. */
export class TerminalCliSession {
  private closing: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly handle: AgentHandle,
    private readonly selected: () => ModelSelection,
  ) {}

  /** Exact live Agent owned by this terminal invocation. */
  get agent(): Agent {
    return this.handle.agent
  }

  /**
   * Complete model selection currently effective for the next request.
   * @returns the logged/default/CLI-merged selection.
   */
  selection(): ModelSelection {
    return this.selected()
  }

  /**
   * Submit exactly one ordinary follow-up and wait for whole-Agent quiescence.
   * @param text - non-empty user prompt.
   * @returns the visible final text and terminal reason for the owned interval.
   */
  async runTurn(text: string): Promise<CliTurnOutcome> {
    await this.agent.whenIdle()
    const firstSeq = this.agent.session.seq
    this.agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }))
    await this.agent.whenIdle()
    await this.ctx.sessions.flush(this.agent.session)
    return summarizeTurn(this.agent.session.events, firstSeq)
  }

  /** Cancel the active Agent operation, leaving later prompts possible. */
  cancel(): void {
    this.agent.cancel({ kind: 'user' })
  }

  /** Flush the durable log before releasing the owned live Agent. */
  close(): Promise<void> {
    this.closing ??= this.closeOnce()
    return this.closing
  }

  /** Run the one teardown attempt shared by every caller of {@link close}. */
  private async closeOnce(): Promise<void> {
    let failure: Error | undefined
    try {
      await this.agent.whenIdle()
      await this.ctx.sessions.flush(this.agent.session)
    } catch (error: unknown) {
      failure = lifecycleError(error, 'terminal CLI Session flush')
    }
    try {
      await this.handle.dispose()
    } catch (error: unknown) {
      const disposalFailure = lifecycleError(error, 'terminal CLI Agent disposal')
      if (failure === undefined) failure = disposalFailure
      else failure = new AggregateError([failure, disposalFailure], 'terminal CLI Session flush and disposal both failed')
    }
    if (failure !== undefined) throw failure
  }
}

/**
 * Create or resume the invocation's live terminal Session.
 * @param ctx - settled application context carrying Agent and persistence services.
 * @param mode - fresh interactive, one-shot exec, or persisted resume mode.
 * @param values - parsed model, permission, and optional Session overrides.
 * @returns the owned live Session adapter after initialization becomes idle.
 */
export async function openTerminalSession(
  ctx: Context,
  mode: 'interactive' | 'exec' | 'resume',
  values: TerminalCliOverrides & { sessionId?: string },
): Promise<TerminalCliSession> {
  const defaults = (): ModelSelection => ctx.agentDefaultModel.currentSelection()
  const initial = withOverrides(defaults(), values)
  const setup = (agentCtx: Context): void => { installSelection(agentCtx, defaults, values) }
  let handle: AgentHandle
  if (mode === 'resume') {
    const id = await resolveResumeId(ctx, values.sessionId, process.cwd())
    handle = await ctx.agents.resume({
      resumeSessionId: id,
      agentOptions: { provider: initial.provider, model: initial.model },
      setup,
    })
  } else {
    handle = await ctx.agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: initial.provider, model: initial.model },
      setup,
    })
  }
  await handle.agent.whenIdle()
  applyPermissionOverrides(handle.agent, values)
  return new TerminalCliSession(ctx, handle, () => selectionFor(handle.agent, defaults, values))
}
