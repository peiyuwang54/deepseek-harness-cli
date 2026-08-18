/** Stable JSONL projection for non-interactive DeepSeek runs. */

import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'

/** One JSON value writer; the caller owns line framing and the output stream. */
export type ExecJsonWriter = (value: Readonly<Record<string, unknown>>) => void

interface UsageTotals {
  input_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
}

function emptyUsage(): UsageTotals {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  }
}

function addUsage(total: UsageTotals, usage: TokenUsage): void {
  total.input_tokens += usage.inputTokens
  total.cached_input_tokens += usage.cacheReadTokens ?? 0
  total.cache_write_input_tokens += usage.cacheWriteTokens ?? 0
  total.output_tokens += usage.outputTokens
  total.reasoning_output_tokens += usage.reasoningTokens ?? 0
}

function textOf(blocks: readonly ContentBlock[], type: 'text' | 'reasoning'): string {
  let text = ''
  for (const block of blocks) {
    if ((block.type === 'text' || block.type === 'reasoning') && block.type === type) text += block.text
  }
  return text
}

function reasonMessage(reason: TurnEndReason): string {
  switch (reason.kind) {
    case 'error': return `${reason.error.code}: ${reason.error.message}`
    case 'aborted': return `turn aborted (${reason.reason.kind})`
    case 'blocked': return 'turn blocked before execution'
    case 'max-tokens': return 'turn reached the model output-token limit'
    case 'interrupted': return 'turn was interrupted before this process resumed it'
    case 'completed': return 'turn completed'
    default: return `turn ended with ${String((reason as { kind: unknown }).kind)}`
  }
}

/**
 * Project durable Session events into the Codex-compatible top-level exec
 * lifecycle (`thread.*`, `turn.*`, and `item.*`) with DeepSeek-owned item data.
 */
export class ExecJsonlEmitter {
  private usage = emptyUsage()
  private pendingTurnEnd: TurnEndReason | undefined

  constructor(private readonly write: ExecJsonWriter) {}

  /**
   * Emit the first line identifying the fresh or resumed durable thread.
   * @param threadId - durable Session identity.
   */
  threadStarted(threadId: string): void {
    this.write({ type: 'thread.started', thread_id: threadId })
  }

  /**
   * Emit one structured final result captured through an output schema.
   * @param value - committed schema-valid result.
   */
  structuredResult(value: unknown): void {
    this.write({
      type: 'item.completed',
      item: { id: 'structured_output', type: 'agent_message', text: JSON.stringify(value) },
    })
  }

  /**
   * Emit an unrecoverable runner failure while preserving valid JSONL framing.
   * @param message - user-facing failure text.
   */
  error(message: string): void {
    this.write({ type: 'error', message })
  }

  /**
   * Close the projected turn after every final result item has been emitted.
   * @param error - command-level failure that replaces the durable turn outcome.
   */
  finish(error?: string): void {
    const reason = this.pendingTurnEnd
    this.pendingTurnEnd = undefined
    if (error !== undefined) {
      this.write({ type: 'turn.failed', error: { message: error } })
      return
    }
    if (reason?.kind === 'completed') {
      this.write({ type: 'turn.completed', usage: this.usage })
      return
    }
    if (reason !== undefined) {
      this.write({ type: 'turn.failed', error: { message: reasonMessage(reason) } })
    }
  }

  /**
   * Project one event from the run's owned live interval.
   * @param event - durable Session event to inspect.
   */
  event(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        if (this.pendingTurnEnd !== undefined) this.finish()
        this.usage = emptyUsage()
        this.write({ type: 'turn.started' })
        return
      case 'assistant/message': {
        if (event.data.usage !== undefined) addUsage(this.usage, event.data.usage)
        const reasoning = textOf(event.data.message.content, 'reasoning')
        if (reasoning !== '') {
          this.write({
            type: 'item.completed',
            item: { id: `reasoning_${event.seq}`, type: 'reasoning', text: reasoning },
          })
        }
        const text = textOf(event.data.message.content, 'text')
        if (text !== '') {
          this.write({
            type: 'item.completed',
            item: { id: `message_${event.seq}`, type: 'agent_message', text },
          })
        }
        return
      }
      case 'tool/call':
        this.write({
          type: 'item.started',
          item: {
            id: String(event.data.callId),
            type: 'tool_call',
            name: event.data.name,
            arguments: event.data.arguments,
            status: 'in_progress',
          },
        })
        return
      case 'tool/result': {
        const result = event.data.message.content[0]
        this.write({
          type: 'item.completed',
          item: {
            id: String(result.toolCallId),
            type: 'tool_call',
            status: result.isError !== true ? 'completed' : 'failed',
            content: result.content,
            ...event.data.error === undefined ? {} : { error: event.data.error },
          },
        })
        return
      }
      case 'todo/write':
        this.write({
          type: 'item.updated',
          item: { id: 'todo', type: 'todo_list', items: event.data.todos },
        })
        return
      case 'turn/end':
        this.pendingTurnEnd = event.data.reason
        return
      // Raw chunks and product-specific log records remain durable but do not
      // become public exec items. New merge-extensible event types follow the
      // same default until this projection owns a stable representation.
      default:
        return
    }
  }
}
