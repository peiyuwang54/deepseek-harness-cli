/** Package-owned invariant companion for `@deepseek-ai/dsh-subagent-worktree`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent-worktree'

/** Cordis companion plugin name. */
export const name = 'subagent-worktree-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = (_ctx: Context, _fail) => {
  // No runtime invariant: Git state is validated at its filesystem boundary,
  // and mutations stay behind explicit merge/discard calls.
}

/** Register the package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
