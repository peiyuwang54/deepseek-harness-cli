/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-terminal-cli`.
 * @module @deepseek-ai/dsh-terminal-cli/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-terminal-cli'

/** Cordis companion plugin name. */
export const name = 'terminal-cli-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']

/**
 * No runtime invariant: transcript rendering, durable close, stdio routing,
 * and signal escalation cross the process boundary. The assembled launcher
 * PTY and built-entry tests own those observable contracts; there is no
 * additional mutable relation inside the Cordis tree to audit here.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant ownership companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
