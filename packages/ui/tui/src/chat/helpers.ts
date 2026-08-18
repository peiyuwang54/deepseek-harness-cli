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
  type Component,
} from '@earendil-works/pi-tui'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  sanitizePastedText,
} from '../components/text.ts'

/** Software cursor cadence, independent of the terminal profile's blink preference. */
export const CURSOR_BLINK_INTERVAL_MS = 530

/** Remove pi-tui's inverse-video cursor cell while preserving its IME marker. */
function hideRenderedEditorCursor(line: string): string {
  const markerIndex = line.indexOf(CURSOR_MARKER)
  if (markerIndex < 0) return line
  const contentIndex = markerIndex + CURSOR_MARKER.length
  const before = line.slice(0, contentIndex)
  const after = line.slice(contentIndex)
  return `${before}${after.replace(/^\x1b\[7m([^\x1b]*)\x1b\[0m/u, '$1')}`
}

/** Minimal Codex-style composer with a placeholder that never becomes editable content. */
export class HintEditor extends Editor {
  /** Placeholder shown in the empty input row; `undefined` hides it. */
  hint: string | undefined
  /** Prompt text rendered before the placeholder, matching the live prompt width. */
  hintPrefix = ''
  /** Current keyboard guidance shown below the input row. */
  frameFooter = 'Enter send · Shift+Enter newline'
  /** Whether keyboard guidance is visible; modal prompts temporarily reclaim its rows. */
  frameVisible = true
  /** Low-contrast surface shared with submitted user-message records. */
  surface: (text: string) => string = text => text
  /** Whether the focused editor renders a caret at all. */
  cursorEnabled = true
  /** Current software cursor phase; the chat lifecycle toggles it while this editor owns focus. */
  cursorVisible = true
  /** Optional consumer for a complete bracketed paste that names one local image path. */
  onPasteImagePath: ((text: string) => boolean) | undefined

  override handleInput(data: string): void {
    if (this.onPasteImagePath !== undefined
      && data.startsWith(BRACKETED_PASTE_START)
      && data.endsWith(BRACKETED_PASTE_END)) {
      const pasted = sanitizePastedText(data.slice(BRACKETED_PASTE_START.length, -BRACKETED_PASTE_END.length))
      if (this.onPasteImagePath(pasted)) return
    }
    super.handleInput(data)
  }

  override render(width: number): string[] {
    const contentWidth = Math.max(1, width - 2)
    const lines = super.render(contentWidth)
    if (this.focused && (!this.cursorEnabled || !this.cursorVisible)) {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (line !== undefined) lines[index] = hideRenderedEditorCursor(line)
      }
    }
    if (this.hint !== undefined && this.getText() === '') {
      const content = lines[0]
      /* v8 ignore next -- Editor always renders one content row. */
      if (content !== undefined) {
        const padding = ' '.repeat(this.getPaddingX())
        /* v8 ignore next -- the mounted editor is focused whenever its empty-input hint is rendered. */
        // Reserve one stable cell in both phases so the placeholder never
        // shifts as the focused caret appears and disappears.
        const cursor = this.focused && this.cursorEnabled
          ? `${CURSOR_MARKER}${this.cursorVisible ? '│' : ' '}`
          : ''
        const available = Math.max(
          0,
          contentWidth - visibleWidth(padding) - visibleWidth(this.hintPrefix) - visibleWidth(cursor),
        )
        const placeholder = truncateToWidth(this.hint, available, '')
        const used = visibleWidth(padding) + visibleWidth(this.hintPrefix) + visibleWidth(cursor) + visibleWidth(placeholder)
        lines[0] = `${padding}${this.hintPrefix}${cursor}${placeholder}${' '.repeat(Math.max(0, contentWidth - used))}`
      }
    }
    if (!this.frameVisible) return lines
    const surfaced = [
      this.surface(' '.repeat(width)),
      ...lines.map((line) => {
        const clipped = truncateToWidth(line, contentWidth, '')
        return this.surface(` ${clipped}${' '.repeat(Math.max(0, contentWidth - visibleWidth(clipped)))} `)
      }),
      this.surface(' '.repeat(width)),
    ]
    const footer = truncateToWidth(`  ${this.frameFooter}`, width, '')
    return [...surfaced, this.borderColor(footer)]
  }
}

/** Editor-owned autocomplete projection mounted directly below the composer. */
export class EditorAutocompletePanel implements Component {
  constructor(private readonly editor: HintEditor) {}

  render(width: number): string[] {
    return this.editor.renderAutocomplete(width)
  }

  invalidate(): void {
    this.editor.invalidate()
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
