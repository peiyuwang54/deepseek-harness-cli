/**
 * Terminal CLI argument provider. The profile launcher hands this plugin the
 * app-owned argv snapshot; parsing publishes one immutable startup value before
 * the runner is allowed to create or resume an Agent.
 * @module @deepseek-ai/dsh-terminal-cli/startup
 */

import { Command, InvalidArgumentError, Option } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

/** Stable service name supplied to the terminal runner. */
export const TERMINAL_CLI_STARTUP_SERVICE = 'terminalCliStartup'

/** Model and permission overrides shared by every terminal mode. */
export interface TerminalCliOverrides {
  /** Provider route; omitted adopts the Session log or configured default. */
  provider?: string
  /** Provider-owned model id; omitted adopts the Session log or configured default. */
  model?: string
  /** Adapter-owned reasoning effort id. */
  reasoningEffort?: string
  /** Per-Session sandbox override. */
  sandbox?: SandboxMode
  /** Per-Session approval override. */
  approval?: ApprovalPolicy
}

/** Start a fresh multi-turn terminal Session. */
export interface InteractiveStartup extends TerminalCliOverrides {
  mode: 'interactive'
  /** Optional initial prompt words, preserved until stdin policy is known. */
  prompt: string[]
}

/** Run one fresh unattended turn. */
export interface ExecStartup extends TerminalCliOverrides {
  mode: 'exec'
  /** Prompt words; an empty list may still be satisfied by piped stdin. */
  prompt: string[]
  /** Emit stable public JSONL events instead of human progress. */
  json: boolean
}

/** Resume one stored root Session into the interactive terminal. */
export interface ResumeStartup extends TerminalCliOverrides {
  mode: 'resume'
  /** Exact Session id; omitted selects the newest Session in this cwd. */
  sessionId?: string
  /** Optional prompt submitted immediately after resume. */
  prompt: string[]
}

/** Complete terminal-app startup vocabulary. */
export type TerminalCliStartupValues = InteractiveStartup | ExecStartup | ResumeStartup

/** Parsed terminal invocation published for the runner. */
export interface TerminalCliStartup {
  /** Immutable mode and option values for this process. */
  readonly value: TerminalCliStartupValues
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Parsed terminal-app invocation, published before the runner mounts. */
    terminalCliStartup: TerminalCliStartup
  }
}

/** Cordis plugin name. */
export const name = 'terminal-cli-startup'
/** The immutable launcher argv is required before parsing. */
export const inject = ['cmdlineArgs']

/** Reject an empty model/provider-style option before Agent creation. */
function nonEmpty(value: string): string {
  if (value.trim() === '') throw new InvalidArgumentError('must not be empty')
  return value
}

/** Add the terminal options that are valid on a command. */
function commonOptions(command: Command): Command {
  return command
    .option('--provider <provider>', 'override the model provider route', nonEmpty)
    .option('-m, --model <model>', 'override the model id', nonEmpty)
    .option('--reasoning-effort <effort>', 'override the model reasoning effort', nonEmpty)
    .addOption(new Option('-s, --sandbox <mode>', 'sandbox mode for this Session')
      .choices(['read-only', 'workspace-write', 'danger-full-access']))
    .addOption(new Option('-a, --approval <policy>', 'approval policy for this Session')
      .choices(['ask', 'never']))
}

/** Read normalized common options, including root options inherited by a subcommand. */
function overrides(command: Command): TerminalCliOverrides {
  const values = command.optsWithGlobals<{
    provider?: string
    model?: string
    reasoningEffort?: string
    sandbox?: SandboxMode
    approval?: ApprovalPolicy
  }>()
  return {
    ...values.provider === undefined ? {} : { provider: values.provider },
    ...values.model === undefined ? {} : { model: values.model },
    ...values.reasoningEffort === undefined ? {} : { reasoningEffort: values.reasoningEffort },
    ...values.sandbox === undefined ? {} : { sandbox: values.sandbox },
    ...values.approval === undefined ? {} : { approval: values.approval },
  }
}

/**
 * Build a fresh parser; tests and repeated embedded boots share no commander state.
 * @param publish - callback that commits one successfully parsed startup value.
 * @returns a new terminal command tree.
 */
export function terminalCliCommand(publish: (values: TerminalCliStartupValues) => void): Command {
  const program = commonOptions(new Command()
    .name('dsh')
    .description('DeepSeek Harness terminal coding agent.')
    .helpOption('-h, --help', 'show this help')
    .argument('[prompt...]', 'optional first prompt'))

  program.action((prompt: string[], _options: unknown, command: Command) => {
    publish({ mode: 'interactive', prompt, ...overrides(command) })
  })

  const exec = commonOptions(program.command('exec')
    .description('Run one task non-interactively and print the final answer.')
    .argument('[prompt...]', 'prompt text; use - or omit it to read stdin'))
    .option('--json', 'emit JSONL events to stdout')
  exec.action((prompt: string[], options: { json?: boolean }, command: Command) => {
    publish({ mode: 'exec', prompt, json: options.json === true, ...overrides(command) })
  })

  const resume = commonOptions(program.command('resume')
    .description('Resume a persisted terminal Session.')
    .argument('[session]', 'Session id; omitted selects the newest Session in this cwd')
    .argument('[prompt...]', 'optional first follow-up prompt'))
    .option('--last', 'resume the newest Session in this cwd')
  resume.action((session: string | undefined, prompt: string[], options: { last?: boolean }, command: Command) => {
    if (options.last === true && session !== undefined) {
      resume.error('error: --last and a Session id are mutually exclusive')
    }
    publish({
      mode: 'resume',
      ...session === undefined ? {} : { sessionId: session },
      prompt,
      ...overrides(command),
    })
  })

  program.addHelpText('after', `
Examples:
  dsh                            start an interactive Session
  dsh "inspect this repository"  start interactively with a first prompt
  dsh exec "run the tests"        run once; final answer goes to stdout
  printf 'review this' | dsh exec -
  dsh resume --last              resume the newest Session in this directory
`)
  return program
}

/** Parse and publish this invocation's startup value. */
export function apply(ctx: Context): void {
  const program = terminalCliCommand(value => ctx.provide(TERMINAL_CLI_STARTUP_SERVICE, Object.freeze({
    value: Object.freeze(value),
  })))
  parseCmdline(ctx, program)
}
