/**
 * `@deepseek-ai/dsh-terminal-cli` — line-oriented interactive and exec surface
 * over the existing Agent/Session runtime.
 * @module @deepseek-ai/dsh-terminal-cli
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { effectiveSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { effectiveApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { installTerminalInteractions } from './interactions.ts'
import { internals, LineInput, resolveExecPrompt, sanitizeTerminal, type TerminalCliIo } from './io.ts'
import { TerminalSessionRenderer, type RenderMode, type TerminalCliJsonEvent } from './render.ts'
import { openTerminalSession, type CliTurnOutcome, type TerminalCliSession } from './session.ts'
import type { ExecStartup, InteractiveStartup, ResumeStartup, TerminalCliStartupValues } from './startup.ts'

/** Cordis plugin name. */
export const name = 'terminal-cli-runner'

/** Current base services required before an Agent can be driven. */
export const inject = [
  'terminalCliStartup', 'agentDefaultModel', 'agents', 'sessions', 'sessionPersistence',
  'tools', 'commands', 'userQuestions', 'approval',
]

/** Error whose exit status represents invalid process input, not a failed turn. */
class CliUsageError extends Error {}

/** Render the effective permission facts already pinned into this Session. */
function permissionSummary(session: TerminalCliSession): { sandbox: string; approval: string } {
  return {
    sandbox: effectiveSandboxMode(session.agent.session.events) ?? 'composition-default',
    approval: effectiveApprovalPolicy(session.agent.session.events) ?? 'composition-default',
  }
}

/** Stable JSON error for a failure that occurs outside a Session turn. */
function writeJsonError(io: TerminalCliIo, message: string): void {
  const event = {
    schemaVersion: 1,
    type: 'turn.failed',
    threadId: '',
    turn: 0,
    seq: 0,
    reason: 'error',
    error: { code: 'CLI_ERROR', message },
  } satisfies TerminalCliJsonEvent
  io.stdout.write(`${JSON.stringify(event)}\n`)
}

/** Convert a turn outcome to the process success contract. */
function completed(outcome: CliTurnOutcome): boolean {
  return outcome.reason?.kind === 'completed'
}

/** Execute one prompt while the renderer is already subscribed. */
async function runRenderedTurn(session: TerminalCliSession, prompt: string): Promise<CliTurnOutcome> {
  return await session.runTurn(prompt)
}

/** Run the deterministic unattended mode. */
async function runExec(ctx: Context, startup: ExecStartup, io: TerminalCliIo): Promise<number> {
  let prompt: string
  try {
    prompt = await resolveExecPrompt(startup.prompt, io.stdin)
  } catch (error: unknown) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error))
  }
  // Exec owns independent defaults rather than changing the legacy headless
  // profile: unattended work is read-only and never opens approval prompts.
  const values: ExecStartup = {
    ...startup,
    sandbox: startup.sandbox ?? 'read-only',
    approval: startup.approval ?? 'never',
  }
  const session = await openTerminalSession(ctx, 'exec', values)
  const renderer = new TerminalSessionRenderer(
    ctx,
    session.agent,
    io,
    startup.json ? 'exec-json' : 'exec-human',
    session.selection(),
  )
  try {
    let outcome: CliTurnOutcome
    try {
      outcome = await runRenderedTurn(session, prompt)
      await session.close()
    } catch (error: unknown) {
      // runTurn can fail on its durability flush before close owns teardown.
      // close is idempotent and always releases the Agent handle.
      await session.close().catch(() => {})
      if (!startup.json) throw error
      const message = sanitizeTerminal(error instanceof Error ? error.message : String(error))
      renderer.fail(message)
      io.stderr.write(`dsh: ${message}\n`)
      return 1
    }
    renderer.finish()
    if (completed(outcome) && !startup.json) {
      io.stdout.write(`${sanitizeTerminal(outcome.text)}\n`)
    }
    return completed(outcome) ? 0 : 1
  } finally {
    renderer.dispose()
  }
}

/** Print local commands plus the live plugin command catalog. */
function printHelp(ctx: Context, session: TerminalCliSession, io: TerminalCliIo): void {
  const rows = [
    ['/help', 'show this help'],
    ['/exit', 'flush the Session and exit'],
    ...ctx.commands.list(session.agent).map(command => [
      `/${command.name}${command.input === undefined ? '' : ` ${command.input.hint}`}`,
      command.description,
    ]),
  ]
  io.stdout.write('Commands:\n')
  for (const [command, description] of rows) io.stdout.write(`  ${command}  ${description}\n`)
}

/** Dispatch one local/plugin command; false asks the caller to leave the REPL. */
async function dispatchCommand(
  ctx: Context,
  session: TerminalCliSession,
  line: string,
  io: TerminalCliIo,
  controller: AbortController,
): Promise<boolean> {
  if (/^\/(?:exit|quit)(?:\s|$)/u.test(line)) return false
  if (/^\/help(?:\s|$)/u.test(line)) {
    printHelp(ctx, session, io)
    return true
  }
  const execution = await ctx.commands.execute(session.agent, line, controller.signal)
  if (execution === undefined) {
    io.stderr.write(`dsh: unknown command ${sanitizeTerminal(line.replace(/\s.*$/u, ''))}; use /help\n`)
    return true
  }
  const result = execution.result
  if (result.text !== undefined) {
    const output = result.kind === 'error' ? io.stderr : io.stdout
    output.write(`${sanitizeTerminal(result.text)}\n`)
  }
  return true
}

/** Run a prompt and keep recoverable turn failures inside the interactive loop. */
async function interactiveTurn(session: TerminalCliSession, prompt: string): Promise<void> {
  await runRenderedTurn(session, prompt)
}

/** Run a fresh or resumed line-oriented REPL. */
async function runInteractive(
  ctx: Context,
  startup: InteractiveStartup | ResumeStartup,
  io: TerminalCliIo,
): Promise<number> {
  if (io.stdin.isTTY !== true || io.stdout.isTTY !== true) {
    throw new CliUsageError('interactive mode requires a TTY on stdin and stdout; use `dsh exec` for pipes and scripts')
  }
  const session = await openTerminalSession(ctx, startup.mode, startup)
  let exitRequested = false
  let cancelRequested = false
  let commandController: AbortController | undefined
  const appInterrupt = ctx.get('appInterrupt')
  const escalateInterrupt = (fromLauncher: boolean): boolean => {
    if (fromLauncher) return false
    if (appInterrupt === undefined) io.exit(130)
    else appInterrupt.escalate(130)
    return true
  }
  const interrupt = (fromLauncher: boolean): boolean => {
    if (commandController !== undefined) {
      if (commandController.signal.aborted) return escalateInterrupt(fromLauncher)
      commandController.abort(new Error('command interrupted'))
      return true
    }
    // Keep escalation armed until the complete turn promise returns. The
    // Agent can become idle before a trailing persistence flush settles.
    if (cancelRequested) return escalateInterrupt(fromLauncher)
    // A turn can report idle before its trailing persistence flush settles.
    // Once teardown starts, a repeated interrupt must still reach the launcher's
    // bounded shutdown path instead of being absorbed by another input close.
    if (exitRequested) return escalateInterrupt(fromLauncher)
    if (session.agent.status === 'running') {
      cancelRequested = true
      io.stderr.write('dsh: cancelling current turn (press Ctrl-C again to exit)\n')
      session.cancel()
      return true
    }
    exitRequested = true
    input.close()
    return true
  }
  const input = new LineInput(io.stdin, io.stdout, () => { void interrupt(false) })
  ctx.effect(() => () => { input.close() }, 'terminal-cli: readline teardown')
  const disposeInterrupt = appInterrupt?.register(() => interrupt(true))
  const disposeInteractions = installTerminalInteractions(ctx, session.agent, input, io.stdout)
  const renderer = new TerminalSessionRenderer(ctx, session.agent, io, 'interactive', session.selection())
  const selection = session.selection()
  const permission = permissionSummary(session)
  io.stdout.write('DeepSeek Harness CLI\n')
  io.stdout.write(`session: ${session.agent.id}\n`)
  io.stdout.write(`cwd: ${session.agent.session.header.cwd ?? process.cwd()}\n`)
  io.stdout.write(`model: ${selection.provider}/${selection.model}\n`)
  io.stdout.write(`permissions: ${permission.sandbox}, approval ${permission.approval}\n`)
  io.stdout.write('Type /help for commands.\n\n')

  try {
    const initial = startup.prompt.join(' ')
    if (initial.trim() !== '') {
      await interactiveTurn(session, initial)
      cancelRequested = false
    }
    while (!exitRequested) {
      const line = await input.read('› ')
      if (line === undefined) break
      if (line.trim() === '') continue
      if (line.startsWith('/')) {
        commandController = new AbortController()
        try {
          if (!await dispatchCommand(ctx, session, line, io, commandController)) break
        } catch (error: unknown) {
          io.stderr.write(`dsh: ${sanitizeTerminal(error instanceof Error ? error.message : String(error))}\n`)
        } finally {
          commandController = undefined
        }
        continue
      }
      await interactiveTurn(session, line)
      cancelRequested = false
    }
    return 0
  } finally {
    commandController?.abort(new Error('terminal CLI is closing'))
    disposeInterrupt?.()
    disposeInteractions()
    input.close()
    renderer.dispose()
    await session.close()
  }
}

/** Select the mode after Loader settlement guarantees the complete tool/runtime tree. */
async function run(ctx: Context, startup: TerminalCliStartupValues, io: TerminalCliIo): Promise<number> {
  await ctx.get('loader')?.await()
  return startup.mode === 'exec'
    ? await runExec(ctx, startup, io)
    : await runInteractive(ctx, startup, io)
}

/** Mount the terminal runner and request bounded exit when it settles. */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('terminal-cli-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const startup = ctx.terminalCliStartup.value
  const io: TerminalCliIo = { ...internals, exit }
  void run(ctx, startup, io).then(
    (code) => { io.exit(code) },
    (error: unknown) => {
      const message = sanitizeTerminal(error instanceof Error ? error.message : String(error))
      if (startup.mode === 'exec' && startup.json) writeJsonError(io, message)
      else io.stderr.write(`dsh: ${message}\n`)
      io.exit(1)
    },
  )
}

export type { RenderMode }
