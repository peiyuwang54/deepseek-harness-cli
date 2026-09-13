/** Shared fail-closed pagination state for MCP list operations. */

/**
 * Accept one continuation cursor or reject a cycle before another request.
 * @param operation - Stable operation label included in diagnostics.
 * @param cursor - Continuation cursor returned by the MCP server.
 * @param seen - Cursors already returned during this list operation.
 * @returns The cursor unchanged when it advances pagination.
 */
export function advanceMcpCursor(
  operation: string,
  cursor: string | undefined,
  seen: Set<string>,
): string | undefined {
  if (cursor === undefined) return undefined
  if (seen.has(cursor)) {
    throw new Error(`${operation}: server repeated pagination cursor ${JSON.stringify(cursor)}`)
  }
  seen.add(cursor)
  return cursor
}
