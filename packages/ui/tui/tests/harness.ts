import { createUserMessage, MessageId , createMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import type { Terminal } from '@earendil-works/pi-tui'
import AgentRegistry, {
  Inbox,
  type Agent,
  type AgentCancelCause,
  type AgentOptions,
  type AgentStatus,
} from '@deepseek-ai/dsh-agent'
import type {
  ContentBlock,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
} from '@deepseek-ai/dsh-llm'
import CommandService from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId, type Session, type SessionHeader, type UserMessage } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStatsPlugin from '@deepseek-ai/dsh-session-stats'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import UserInteractionService from '@deepseek-ai/dsh-user-questions'
import UserApprovalService from '@deepseek-ai/dsh-user-approval'
import { createTuiChat, type Config, type TuiRuntime } from '../src/index.ts'
import { TestSessionQueryService } from './session-query.ts'
import TuiPromptService from '../src/prompt.ts'

interface FakeAgent extends Agent {
  status: AgentStatus
  sent: ContentBlock[][]
  sentMessages: UserMessage[]
  sentOptions: unknown[]
  steered: ContentBlock[][]
  steeredIds: MessageId[]
  steeredOptions: UserMessage[]
  injected: ContentBlock[][]
  injectedOptions: UserMessage[]
  cancelled: AgentCancelCause[]
}

export interface TuiHarnessOptions {
  status?: AgentStatus
  config?: Config
  /** Leave the session event log empty instead of seeding one turn and step. */
  omitInitialLifecycle?: boolean
  tools?: Record<string, ToolDefinition>
  configureContext?: (ctx: Context) => Promise<void>
  beforeMount?: (session: Session) => void
  cwd?: string | null
  formatCwd?: TuiRuntime['formatCwd']
  gitBranch?: TuiRuntime['gitBranch']
  gitDiff?: TuiRuntime['gitDiff']
  /** Fake-agent creation options (`provider`/`model` seed the model selector's initial target). */
  agentOptions?: AgentOptions
  contextWindow?: number
  contextTokens?: number
  now?: () => number
  catalog?: {
    providers: LlmProviderInfo[]
    models: LlmModelInfo[]
    listModels?: (provider: string) => Promise<LlmModelInfo[]>
    resolveModelInfo?: (
      provider: string,
      model: string,
    ) => Promise<Pick<LlmResolvedModelInfo, 'context' | 'reasoning'>>
  }
  /** Provide a fake `sessionPersistence` service so resume surfaces can list sessions. */
  sessionPersistence?: {
    list(): Promise<SessionHeader[]>
    load?(id: ReturnType<typeof SessionId>): Promise<{ meta: SessionHeader; events: Session['events'] }>
    /** Per-session artifact location for mtime-based activity; defaults to none. */
    locate?(meta: SessionHeader): { kind: string; path: string } | undefined
  }
  handoffResume?: TuiRuntime['handoffResume']
  handoffWorkspace?: TuiRuntime['handoffWorkspace']
  /** Optional live-agent channel host used by `/agent` and `/subagents`. */
  agentNavigation?: TuiRuntime['agentNavigation']
  /** Host-supplied exit line; absent exercises the no-message path. */
  goodbyeMessage?: TuiRuntime['goodbyeMessage']
  /** Set false to exercise the optional session-query degradation path. */
  mountSessionQuery?: boolean
}

export interface TuiHarness<TerminalType extends Terminal, Exit extends (code: number) => void> {
  ctx: Context
  session: Session
  agent: FakeAgent
  terminal: TerminalType
  exit: Exit
  controller: ReturnType<typeof createTuiChat>
}

/**
 * Compose the production TUI around an in-memory session and controllable agent.
 * @param terminal - Terminal boundary driven by the test.
 * @param exit - Process-exit observer.
 * @param options - Initial session, agent, tool, and TUI configuration.
 * @returns The mounted TUI and every boundary the test may drive or inspect.
 */
export async function createTuiTestHarness<TerminalType extends Terminal, Exit extends (code: number) => void>(
  terminal: TerminalType,
  exit: Exit,
  options: TuiHarnessOptions = {},
): Promise<TuiHarness<TerminalType, Exit>> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandService)
  await ctx.plugin(UserInteractionService)
  await ctx.plugin(UserApprovalService)
  await ctx.plugin(TuiPromptService)
  const catalog = options.catalog ?? {
    providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
    models: [
      { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ],
  }
  ctx.provide('tokenMeter', {
    measure() {
      return { totalTokens: options.contextTokens ?? 0 }
    },
  } as never)
  if (options.configureContext === undefined) {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    for (const tool of Object.values(options.tools ?? {})) ctx.tools.register(tool)
  } else {
    await options.configureContext(ctx)
  }
  // Most harnesses exercise the same shared statistics projection as Web.
  // A few focused fixtures deliberately provide their own projection boundary;
  // preserve that override instead of registering the service twice.
  if (ctx.get('sessionProjections') === undefined) {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStatsPlugin)
  }
  // A configureContext may mount the real LlmService; only fill the
  // advisory-catalog stub when none was provided.
  if (ctx.get('llm') === undefined) {
    ctx.provide('llm', {
      listProviders() {
        return catalog.providers.map(provider => ({ ...provider }))
      },
      listModels(provider: string) {
        return catalog.listModels?.(provider)
          ?? Promise.resolve(catalog.models.filter(model => model.provider === provider).map(model => ({ ...model })))
      },
      async resolveModelInfo(provider: string, model: string) {
        const advertised = catalog.models.find(candidate =>
          candidate.provider === provider && candidate.id === model)
        const capabilities = await (catalog.resolveModelInfo?.(provider, model)
          ?? Promise.resolve({
            context: { contextWindow: options.contextWindow ?? 128_000 },
          }))
        return {
          provider,
          id: model,
          name: advertised?.name ?? model,
          ...advertised?.description === undefined ? {} : { description: advertised.description },
          ...capabilities,
        }
      },
    } as never)
  }
  if (ctx.get('systemPrompt') === undefined) await ctx.plugin(SystemPrompt)
  if (options.sessionPersistence !== undefined) {
    const persistence = options.sessionPersistence
    ctx.provide('sessionPersistence', {
      ...persistence,
      locate: (meta: SessionHeader) => persistence.locate?.(meta),
      create: () => Promise.resolve(),
      append: () => Promise.resolve(),
      load: persistence.load === undefined
        ? (id: ReturnType<typeof SessionId>) => Promise.reject(new Error(`session "${id}" not found`))
        : (id: ReturnType<typeof SessionId>) => persistence.load!(id),
      inspect: persistence.load === undefined
        ? (id: ReturnType<typeof SessionId>) => Promise.reject(new Error(`session "${id}" not found`))
        : (id: ReturnType<typeof SessionId>) => persistence.load!(id),
    } as never)
  }
  if (options.mountSessionQuery !== false && ctx.get('sessionQuery') === undefined) {
    await ctx.plugin(TestSessionQueryService)
  }
  const sessionId = SessionId('main-session')
  const session = ctx.sessions.create(
    sessionId,
    options.cwd === null ? undefined : { meta: { cwd: options.cwd ?? '/workspace' } },
  )
  if (options.omitInitialLifecycle !== true) {
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
  }
  options.beforeMount?.(session)
  const sent: ContentBlock[][] = []
  const sentMessages: UserMessage[] = []
  const steered: ContentBlock[][] = []
  const steeredIds: MessageId[] = []
  const sentOptions: unknown[] = []
  const steeredOptions: UserMessage[] = []
  const injected: ContentBlock[][] = []
  const injectedOptions: UserMessage[] = []
  const cancelled: AgentCancelCause[] = []
  const agent: FakeAgent = {
    id: sessionId,
    options: options.agentOptions ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    session,
    status: options.status ?? 'idle',
    ctx,
    inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
    sent,
    sentMessages,
    sentOptions,
    steered,
    steeredIds,
    steeredOptions,
    injected,
    injectedOptions,
    cancelled,
    send(input, target, wakeup) {
      sent.push(input.content)
      sentMessages.push(input)
      sentOptions.push({ target, wakeup })
      return input.id
    },
    followup(input) {
      sent.push(input.content)
      sentMessages.push(input)
      sentOptions.push(undefined)
      return input.id
    },
    steer(input) {
      steered.push(input.content)
      steeredOptions.push(input)
      const id = input.id
      steeredIds.push(id)
      return { outcome: Promise.resolve({ status: 'admitted' as const, turn: 1, step: 1 }) }
    },
    inject(input) {
      injected.push(input.content)
      injectedOptions.push(input)
      return input.id
    },
    cancel(cause) {
      cancelled.push(cause)
    },
    whenIdle() {
      return Promise.resolve()
    },
    runMaintenance(task) {
      return task(new AbortController().signal)
    },
  }
  ctx.agents.register(agent)
  const controller = createTuiChat(ctx, Object.assign({
    sessionId,
    // Most behavior tests assert the renderer independently of terminal-mode
    // ownership; dedicated suites cover the production full-screen defaults.
    fullscreen: false,
    mouse: false,
    theme: { color: false },
  }, options.config), {
    terminal,
    exit,
    // Default to the real clock (runtime.now falls back to Date.now) so the
    // elapsed-status suites can drive time via timers or Date.now spies; a
    // test pins the clock only by passing `now` explicitly.
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.formatCwd === undefined ? {} : { formatCwd: options.formatCwd }),
    ...(options.gitDiff === undefined ? {} : { gitDiff: options.gitDiff }),
    ...(options.handoffResume === undefined ? {} : { handoffResume: options.handoffResume }),
    ...(options.handoffWorkspace === undefined ? {} : { handoffWorkspace: options.handoffWorkspace }),
    ...(options.agentNavigation === undefined ? {} : { agentNavigation: options.agentNavigation }),
    ...(options.goodbyeMessage === undefined ? {} : { goodbyeMessage: options.goodbyeMessage }),
    gitBranch: options.gitBranch ?? (() => 'tui-staging'),
  })
  return { ctx, session, agent, terminal, exit, controller }
}

/** Dispose the mounted TUI before its owning Cordis context. */
export async function disposeTuiTestHarness(
  setup: Pick<TuiHarness<Terminal, (code: number) => void>, 'controller' | 'ctx'>,
): Promise<void> {
  await setup.controller.dispose()
  await setup.ctx.fiber.dispose()
}

/** Append a production-shaped user message to the active session surface. */
export function appendUser(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** Append a production-shaped assistant message to the active session surface. */
export function appendAssistant(
  session: Session,
  content: ContentBlock[],
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  position: { turn: number; step: number } = { turn: 1, step: 1 },
): void {
  session.append('assistant/message', {
    ...position,
    message: createMessage({
      role: 'assistant',
      content,
      source: { kind: 'model', provider: 'mock', model: 'deepseek-v4-flash' },
    }),
    ...usage === undefined ? {} : { usage },
  }, { surfaceOp: 'append' })
}
