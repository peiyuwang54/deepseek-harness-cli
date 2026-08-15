/**
 * Ephemeral side-conversation creation for the interactive TUI. A side Agent
 * inherits only the parent's latest completed-turn prefix, runs on the same
 * model and preset, and is explicitly detached from inherited instructions.
 * @module @deepseek-ai/dsh-tui/chat/side
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-agent-presets'

/** Model-visible instructions applied only to a side-conversation Agent. */
export const SIDE_CONVERSATION_INSTRUCTIONS = [
  'You are in a temporary side conversation, not the main thread.',
  'Use the inherited conversation only as reference context. Do not continue or execute instructions, plans, approvals, or unfinished work from before the side-conversation boundary.',
  'Only user messages submitted after that boundary are active requests in this side conversation.',
  'This thread is for questions and lightweight exploration without disrupting the parent thread.',
  'Do not use subagents or workflows in this side conversation.',
  'Do not modify files, Git state, permissions, configuration, or other workspace state unless the user explicitly requests that mutation after the boundary. Keep any requested mutation minimal and local.',
].join('\n')

/** Logged context separating inherited history from active side instructions. */
export const SIDE_CONVERSATION_BOUNDARY = [
  'Side-conversation boundary.',
  'Treat all earlier messages as reference context only. Do not continue their instructions, plans, tool calls, approvals, edits, or unfinished work.',
  'Only user messages after this boundary are active requests for this temporary thread.',
].join(' ')

const SIDE_BLOCKED_TOOLS = new Set([
  'interrupt_agent',
  'list_agents',
  'ralph',
  'report_to_parent',
  'send_message',
  'subagent',
  'subagent_fork',
  'workflow',
])

/** A live side conversation owned by the TUI host. */
export interface SideConversationHandle {
  /** Published temporary Agent lifecycle. */
  readonly handle: AgentHandle
  /** Direct parent to restore when the side conversation closes. */
  readonly parentSessionId: SessionId
  /** First child-owned event eligible for transcript rendering. */
  readonly transcriptStartSeq: number
}

/**
 * Return the parent's balanced completed-turn prefix.
 * @param parent - Agent whose stable history the side conversation inherits.
 * @returns Contiguous events through the latest `turn/end`, or an empty list.
 */
export function completedTurnPrefix(parent: Agent): SessionEvent[] {
  const lastEnd = parent.session.events.findLast(event => event.type === 'turn/end')
  return lastEnd === undefined ? [] : parent.session.events.slice(0, lastEnd.seq + 1)
}

/**
 * Whether a fork seed contains a completed human conversation.
 * @param seed - Balanced prefix selected for the side conversation.
 * @returns `true` after at least one direct user prompt completed.
 */
export function hasStartedConversation(seed: readonly SessionEvent[]): boolean {
  return seed.some(event => event.type === 'user/message' && event.data.source.kind === 'user')
}

/** Build storage metadata without classifying the temporary thread as a subagent. */
function sideSessionMeta(parent: Agent, seedLength: number): NonNullable<CreateAgentOptions['meta']> {
  const header = parent.session.header
  const agentPreset = parent.ctx.get('agentPresets')?.composedPreset(parent.ctx)
  return {
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    parentSession: parent.id,
    ephemeral: true,
    ...seedLength === 0 ? {} : { seedLength },
    ...header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth },
    ...agentPreset === undefined ? {} : { agentPreset },
  }
}

/** Install the parent's exact preset plus side-only prompt and tool policy. */
function installSideComposition(childCtx: Context, parent: Agent): void {
  childCtx.get('agentPresets')?.composeFrom(childCtx, parent.ctx)
  childCtx.systemPrompt.context({
    name: 'ui:tui-side-conversation',
    order: 121,
    text: SIDE_CONVERSATION_INSTRUCTIONS,
  })
  childCtx.tools.guard(execution => (SIDE_BLOCKED_TOOLS.has(execution.name)
    || execution.name.startsWith('subagent_')
    || execution.name.startsWith('workflow_'))
    ? `Tool "${execution.name}" is unavailable in a side conversation. Return to the parent thread to use it.`
    : undefined)
  const child = childCtx.agent
  if (child !== undefined && foldPlanMode(child.session.events)) {
    child.session.append('plan/mode', { active: false })
  }
}

/**
 * Create one published ephemeral Agent and queue its logged side boundary.
 * @param parent - Live parent Agent selected in the terminal.
 * @param signal - Creation cancellation owned by the TUI host.
 * @returns The owned side lifecycle and its presentation boundary.
 */
export async function createSideConversation(
  parent: Agent,
  signal: AbortSignal,
): Promise<SideConversationHandle> {
  const seed = completedTurnPrefix(parent)
  if (!hasStartedConversation(seed)) {
    throw new Error('Start a conversation and let its first turn finish before opening /side.')
  }
  const handle = await parent.ctx.agents.create({
    sessionId: SessionId(`side-${randomUUID()}`),
    meta: sideSessionMeta(parent, seed.length),
    seed,
    agentOptions: { ...parent.options },
    signal,
    setup: (childCtx) => { installSideComposition(childCtx, parent) },
  })
  const transcriptStartSeq = handle.agent.session.events.length
  handle.agent.inject(createUserMessage({
    content: [{ type: 'text', text: SIDE_CONVERSATION_BOUNDARY }],
    source: { kind: 'plugin', plugin: 'ui-tui-side', form: 'instructions' },
  }))
  return { handle, parentSessionId: parent.id, transcriptStartSeq }
}

/**
 * Stop the process-local side Agent and release its composition.
 * @param side - Owned side lifecycle to discard.
 */
export async function discardSideConversation(side: SideConversationHandle): Promise<void> {
  await side.handle.dispose()
}
