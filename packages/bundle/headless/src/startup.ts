/**
 * The non-interactive app's command-line provider. It parses fresh and resumed
 * exec runs, then publishes {@link HEADLESS_STARTUP_SERVICE}; the runner stays
 * an ordinary consumer whose activation waits for this immutable invocation.
 * @module @deepseek-ai/dsh-headless/startup
 */

import { Command, Option } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  APPROVAL_POLICIES,
  SANDBOX_MODES,
  type PermissionPolicySelection,
} from '@deepseek-ai/dsh-permission-presets'

/** Stable Cordis plugin name. */
export const name = 'headless-startup'

/** Services required before the invocation can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the non-interactive runner. */
export const HEADLESS_STARTUP_SERVICE = 'headlessStartup'

/** Startup permission preset selected by non-interactive flags. */
export type HeadlessPermissionMode = 'default' | 'full-auto' | 'yolo'

/** A persisted session selected explicitly or through the newest-session lookup. */
export interface HeadlessResumeSelection {
  /** Explicit session id; absent when `last` selects it at run time. */
  sessionId?: string
  /** Select the newest eligible persisted session. */
  last: boolean
  /** Let `last` consider sessions from every workspace. */
  all: boolean
}

/** Immutable parsed command-line values consumed by one non-interactive run. */
export interface HeadlessStartupValues {
  /** The prompt text submitted for this run. */
  task: string
  /** Emit machine-readable JSONL events instead of a final text line. */
  json: boolean
  /** Do not persist a fresh session. */
  ephemeral: boolean
  /** Ordered local image paths attached to the prompt. */
  images: string[]
  /** Optional JSON Schema file constraining the final result. */
  outputSchema?: string
  /** Optional destination for the last agent result. */
  outputLastMessage?: string
  /** Optional persisted-session continuation. */
  resume?: HeadlessResumeSelection
  /** Startup permission behavior. */
  permissionMode: HeadlessPermissionMode
  /** Independently selected permission knobs, mutually exclusive with shortcuts. */
  permissionPolicy?: PermissionPolicySelection
  /** Workspace-relative or absolute directories added to workspace-write. */
  additionalWritableRoots: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Successful non-interactive startup values for one process invocation. */
    headlessStartup: HeadlessStartupValues
  }
}

interface CommonOptions {
  json?: boolean
  ephemeral?: boolean
  image?: string[]
  outputSchema?: string
  outputLastMessage?: string
  fullAuto?: boolean
  yolo?: boolean
  dangerouslyBypassApprovalsAndSandbox?: boolean
  addDir?: string[]
  sandbox?: PermissionPolicySelection['sandbox']
  askForApproval?: PermissionPolicySelection['approval']
}

/** Repeatable option collector that never consumes a later positional. */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** Register options shared by fresh and resumed runs. */
function addCommonOptions(command: Command): Command {
  return command
    .option('--json', 'print lifecycle and result events as JSONL')
    .option('--ephemeral', 'run without persisting a fresh session')
    .option('-i, --image <file>', 'attach a local image (repeatable)', collect)
    .option('--output-schema <file>', 'JSON Schema file for the final result')
    .option('-o, --output-last-message <file>', 'write the last agent result to a file')
    .option('--full-auto', 'run without prompts inside the workspace; deny wider actions')
    .option('--yolo', 'run unrestricted without approval prompts')
    .option('--dangerously-bypass-approvals-and-sandbox', 'alias for --yolo')
    .option('--add-dir <dir>', 'add a writable directory alongside the workspace (repeatable)', collect)
    .addOption(new Option('-s, --sandbox <mode>', 'select the file sandbox mode').choices([...SANDBOX_MODES]))
    .addOption(new Option('-a, --ask-for-approval <policy>', 'select approval prompting').choices([...APPROVAL_POLICIES]))
}

/** Merge options accepted before and after the `resume` subcommand. */
function commonOptions(parent: CommonOptions, child: CommonOptions = {}): CommonOptions {
  const outputSchema = child.outputSchema ?? parent.outputSchema
  const outputLastMessage = child.outputLastMessage ?? parent.outputLastMessage
  const sandbox = child.sandbox ?? parent.sandbox
  const askForApproval = child.askForApproval ?? parent.askForApproval
  return {
    json: parent.json === true || child.json === true,
    ephemeral: parent.ephemeral === true || child.ephemeral === true,
    image: [...(parent.image ?? []), ...(child.image ?? [])],
    ...outputSchema === undefined ? {} : { outputSchema },
    ...outputLastMessage === undefined ? {} : { outputLastMessage },
    fullAuto: parent.fullAuto === true || child.fullAuto === true,
    yolo: parent.yolo === true || child.yolo === true,
    dangerouslyBypassApprovalsAndSandbox:
      parent.dangerouslyBypassApprovalsAndSandbox === true
      || child.dangerouslyBypassApprovalsAndSandbox === true,
    addDir: [...(parent.addDir ?? []), ...(child.addDir ?? [])],
    ...sandbox === undefined ? {} : { sandbox },
    ...askForApproval === undefined ? {} : { askForApproval },
  }
}

/** Resolve mutually exclusive unattended permission flags. */
function permissionMode(program: Command, options: CommonOptions): HeadlessPermissionMode {
  const yolo = options.yolo === true || options.dangerouslyBypassApprovalsAndSandbox === true
  if (options.fullAuto === true && yolo) {
    program.error('error: --full-auto and --yolo are mutually exclusive')
  }
  if ((options.fullAuto === true || yolo)
    && (options.sandbox !== undefined || options.askForApproval !== undefined)) {
    program.error('error: --full-auto and --yolo cannot be combined with --sandbox or --ask-for-approval')
  }
  return yolo ? 'yolo' : options.fullAuto === true ? 'full-auto' : 'default'
}

/** Materialize one validated provider value. */
function startupValues(
  program: Command,
  tokens: readonly string[],
  options: CommonOptions,
  resume?: HeadlessResumeSelection,
): HeadlessStartupValues {
  const task = tokens.join(' ')
  if (task.trim() === '') {
    program.error('error: a task is required, for example: deepseek exec "run the tests"')
  }
  if (resume !== undefined && options.ephemeral === true) {
    program.error('error: --ephemeral cannot be used with exec resume')
  }
  const mode = permissionMode(program, options)
  return {
    task,
    json: options.json === true,
    ephemeral: options.ephemeral === true,
    images: options.image ?? [],
    ...options.outputSchema === undefined ? {} : { outputSchema: options.outputSchema },
    ...options.outputLastMessage === undefined ? {} : { outputLastMessage: options.outputLastMessage },
    ...resume === undefined ? {} : { resume },
    permissionMode: mode,
    ...options.sandbox === undefined && options.askForApproval === undefined ? {} : {
      permissionPolicy: {
        ...options.sandbox === undefined ? {} : { sandbox: options.sandbox },
        ...options.askForApproval === undefined ? {} : { approval: options.askForApproval },
      },
    },
    additionalWritableRoots: options.addDir ?? [],
  }
}

/**
 * This app's command tree and help text.
 * @returns a fresh program, so one process can parse more than once in tests.
 */
function headlessCommand(): Command {
  const program = addCommonOptions(new Command()
    .name('deepseek exec')
    .description('Run DeepSeek non-interactively and print the result or JSONL events.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'task text'))
  program.addHelpText('after', `
Examples:
  deepseek exec "run the tests"
  deepseek exec --json "review this repository"
  deepseek exec --output-schema result.schema.json "analyze"
  deepseek exec resume --last "continue"
  deepseek exec --image screenshot.png "fix this UI"
`)
  const resume = addCommonOptions(program.command('resume')
    .description('continue a persisted session by id or select the newest with --last')
    .argument('[session]', 'persisted session id')
    .argument('[task...]', 'follow-up task text')
    .option('--last', 'resume the newest eligible session')
    .option('--all', 'with --last, include sessions from other workspaces'))
  resume.action((session: string | undefined, task: string[], _options: unknown, child: Command) => {
    const options = commonOptions(program.opts<CommonOptions>(), child.opts<CommonOptions>())
    const resumeOptions = child.opts<{ last?: boolean; all?: boolean }>()
    const last = resumeOptions.last === true
    if (!last && (session === undefined || session.trim() === '')) {
      child.error('error: exec resume needs a session id or --last')
    }
    if (resumeOptions.all === true && !last) child.error('error: --all requires --last')
    const taskTokens = last && session !== undefined ? [session, ...task] : task
    const value = startupValues(child, taskTokens, options, {
      ...last || session === undefined ? {} : { sessionId: session },
      last,
      all: resumeOptions.all === true,
    })
    program.setOptionValue('__headlessStartup', value)
  })
  program.action((task: string[]) => {
    program.setOptionValue('__headlessStartup', startupValues(program, task, program.opts<CommonOptions>()))
  })
  return program
}

/**
 * Parse and provide one non-interactive invocation. Help and usage errors leave
 * the runner pending because no startup service is published.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = headlessCommand()
  parseCmdline(ctx, program)
  const resolved = program.getOptionValue('__headlessStartup') as HeadlessStartupValues | undefined
  if (resolved !== undefined) ctx.provide(HEADLESS_STARTUP_SERVICE, resolved)
}
