/**
 * Zero-state helpers for the interactive chat channel: prompt-directory and
 * Git-branch formatting, transcript/tool-call derivations over the session log,
 * session-reference context cards, the placeholder editor, and banner-reveal
 * timing constants. None of these close over channel state.
 * @module @deepseek-ai/dsh-tui/chat/helpers
 */

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  CURSOR_MARKER,
  Editor,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/** Editor that shows a placeholder without making it editable content. */
export class HintEditor extends Editor {
  /** Placeholder shown in the empty input row; `undefined` hides it. */
  hint: string | undefined
  /** Prompt text rendered before the placeholder, matching the live prompt width. */
  hintPrefix = ''

  override render(width: number): string[] {
    const lines = super.render(width)
    if (this.hint === undefined || this.getText() !== '') return lines
    const content = lines[0]
    /* v8 ignore next -- Editor always renders one content row. */
    if (content === undefined) return lines
    const padding = ' '.repeat(this.getPaddingX())
    /* v8 ignore next -- the mounted editor is focused whenever its empty-input hint is rendered. */
    const marker = this.focused ? CURSOR_MARKER : ''
    const available = Math.max(0, width - visibleWidth(padding) - visibleWidth(this.hintPrefix))
    const placeholder = truncateToWidth(this.hint, available, '')
    const used = visibleWidth(padding) + visibleWidth(this.hintPrefix) + visibleWidth(placeholder)
    lines[0] = `${padding}${this.hintPrefix}${marker}${placeholder}${' '.repeat(Math.max(0, width - used))}`
    return lines
  }
}

/**
 * Format the session working directory as a prompt label: `~` for home,
 * `~/rel` for a home-relative path, the raw path otherwise.
 * @param cwd - operational working directory from the session header.
 * @returns unescaped prompt label.
 */
export function formatCwd(cwd: string | undefined): string {
  if (cwd === undefined) return 'cwd unset'
  const home = homedir()
  const rel = relative(resolve(home), resolve(cwd))
  if (rel === '') return '~'
  /* v8 ignore next -- Windows cross-drive coverage; POSIX relative() cannot return an absolute path. */
  if (isAbsolute(rel)) return cwd
  if (rel !== '..' && !rel.startsWith(`..${sep}`)) return `~${sep}${rel}`
  return cwd
}

/**
 * Resolve the current Git branch for the prompt context line.
 * @param cwd - operational working directory to query.
 * @returns branch name, or `undefined` outside a worktree or on any failure.
 */
export function gitBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf8',
      env: scrubbedParentEnv(),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1_000,
    }).trim()
    /* v8 ignore next -- detached-HEAD behavior is exercised by the runtime smoke, not the unit checkout. */
    return branch === '' ? undefined : branch
  } catch (_gitUnavailableOrOutsideWorktree) {
    return undefined
  }
}

/**
 * Tool-call ids whose owning assistant message is append-origin, so its tool
 * cards stay paired in the transcript after a replacement shadowed the message
 * on the model surface.
 * @param session - session whose events to scan.
 * @returns the set of transcript tool-call ids.
 */
export function transcriptToolCallIds(session: Session): Set<string> {
  const ids = new Set<string>()
  for (const event of session.events) {
    if (event.type !== 'assistant/message' || !isAppendSurfaceEvent(event)) continue
    for (const block of event.data.message.content) {
      if (block.type === 'tool-call') ids.add(block.id)
    }
  }
  return ids
}

/**
 * Whether an event is a landed compaction checkpoint. Recognition goes through
 * {@link isCompactCheckpointSource} — the compaction seam's backend-independent
 * contract for the source every backend stamps on its replacement user message —
 * rather than the shape of the replacement. Other replacements (a pruned
 * `tool/result`, a regenerated `assistant/message`) rewrite one node for the
 * model and mark no boundary in the conversation.
 *
 * Both current call sites already test the replacement themselves. The check
 * keeps the exported predicate true to its name for a third caller, rather than
 * making that caller repeat it.
 * @param event - event to test.
 * @returns true when the event compacted a surface range.
 */
export function isCompactCheckpoint(event: SessionEvent): boolean {
  return event.type === 'user/message'
    && isCompactCheckpointSource(event.data.source)
    && isReplacementSurfaceEvent(event)
}

/**
 * Read a session-reference context card's display labels from an event source.
 * @param source - event source to inspect.
 * @returns per-reference labels, or `undefined` when the source is not a reference card.
 */
export function sessionReferenceCard(source: unknown): string[] | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const record = source as Record<string, unknown>
  if (record['kind'] !== 'session-reference' || !Array.isArray(record['references'])) return undefined
  const references = record['references'] as unknown[]
  const labels: string[] = []
  for (const reference of references) {
    if (typeof reference !== 'object' || reference === null) return undefined
    const entry = reference as Record<string, unknown>
    const sessionId = entry['sessionId']
    const label = entry['label']
    if (typeof sessionId !== 'string' || typeof label !== 'string') return undefined
    labels.push(label === sessionId ? sessionId : `${label} (${sessionId})`)
  }
  return labels
}

/** Milliseconds between banner sweep-reveal frames (~60 fps). */
export const BANNER_REVEAL_INTERVAL_MS = 15

/** Number of sweep frames the banner reveal spreads the terminal width over. */
export const BANNER_REVEAL_STEPS = 24
