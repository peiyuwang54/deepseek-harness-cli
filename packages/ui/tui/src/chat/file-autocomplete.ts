/** TUI insertion syntax over the shared host-workspace index and token grammar. */
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference'
import { formatFileMention as formatMention } from '@deepseek-ai/dsh-file-reference/grammar'

export { activeAtToken } from '@deepseek-ai/dsh-file-reference/grammar'
export {
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  WorkspaceFileSearch,
} from '@deepseek-ai/dsh-file-reference-local/search'

/**
 * Format a selected path for Pi's editor, including a closing directory quote.
 * @param candidate - selected file or directory.
 * @param preserveQuote - retain an explicitly opened quote even when unnecessary.
 * @returns insertion text, or undefined for an unsafe path.
 */
export function formatFileMention(candidate: FileReferenceCandidate, preserveQuote: boolean): string | undefined {
  return formatMention(candidate.kind === 'directory'
    ? { path: candidate.path + '/', kind: 'file' }
    : candidate, preserveQuote)
}
