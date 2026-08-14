/**
 * `@deepseek-ai/dsh-tui-app` — shipped interactive terminal ownership over the
 * base bundle. It publishes one fresh or resumed root Agent, then mounts the
 * renderer through its existing-agent path.
 * @module @deepseek-ai/dsh-tui-app
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  installModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  apply as mountProcessTui,
  type MainSessionIdentity,
  type TuiConfig,
} from '@deepseek-ai/dsh-tui'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from './startup.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Every service the directly mounted renderer and Agent owner require. */
export const inject = [
  'tuiStartup',
  'agentDefaultModel',
  'agents',
  'sessions',
  'approval',
  'commands',
  'userQuestions',
  'tools',
  'llm',
  'systemPrompt',
  'tokenMeter',
  'tuiPrompt',
]

/** Renderer presentation settings; session identity belongs to `tuiStartup`. */
export type Config = TuiConfig

/** The renderer's presentation schema, without its independently owned identity fields. */
export const Config: z<Config> = z.object({
  showReasoning: z.boolean().default(true),
  maxToolOutputLines: z.number().step(1).min(1).default(6),
  maxDiffEditLength: z.number().step(1).min(1).default(1000),
  maxQuestionOptions: z.number().step(1).min(1).default(8),
  maxModelOptions: z.number().step(1).min(1).default(8),
  maxResumeOptions: z.number().step(1).min(1).default(8),
  resumeScanConcurrency: z.number().step(1).min(1).default(4),
  questionDialogWidth: z.number().step(1).min(20).default(200),
  questionDialogMaxHeight: z.number().step(1).min(6).default(20),
  modelDialogWidth: z.number().step(1).min(20).default(76),
  modelDialogMaxHeight: z.number().step(1).min(6).default(20),
  detailsDialogWidth: z.number().step(1).min(20).default(72),
  fileSearchMaxResults: z.number().step(1).min(1).default(20),
  fileSearchMaxEntries: z.number().step(1).min(1).default(10000),
  fileSearchExcludedDirectories: z.array(z.string()).default(['.git', 'node_modules']),
  showHardwareCursor: z.boolean().default(false),
  theme: z.object({
    color: z.boolean().default(true),
    truecolor: z.boolean(),
    leftPrompt: z.string().default('${cwd}${git/worktree}${model}${token_meter/cache_hit_rate}${context}'),
    rightPrompt: z.string().default('${queued}'),
    inputPrompt: z.string().default('${symbol} ${indicator}'),
    inputPlaceholder: z.string().default('press enter to steer and esc to cancel'),
  }),
  title: z.string().default('DeepSeek Harness'),
})

/** Process effects replaced by focused runner tests. */
export const internals: {
  stderr: { write(chunk: string): unknown }
  mount(ctx: Context, config: import('@deepseek-ai/dsh-tui').Config): void
} = {
  stderr: process.stderr,
  mount: mountProcessTui,
}

/** Report a failed startup and request the launcher's bounded shutdown. */
function fail(exit: (code: number) => void, error: unknown): void {
  internals.stderr.write(`dsh tui: ${error instanceof Error ? error.message : String(error)}\n`)
  exit(1)
}

/**
 * Create or resume the single root Agent after every sibling row has settled,
 * then mount the renderer onto that existing root.
 * A fixed selection listener covers setup and synchronous publication; once
 * `agent/created` has mounted the TUI's mutable selector, the bootstrap
 * listener is removed so `/model` remains authoritative for later steps.
 */
async function startAgent(ctx: Context, identity: MainSessionIdentity, config: Config): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  // A requested shutdown can dispose providers while Loader settlement is in flight.
  if (agents === undefined || defaultModel === undefined) return

  const selection = defaultModel.currentSelection()
  let disposeBootstrapSelection: (() => void) | undefined
  const setup = (agentCtx: Context): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    disposeBootstrapSelection = installModelSelection(agentCtx, selected)
  }
  try {
    if (identity.resume) {
      await agents.resume({
        resumeSessionId: SessionId(identity.id),
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })
    } else {
      await agents.create({
        sessionId: SessionId(identity.id),
        meta: { cwd: process.cwd() },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })
    }
    // mountTui synchronously checks existing roots after installing its event
    // listeners, so mounting after publication cannot miss the target.
    internals.mount(ctx, { ...config, sessionId: identity.id })
  } finally {
    disposeBootstrapSelection?.()
  }
}

/**
 * Start the exact Agent asynchronously after Loader settlement, then mount the
 * process TUI onto it. The startup provider has already rejected a non-TTY
 * invocation before this dependency-heavy runner can activate.
 * @param ctx - terminal bundle context carrying startup, renderer, and Agent services.
 * @param config - validated presentation settings.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const { identity } = ctx.tuiStartup
  void startAgent(ctx, identity, config).catch((error: unknown) => { fail(exit, error) })
}
