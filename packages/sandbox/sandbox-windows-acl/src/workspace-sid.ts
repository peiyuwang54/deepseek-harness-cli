/**
 * The per-root-set write identity: a deterministic `S-1-4-x-y` SID derived
 * from the sorted canonical workspace roots, whose ACEs form that root set's
 * write allowlist. Every confined execution with the same root set — across
 * sessions, server restarts, and calls — carries the SAME write SID, so each
 * root ACE materializes once per root set per machine (the
 * grant's exact-ACE skip then makes every later provision O(1)) instead of
 * once per session. The SID's power is defined solely by the ACEs that name
 * it (which exist only on the selected root trees), and only tokens minted for
 * that exact set carry it — the SID string itself is not a secret. Temporary
 * directories use a separate,
 * per-directory identity from {@link tempWriteSid}; sharing the workspace
 * identity with temp would let sibling sessions write one another's temp
 * trees.
 *
 * Inputs MUST be canonical workspace paths (`realpathSync.native` on Windows;
 * sandbox-policy resolution already applies it). Sorting and deduplication
 * make argument order irrelevant. Renaming any root derives a new SID; old
 * standing ACEs are inert residue and the next session re-propagates once.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/workspace-sid
 */

import { createHash } from 'node:crypto'

/**
 * Derive one root set's write SID (`S-1-4-x-y`; subauthorities 30-bit,
 * matching the capability shape the token and ACE layers carry).
 * @param workspaceRoots - canonical workspace paths; at least one required.
 * @returns the SDDL string form.
 */
export function workspaceWriteSid(workspaceRoots: readonly string[]): string {
  if (workspaceRoots.length === 0) throw new Error('workspaceWriteSid requires at least one root')
  const identity = JSON.stringify([...new Set(workspaceRoots)].sort())
  const digest = createHash('sha256').update('workspace-roots\0', 'utf8').update(identity, 'utf8').digest()
  const first = (digest.readUInt32LE(0) % (2 ** 30 - 1)) + 1
  const second = (digest.readUInt32LE(4) % (2 ** 30 - 1)) + 1
  return `S-1-4-${first}-${second}`
}

/**
 * Derive one private temp directory's write SID. The random directory path
 * is the capability identity; a fixed third subauthority domain-separates
 * the result from every two-subauthority workspace SID.
 * @param tempDir - the private temp directory's absolute path.
 * @returns the SDDL string form.
 */
export function tempWriteSid(tempDir: string): string {
  const digest = createHash('sha256').update('temp\0', 'utf8').update(tempDir, 'utf8').digest()
  const first = (digest.readUInt32LE(0) % (2 ** 30 - 1)) + 1
  const second = (digest.readUInt32LE(4) % (2 ** 30 - 1)) + 1
  return `S-1-4-${first}-${second}-1`
}
