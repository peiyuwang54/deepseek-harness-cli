/**
 * The terminal app's command-line provider. It parses `--resume`/`--yolo`, rejects a
 * non-interactive launch before the renderer can claim the terminal, and
 * publishes the immutable identity consumed by the TUI runner.
 * @module @deepseek-ai/dsh-tui-app/startup
 */

import { randomUUID } from 'node:crypto'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  MAIN_SESSION_ID_KEY,
  TUI_GOODBYE_MESSAGE_KEY,
  type MainSessionIdentity,
} from '@deepseek-ai/dsh-tui'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Launcher command-line facts required before the identity can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the terminal runner. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** Immutable process-local values shared by the terminal runner. */
export interface TuiStartupValues {
  /** Fresh or persisted identity the root TUI Agent owns. */
  readonly identity: MainSessionIdentity
  /** Whether startup must pin the session to unrestricted execution before publication. */
  readonly fullAccess: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Successful interactive-terminal startup values. */
    tuiStartup: TuiStartupValues
  }
}

/** Process boundaries replaced by command-line tests. */
export const internals: {
  stdin: { isTTY?: boolean }
  stdout: { isTTY?: boolean }
  randomUUID(): string
} = {
  stdin: process.stdin,
  stdout: process.stdout,
  randomUUID,
}

/** The terminal flag family, as Commander parsed it. */
interface TuiOptions {
  resume?: string
  yolo?: boolean
}

/**
 * Construct a fresh terminal command so repeated test boots share no state.
 * @returns the app-owned command and help text.
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh tui')
    .description('Open the interactive DeepSeek Harness terminal UI.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <session>', 'resume an existing persisted session')
    .option('--yolo', 'DANGEROUS: start with full file access and no approval prompts')
    .addHelpText('after', `
Examples:
  dsh tui                              start a fresh session
  dsh tui --resume <session>           resume a persisted session
  dsh tui --yolo                       start unrestricted without approval prompts
`)
}

/**
 * Parse and publish one terminal startup identity. Help and rejected arguments
 * publish nothing, leaving the runner pending on `tuiStartup`; a non-TTY
 * invocation requests a failing bounded shutdown through `parseCmdline`.
 * @param ctx - plugin context carrying the launcher command line and exit hook.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const { resume, yolo } = program.opts<TuiOptions>()
    if (resume !== undefined && resume.trim() === '') {
      program.error('error: --resume needs a non-empty session id')
    }
    if (internals.stdin.isTTY !== true || internals.stdout.isTTY !== true) {
      program.error('error: dsh tui requires interactive stdin and stdout TTYs; use --profile headless for pipes and automation')
    }
    const identity: MainSessionIdentity = resume === undefined
      ? { id: SessionId(`main-session-${internals.randomUUID()}`), resume: false }
      : { id: SessionId(resume), resume: true }
    // These launcher facts are also consumed by the renderer for its exit line
    // and by terminal-local extensions that need the main identity.
    ctx.provide(MAIN_SESSION_ID_KEY, identity)
    ctx.provide(TUI_GOODBYE_MESSAGE_KEY, `To resume this session: dsh tui --resume=${identity.id}`)
    ctx.provide(TUI_STARTUP_SERVICE, {
      identity,
      fullAccess: yolo === true,
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
