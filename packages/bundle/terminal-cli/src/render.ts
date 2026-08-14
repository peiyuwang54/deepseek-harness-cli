/** Session-event renderers for interactive, human exec, and JSONL exec output. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { TerminalCliIo } from './io.ts'
import { boundText, sanitizeTerminal } from './io.ts'

/** Stable public JSONL event vocabulary emitted by `dsh exec --json`. */
export type TerminalCliJsonEvent =
  | {
    schemaVersion: 1
    type: 'thread.started'
    threadId: string
    cwd: string
    provider: string
    model: string
  }
  | {
    schemaVersion: 1
    type: 'turn.started'
    threadId: string
    turn: number
    seq: number
  }
  | {
    schemaVersion: 1
    type: 'item.updated'
    threadId: string
    turn: number
    seq: number
    item: { id: string; type: 'agent_message'; delta: string }
  }
  | {
    schemaVersion: 1
    type: 'item.started'
    threadId: string
    turn: number
    seq: number
    item: { id: string; type: 'tool_call'; name: string; title: string }
  }
  | {
    schemaVersion: 1
    type: 'item.completed'
    threadId: string
    turn: number
    seq: number
    item:
        | { id: string; type: 'tool_call'; name: string; title: string; failed: boolean; output?: string }
        | { id: string; type: 'agent_message'; text: string }
  }
  | {
    schemaVersion: 1
    type: 'turn.completed'
    threadId: string
    turn: number
    seq: number
  }
  | {
    schemaVersion: 1
    type: 'turn.failed'
    threadId: string
    turn: number
    seq: number
    reason: string
    error?: { code: string; message: string }
  }

/** Which process-output contract this renderer serves. */
export type RenderMode = 'interactive' | 'exec-human' | 'exec-json'

interface PresentedCall {
  name: string
  args: unknown
  title: string
}

/** Safely parse model-produced tool arguments for pure presentation. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Join visible text from model-facing content blocks. */
function textContent(content: readonly ContentBlock[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Prefer a tool's pure call presenter, with the registered name as fallback. */
function callView(ctx: Context, agent: Agent, event: SessionEvent<'tool/call'>): PresentedCall {
  const args = parseArguments(event.data.arguments)
  const definition = ctx.tools.get(event.data.name, agent)
  let view: ToolCallView | undefined
  try {
    view = definition?.presentCall?.(args)
  } catch {
    view = undefined
  }
  return {
    name: event.data.name,
    args,
    title: view?.title ?? event.data.name,
  }
}

/** Resolve the completed view for a previously seen call. */
function resultView(
  ctx: Context,
  agent: Agent,
  call: PresentedCall,
  event: SessionEvent<'tool/result'>,
): ToolResultView | undefined {
  const block = event.data.message.content[0]
  const definition = ctx.tools.get(call.name, agent)
  try {
    return definition?.presentResult?.(call.args, {
      content: block.content,
      isError: block.isError === true,
      ...event.data.meta === undefined ? {} : { meta: event.data.meta },
    })
  } catch {
    return undefined
  }
}

/** Bounded human detail plus JSON summary from a completed tool result. */
function resultSummary(view: ToolResultView | undefined, fallback: string): { title?: string; output: string } {
  if (view === undefined) return { output: boundText(fallback.trim(), 2_000) }
  switch (view.card) {
    case 'terminal':
      return {
        ...view.title === undefined ? {} : { title: view.title },
        output: boundText((view.output ?? '').trim(), 4_000),
      }
    case 'generic':
      return {
        ...view.title === undefined ? {} : { title: view.title },
        output: boundText(textContent(view.content ?? []).trim() || fallback.trim(), 2_000),
      }
    case 'diff':
      return {
        ...view.title === undefined ? {} : { title: view.title },
        output: view.diffs.map(diff => diff.path).join(', '),
      }
    case 'read':
      return {
        ...view.title === undefined ? {} : { title: view.title },
        output: `${view.path}: ${view.lines.length}/${view.totalLines} lines`,
      }
    case 'search':
      return {
        ...view.title === undefined ? {} : { title: view.title },
        output: `${view.total} result${view.total === 1 ? '' : 's'}${view.truncated ? ' (truncated)' : ''}`,
      }
    case 'web':
      return {
        ...view.title === undefined ? {} : { title: view.title },
        output: view.kind === 'search'
          ? `${view.sources.length} source${view.sources.length === 1 ? '' : 's'}${view.truncated ? ' (truncated)' : ''}`
          : `${view.url} (${view.statusCode})`,
      }
    default:
      return { output: boundText(fallback.trim(), 2_000) }
  }
}

/** Stateful event renderer attached to one exact live Agent. */
export class TerminalSessionRenderer {
  private readonly calls = new Map<string, PresentedCall>()
  private readonly streamedSteps = new Set<string>()
  private assistantLineOpen = false
  private latestTurn: { turn: number; seq: number } | undefined
  private pendingEnd: SessionEvent<'turn/end'> | undefined
  private terminalWritten = false
  private readonly disposeListener: () => void

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    private readonly io: TerminalCliIo,
    private readonly mode: RenderMode,
    selection: { provider: string; model: string },
  ) {
    if (mode === 'exec-json') {
      this.writeJson({
        schemaVersion: 1,
        type: 'thread.started',
        threadId: String(agent.id),
        cwd: agent.session.header.cwd ?? process.cwd(),
        provider: selection.provider,
        model: selection.model,
      })
    }
    this.disposeListener = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      try {
        this.render(event)
      } catch (error: unknown) {
        io.stderr.write(`dsh: renderer: ${sanitizeTerminal(error instanceof Error ? error.message : String(error))}\n`)
      }
    })
  }

  /** Stop observing before the live Agent is disposed. */
  dispose(): void {
    this.endAssistantLine()
    this.disposeListener()
  }

  /**
   * Commit the single JSON terminal record after Session flush and disposal
   * have both succeeded. Human renderers have no terminal protocol record.
   */
  finish(): void {
    if (this.mode !== 'exec-json' || this.terminalWritten) return
    this.terminalWritten = true
    const event = this.pendingEnd
    if (event === undefined) {
      this.writeJson({
        schemaVersion: 1, type: 'turn.failed', threadId: String(this.agent.id),
        turn: 0, seq: this.agent.session.seq, reason: 'no-turn',
      })
      return
    }
    if (event.data.reason.kind === 'completed') {
      this.writeJson({
        schemaVersion: 1, type: 'turn.completed', threadId: String(this.agent.id),
        turn: event.data.turn, seq: event.seq,
      })
      return
    }
    this.writeJson({
      schemaVersion: 1, type: 'turn.failed', threadId: String(this.agent.id),
      turn: event.data.turn, seq: event.seq, reason: event.data.reason.kind,
      ...event.data.reason.kind === 'error'
        ? { error: { code: event.data.reason.error.code, message: event.data.reason.error.message } }
        : {},
    })
  }

  /**
   * Commit one durable-session failure with this renderer's real identity.
   * @param message - sanitized process-facing failure detail.
   */
  fail(message: string): void {
    if (this.mode !== 'exec-json' || this.terminalWritten) return
    this.terminalWritten = true
    let turn = 0
    let seq = this.agent.session.seq
    if (this.pendingEnd !== undefined) {
      turn = this.pendingEnd.data.turn
      seq = this.pendingEnd.seq
    } else if (this.latestTurn !== undefined) {
      turn = this.latestTurn.turn
      seq = this.latestTurn.seq
    }
    this.writeJson({
      schemaVersion: 1, type: 'turn.failed', threadId: String(this.agent.id),
      turn,
      seq,
      reason: 'error', error: { code: 'CLI_ERROR', message },
    })
  }

  private progress(text: string): void {
    const output = this.mode === 'interactive' ? this.io.stdout : this.io.stderr
    output.write(sanitizeTerminal(text))
  }

  private writeJson(event: TerminalCliJsonEvent): void {
    this.io.stdout.write(`${JSON.stringify(event)}\n`)
  }

  private endAssistantLine(): void {
    if (!this.assistantLineOpen) return
    this.progress('\n')
    this.assistantLineOpen = false
  }

  private render(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.latestTurn = { turn: event.data.turn, seq: event.seq }
        if (this.mode === 'exec-json') {
          this.writeJson({
            schemaVersion: 1, type: 'turn.started', threadId: String(this.agent.id),
            turn: event.data.turn, seq: event.seq,
          })
        }
        return
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if (chunk.type !== 'text-delta' || chunk.text === '') return
        const stepKey = `${event.data.turn}:${event.data.step}`
        this.streamedSteps.add(stepKey)
        if (this.mode === 'interactive') {
          if (!this.assistantLineOpen) {
            this.progress('assistant> ')
            this.assistantLineOpen = true
          }
          this.progress(chunk.text)
        } else if (this.mode === 'exec-json') {
          this.writeJson({
            schemaVersion: 1, type: 'item.updated', threadId: String(this.agent.id),
            turn: event.data.turn, seq: event.seq,
            item: { id: `message-${event.data.turn}-${event.data.step}`, type: 'agent_message', delta: chunk.text },
          })
        }
        return
      }
      case 'assistant/message': {
        const text = textContent(event.data.message.content)
        const stepKey = `${event.data.turn}:${event.data.step}`
        if (this.mode === 'interactive' && text !== '' && !this.streamedSteps.has(stepKey)) {
          this.progress(`assistant> ${text}`)
          this.assistantLineOpen = true
        }
        if (this.mode === 'exec-json') {
          this.writeJson({
            schemaVersion: 1, type: 'item.completed', threadId: String(this.agent.id),
            turn: event.data.turn, seq: event.seq,
            item: { id: `message-${event.data.turn}-${event.data.step}`, type: 'agent_message', text },
          })
        }
        this.streamedSteps.delete(stepKey)
        this.endAssistantLine()
        return
      }
      case 'tool/call': {
        this.endAssistantLine()
        const call = callView(this.ctx, this.agent, event)
        this.calls.set(String(event.data.callId), call)
        if (this.mode === 'exec-json') {
          this.writeJson({
            schemaVersion: 1, type: 'item.started', threadId: String(this.agent.id),
            turn: event.data.turn, seq: event.seq,
            item: { id: String(event.data.callId), type: 'tool_call', name: call.name, title: call.title },
          })
        } else {
          this.progress(`→ ${call.title}\n`)
        }
        return
      }
      case 'tool/result': {
        this.endAssistantLine()
        const id = String(event.data.message.source.callId)
        const call = this.calls.get(id) ?? { name: 'tool', args: undefined, title: 'tool' }
        const block = event.data.message.content[0]
        const failed = block.isError === true || event.data.error !== undefined
        const summary = resultSummary(resultView(this.ctx, this.agent, call, event), textContent(block.content))
        const title = summary.title ?? call.title
        if (this.mode === 'exec-json') {
          this.writeJson({
            schemaVersion: 1, type: 'item.completed', threadId: String(this.agent.id),
            turn: event.data.turn, seq: event.seq,
            item: {
              id, type: 'tool_call', name: call.name, title, failed,
              ...summary.output === '' ? {} : { output: summary.output },
            },
          })
        } else {
          this.progress(`${failed ? '✗' : '✓'} ${title}\n`)
          if (summary.output !== '') this.progress(`${summary.output}\n`)
        }
        this.calls.delete(id)
        return
      }
      case 'turn/end': {
        this.endAssistantLine()
        this.calls.clear()
        this.streamedSteps.clear()
        if (this.mode === 'exec-json') {
          this.pendingEnd = event
        } else if (event.data.reason.kind === 'error') {
          this.io.stderr.write(`dsh: ${sanitizeTerminal(event.data.reason.error.code)}: ${sanitizeTerminal(event.data.reason.error.message)}\n`)
        } else if (this.mode === 'interactive' && event.data.reason.kind !== 'completed') {
          this.io.stderr.write(`dsh: turn ${sanitizeTerminal(event.data.reason.kind)}\n`)
        }
        return
      }
      default:
        return
    }
  }
}
