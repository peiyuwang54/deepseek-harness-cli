/** Durable per-session additional writable roots. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Replaces the session's additional workspace-write roots. The roots are
     * absolute canonical directories; the session cwd remains the primary
     * root. This event is log-only and reconstructed by
     * {@link effectiveAdditionalWritableRoots}.
     */
    'sandbox/writable-roots': { roots: string[] }
  }
}

/**
 * Fold the last complete additional-root snapshot from a session log.
 * @param events - Session events in log order.
 * @returns a detached root array, empty when no snapshot exists.
 */
export function effectiveAdditionalWritableRoots(events: readonly SessionEvent[]): string[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'sandbox/writable-roots') return [...event.data.roots]
  }
  return []
}

/**
 * Replace one session's additional writable roots with one durable snapshot.
 * @param session - Session whose future workspace-write calls use the roots.
 * @param roots - Validated absolute canonical directories.
 */
export function setAdditionalWritableRoots(session: Session, roots: readonly string[]): void {
  session.append('sandbox/writable-roots', { roots: [...roots] })
}
