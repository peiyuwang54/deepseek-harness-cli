/**
 * Editor autocomplete provider merging path-only file candidates and optional
 * session-reference snapshots with the base slash-command completions.
 * @module @deepseek-ai/dsh-tui/chat/autocomplete
 */

import {
  CombinedAutocompleteProvider,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  formatSessionReferenceMention,
  type SessionReferenceResolver,
} from '@deepseek-ai/dsh-session-reference'
import { displayInlineText } from '../components/text.ts'
import { activeAtToken, formatFileMention, WorkspaceFileSearch } from './file-autocomplete.ts'

/** Merge path-only file candidates and optional session snapshots with commands. */
export class ReferenceAutocompleteProvider implements AutocompleteProvider {
  constructor(
    private readonly base: CombinedAutocompleteProvider,
    private readonly files: WorkspaceFileSearch,
    private readonly sessions: SessionReferenceResolver | undefined,
    private readonly agent: Agent,
  ) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const basePromise = this.base.getSuggestions(lines, cursorLine, cursorCol, options)
    const currentLine = lines[cursorLine]
    /* v8 ignore next -- Editor always supplies its current state line. */
    if (currentLine === undefined) return basePromise
    const token = activeAtToken(currentLine, cursorCol)
    if (token === undefined) {
      this.files.invalidate()
      return basePromise
    }
    const filePromise = this.files.list(token.query, options.signal).catch(() => [])
    const sessionPromise = this.sessions === undefined || token.quoted
      ? Promise.resolve([])
      : this.sessions.listCandidates(this.agent, token.query, undefined, options.signal).catch(() => [])
    const [base, fileCandidates, sessionCandidates] = await Promise.all([
      basePromise,
      filePromise,
      sessionPromise,
    ])
    if (options.signal.aborted) return base
    const fileItems: AutocompleteItem[] = fileCandidates.flatMap((candidate) => {
      const value = formatFileMention(candidate, token.quoted)
      if (value === undefined) return []
      const name = candidate.path.slice(candidate.path.lastIndexOf('/') + 1)
      const directory = candidate.kind === 'directory'
      return [{
        value,
        label: `${directory ? 'Folder' : 'File'} · ${displayInlineText(name)}${directory ? '/' : ''}`,
        description: displayInlineText(candidate.path),
      }]
    })
    const sessionItems: AutocompleteItem[] = sessionCandidates.map((candidate) => {
      const mentionLabel = displayInlineText(candidate.label)
      const sessionId = displayInlineText(candidate.sessionId)
      const location = candidate.cwd === undefined ? '(no cwd)' : displayInlineText(candidate.cwd)
      const description = `${candidate.label === candidate.sessionId ? '' : `${sessionId} · `}${location} · ${new Date(candidate.createdAt).toISOString()}`
      return {
        value: formatSessionReferenceMention({ sessionId: candidate.sessionId, label: mentionLabel }),
        label: `Session · ${mentionLabel}`,
        description,
      }
    })
    const items = [...fileItems, ...sessionItems]
    if (items.length === 0) return base
    return { items: [...items, ...(base?.items ?? [])], prefix: token.prefix }
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return this.base.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    return this.base.shouldTriggerFileCompletion(lines, cursorLine, cursorCol)
  }
}
