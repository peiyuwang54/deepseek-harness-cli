/**
 * Complete Markdown transcript rendering and no-clobber file publication for
 * the TUI `/export` command.
 * @module @deepseek-ai/dsh-tui/chat/transcript-export
 */

import { randomUUID } from 'node:crypto'
import { link, open, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { BlockAssembler, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import { isReplacementSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'

interface MarkdownSection {
  readonly heading: 'User' | 'Assistant' | 'Reasoning' | 'Activity'
  readonly body: string
  readonly indent: boolean
}

function imageLabel(block: Extract<ContentBlock, { type: 'image' }>): string {
  return `[Image: ${block.attachment.name ?? block.attachment.attachmentId}]`
}

function unknownContentLabel(block: ContentBlock): string {
  const rawType = (block as { type?: unknown }).type
  return `[${typeof rawType === 'string' ? rawType : 'content'}]`
}

function joinedContent(blocks: readonly ContentBlock[], separator: '\n' | '\n\n'): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        if (block.text.trim() !== '') parts.push(block.text)
        break
      case 'image':
        parts.push(imageLabel(block))
        break
      case 'tool-call':
        parts.push(`${block.name}(${block.arguments})`)
        break
      case 'tool-result':
        parts.push(joinedContent(block.content, '\n'))
        break
      default:
        parts.push(unknownContentLabel(block))
        break
    }
  }
  return parts.join(separator)
}

function userContent(blocks: readonly ContentBlock[]): string {
  return joinedContent(blocks, '\n\n')
}

function activityContent(blocks: readonly ContentBlock[]): string {
  return joinedContent(blocks, '\n')
}

function appendAssistantSections(
  sections: MarkdownSection[],
  blocks: readonly ContentBlock[],
  showReasoning: boolean,
): void {
  let heading: 'Assistant' | 'Reasoning' | undefined
  let parts: string[] = []
  const flush = (): void => {
    if (heading !== undefined && parts.length > 0) {
      sections.push({ heading, body: parts.join('\n\n'), indent: false })
    }
    heading = undefined
    parts = []
  }
  for (const block of blocks) {
    let nextHeading: 'Assistant' | 'Reasoning' | undefined
    let body: string | undefined
    switch (block.type) {
      case 'text':
        nextHeading = 'Assistant'
        body = block.text
        break
      case 'reasoning':
        if (showReasoning) {
          nextHeading = 'Reasoning'
          body = block.text
        }
        break
      case 'image':
        nextHeading = 'Assistant'
        body = imageLabel(block)
        break
      case 'tool-call':
      case 'tool-result':
        break
      default:
        nextHeading = 'Assistant'
        body = unknownContentLabel(block)
        break
    }
    if (body === undefined || body.trim() === '') continue
    if (heading !== nextHeading) flush()
    heading = nextHeading
    parts.push(body)
  }
  flush()
}

function visibleToolCalls(events: readonly SessionEvent[]): Map<string, string> {
  const calls = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'assistant/message' || isReplacementSurfaceEvent(event)) continue
    for (const block of event.data.message.content) {
      if (block.type === 'tool-call') calls.set(block.id, block.name)
    }
  }
  return calls
}

function liveAssistantBlocks(events: readonly SessionEvent[]): ContentBlock[][] {
  const open = new Map<string, { assembler: BlockAssembler; order: number }>()
  const key = (turn: number, step: number): string => `${String(turn)}:${String(step)}`
  for (const event of events) {
    if (event.type === 'assistant/chunk') {
      const position = key(event.data.turn, event.data.step)
      let current = open.get(position)
      if (current === undefined) {
        current = { assembler: new BlockAssembler(), order: event.seq }
        open.set(position, current)
      }
      current.assembler.push(event.data.chunk)
      continue
    }
    if (event.type === 'assistant/message' || event.type === 'step/end' || event.type === 'llm/retry') {
      open.delete(key(event.data.turn, event.data.step))
      continue
    }
    if (event.type === 'turn/end') {
      const prefix = `${String(event.data.turn)}:`
      for (const position of open.keys()) {
        if (position.startsWith(prefix)) open.delete(position)
      }
    }
  }
  return [...open.values()]
    .sort((left, right) => left.order - right.order)
    .map(current => current.assembler.blocks())
}

function renderSections(sections: readonly MarkdownSection[]): string {
  let markdown = '# DeepSeek conversation\n'
  for (const section of sections) {
    markdown += `\n## ${section.heading}\n\n`
    if (section.indent) {
      markdown += `${section.body.split('\n').map(line => `    ${line}`).join('\n')}\n`
    } else {
      markdown += section.body.endsWith('\n') ? section.body : `${section.body}\n`
    }
  }
  return markdown
}

/**
 * Render the complete human-visible session transcript as Markdown. Direct
 * user input, visible assistant messages, paired tool activity, and the current
 * open model stream are included; injected context and model-only replacement
 * events are excluded. Reasoning follows the TUI's current disclosure setting.
 * @param events - stable snapshot of the active session log.
 * @param showReasoning - whether reasoning blocks are visible and exportable.
 * @returns complete Markdown transcript with raw message Markdown preserved.
 * @throws {Error} when the snapshot has no conversation content or an open stream cannot be assembled.
 */
export function renderMarkdownTranscript(
  events: readonly SessionEvent[],
  showReasoning: boolean,
): string {
  const sections: MarkdownSection[] = []
  const calls = visibleToolCalls(events)
  for (const event of events) {
    if (isReplacementSurfaceEvent(event)) continue
    switch (event.type) {
      case 'user/message': {
        if (event.data.source.kind !== 'user') break
        const body = userContent(event.data.content)
        if (body.trim() !== '') sections.push({ heading: 'User', body, indent: false })
        break
      }
      case 'assistant/message':
        appendAssistantSections(sections, event.data.message.content, showReasoning)
        break
      case 'tool/call': {
        if (!calls.has(event.data.callId)) break
        sections.push({
          heading: 'Activity',
          body: `${event.data.name}(${event.data.arguments})`,
          indent: true,
        })
        break
      }
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const name = calls.get(callId)
        if (name === undefined) break
        const result = event.data.message.content
          .map(block => activityContent(block.content))
          .filter(text => text.trim() !== '')
          .join('\n')
        const failed = event.data.error !== undefined
          || event.data.message.content.some(block => block.isError === true)
        sections.push({
          heading: 'Activity',
          body: [`${name} result${failed ? ' (error)' : ''}`, result].filter(Boolean).join('\n'),
          indent: true,
        })
        break
      }
      default:
        break
    }
  }
  for (const blocks of liveAssistantBlocks(events)) {
    appendAssistantSections(sections, blocks, showReasoning)
  }
  if (sections.length === 0) throw new Error('No conversation content to export.')
  return renderSections(sections)
}

/**
 * Resolve one requested transcript filename against the session workspace.
 * `~`, `~/`, and `~\` use the current user's home; other relative paths use
 * `cwd`.
 * @param cwd - active session workspace.
 * @param requestedPath - filename supplied after `/export`.
 * @returns normalized absolute destination path.
 */
export function resolveTranscriptExportPath(cwd: string, requestedPath: string): string {
  const requested = requestedPath.trim()
  if (requested === '~') return resolve(homedir())
  if (requested.startsWith('~/') || requested.startsWith('~\\')) {
    return resolve(homedir(), requested.slice(2))
  }
  return resolve(cwd, requested)
}

/**
 * Build the editable default filename used by the export dialog. Opaque session
 * ids are restricted to portable filename characters before entering the editor.
 * @param sessionId - active durable session id.
 * @returns portable Markdown filename containing a non-empty session label.
 */
export function transcriptExportFilename(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '')
  return `deepseek-session-${safe === '' ? 'session' : safe}.md`
}

/**
 * Publish a complete transcript without replacing an existing path. Data is
 * written and synced in a sibling temporary file, then exposed through one
 * no-clobber hard link. Cancellation is checked before publication.
 * @param cwd - active session workspace for relative path resolution.
 * @param requestedPath - user-supplied export filename.
 * @param markdown - complete transcript bytes to publish.
 * @param signal - command cancellation signal.
 * @returns normalized absolute destination path after publication.
 * @throws {Error} when the parent is missing, the target exists, writing fails, or cancellation wins before publication.
 */
export async function writeMarkdownTranscript(
  cwd: string,
  requestedPath: string,
  markdown: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const path = resolveTranscriptExportPath(cwd, requestedPath)
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  )
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(markdown, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    signal.throwIfAborted()
    await link(temporary, path)
    return path
  } finally {
    await rm(temporary, { force: true })
  }
}
