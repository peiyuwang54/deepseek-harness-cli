/**
 * Promotion of one live agent turn into the shared background-job registry.
 * The job follows that durable turn boundary rather than whole-agent idle, so
 * later queued turns do not extend its lifetime or enter its output stream.
 * @module @deepseek-ai/dsh-tui/chat/background-turn
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobAdoption, JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { contentText } from '../components/content.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'agent-turn': 'agent-turn'
  }
}

/** Convert one durable turn reason to the generic job outcome. */
function turnOutcome(reason: TurnEndReason): JobOutcome {
  switch (reason.kind) {
    case 'completed': return { status: 'completed' }
    case 'aborted': return { status: 'killed', detail: reason.reason.kind }
    case 'interrupted': return { status: 'killed', detail: 'interrupted' }
    case 'error': return { status: 'failed', detail: reason.error.message }
    case 'blocked': return { status: 'completed', detail: 'blocked' }
    case 'max-tokens': return { status: 'completed', detail: 'max-tokens' }
    default:
      // TurnEndReasonMap is plugin-extensible. Unknown terminal reasons still
      // denote a normally released turn unless their owner maps them earlier.
      return { status: 'completed', detail: (reason as { kind: string }).kind }
  }
}

/** Render the human-readable output contribution of one target-turn event. */
function outputOf(event: SessionEvent, turn: number): string {
  if (event.type === 'assistant/chunk' && event.data.turn === turn
    && event.data.chunk.type === 'text-delta') {
    return event.data.chunk.text
  }
  if (event.type === 'tool/result' && event.data.turn === turn) {
    const result = event.data.message.content[0]
    const text = contentText(result.content)
    return text === '' ? '' : `\n${text}\n`
  }
  return ''
}

/** A prepared adoption plus cleanup for a registry preflight rejection. */
export interface AgentTurnAdoption {
  /** Registry-facing declaration for the already-running turn. */
  spec: JobAdoption
  /** Stop observing the turn when the registry declines to adopt it. */
  abandon(): void
}

/**
 * Describe an already-running turn for {@link import('@deepseek-ai/dsh-jobs').JobRegistry.adopt}.
 * @param ctx - context that publishes this agent's session events.
 * @param agent - exact live owner of the running turn.
 * @param turn - durable turn number to follow.
 * @param firstEventSeq - first event after the turn's `turn/start` marker.
 * @param label - one-line job label shown by controls.
 * @returns adoption spec whose stream reads and settlement end at this turn,
 * plus cleanup for a failed registry preflight.
 */
export function agentTurnAdoption(
  ctx: Context,
  agent: Agent,
  turn: number,
  firstEventSeq: number,
  label: string,
): AgentTurnAdoption {
  let readSeq = firstEventSeq
  let settled = false
  let settle!: (outcome: JobOutcome) => void
  const done = new Promise<JobOutcome>((resolve) => { settle = resolve })
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session || event.type !== 'turn/end' || event.data.turn !== turn) return
    if (settled) return
    settled = true
    dispose()
    settle(turnOutcome(event.data.reason))
  })

  return {
    abandon() {
      if (settled) return
      settled = true
      dispose()
    },
    spec: {
      kind: 'agent-turn',
      label,
      owner: agent,
      hooks: {
        cancel: () => { agent.cancel({ kind: 'user' }) },
        done,
        readOutput: () => {
          const events = agent.session.events.slice(readSeq)
          readSeq = agent.session.seq
          return events.map(event => outputOf(event, turn)).join('')
        },
      },
    },
  }
}
