import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CombinedAutocompleteProvider, visibleWidth, type Terminal } from '@earendil-works/pi-tui'
import AgentRegistry, {
  agentEvents, assembleContextFor, Inbox, type Agent,
} from '@deepseek-ai/dsh-agent'
import { createUserMessage,
  createToolResultMessage,
  LlmError,
  ReasoningEffortId,
  type LlmCallConfig,
  type LlmModelReasoningInfo,
  MessageId,
  createMessage,
  freezeMessage,
} from '@deepseek-ai/dsh-llm'
import { GOAL_CHANGE_VERSION, GoalId, type GoalSnapshotChangeMeta } from '@deepseek-ai/dsh-goal'
import CommandService, { type CommandInvocation } from '@deepseek-ai/dsh-commands'
import { compactCheckpointSource, CompactionId } from '@deepseek-ai/dsh-compaction'
import SessionStore, { SessionId, type JsonValue, type SessionEvent, type SessionHeader, type TurnEndReason } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import SkillRegistry, { type SkillCatalogSnapshot, type SkillDefinition, type SkillProvider, type SkillSummary } from '@deepseek-ai/dsh-skill'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import UserInteractionService from '@deepseek-ai/dsh-user-questions'
import SessionReferenceResolver, { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import {
  createTuiChat,
  disposeRootAndExit,
  FILE_REFERENCE_PROMPT,
  mountTui,
  renderSkillInvocation,
  TuiPromptService,
  resolveTuiConfig,
  type TuiOverlayHost,
  type TuiOverlaySession,
  type TuiRuntime,
} from '../src/index.ts'
import { WorkspaceFileSearch } from '../src/chat/file-autocomplete.ts'
import { osc52ClipboardSequence } from '../src/chat/clipboard.ts'
import { CURSOR_BLINK_INTERVAL_MS } from '../src/chat/helpers.ts'
import { ResumePicker } from '../src/components/dialogs.ts'
import {
  ATTRIBUTE_ROLES,
  brandText,
  COLOR_ROLES,
  createPalette,
  highlightMarkdownCode,
  paletteSpec,
} from '../src/components/theme.ts'
import {
  appendAssistant,
  appendUser,
  createTuiTestHarness,
  disposeTuiTestHarness,
  type TuiHarnessOptions,
} from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'
import { TestSessionQueryService } from './session-query.ts'

const UNUSED_TOOL_OUTPUT: ToolDefinition['output'] = {
  schema: { type: 'null' },
  render: () => [],
}

const COMPACT_CHECKPOINT_SOURCE = compactCheckpointSource(CompactionId('tui-test-compaction'))
const LIVE_COMPACTION_ID = CompactionId('tui-test-live-compaction')

class FakeTerminal implements Terminal {
  columns = 88
  rows = 32
  kittyProtocolActive = false
  output = ''
  title = ''
  progress: boolean[] = []
  started = 0
  stopped = 0
  drainInput = vi.fn(() => Promise.resolve())
  private onInput: (data: string) => void = () => {}
  private onResize: () => void = () => {}

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.started += 1
    this.onInput = onInput
    this.onResize = onResize
  }

  stop(): void {
    this.stopped += 1
  }

  write(data: string): void {
    this.output += data
  }

  moveBy(lines: number): void {
    this.output += `[move:${lines}]`
  }

  hideCursor(): void {
    this.output += '[hide]'
  }

  showCursor(): void {
    this.output += '[show]'
  }

  clearLine(): void {
    this.output += '[clear-line]'
  }

  clearFromCursor(): void {
    this.output += '[clear-rest]'
  }

  clearScreen(): void {
    this.output += '[clear-screen]'
  }

  setTitle(title: string): void {
    this.title = title
  }

  setProgress(active: boolean): void {
    this.progress.push(active)
  }

  send(data: string): void {
    this.onInput(data)
  }

  resize(columns: number, rows = this.rows): void {
    this.columns = columns
    this.rows = rows
    this.onResize()
  }
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
}

function promptWidth(output: string): number {
  const row = output.split('\n').find(line => line.includes('dsh'))
  if (row === undefined) throw new Error('prompt row not rendered')
  return visibleWidth(row.slice(row.indexOf('dsh'), row.indexOf('dsh') + 6))
}

async function setup(options: TuiHarnessOptions = {}) {
  const terminal = new FakeTerminal()
  const exit = vi.fn()
  // Let the harness default cwd ('/workspace') stand: a checkout-dependent
  // process.cwd() longer than the 88-column fake terminal pushes the footer
  // token counters off-screen and fails their assertions by location.
  const result = await createTuiTestHarness(terminal, exit, options)
  await tick()
  return result
}

async function dispose(setupResult: Awaited<ReturnType<typeof setup>>): Promise<void> {
  await disposeTuiTestHarness(setupResult)
}

/** Complete inert workspace entity for front-door interaction tests. */
function workspaceFixture(
  id: string,
  path: string,
  title: string,
  status: () => Promise<'ok' | 'missing-dir'> = () => Promise.resolve('ok'),
): Workspace {
  return {
    id: WorkspaceId(id),
    path,
    title,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    sessionIds: [],
    setTitle: () => Promise.resolve(),
    attachSession: () => Promise.resolve(),
    insertSessionBefore: () => Promise.resolve(),
    detachSession: () => Promise.resolve(),
    status,
  }
}

function provideTokenMeter(ctx: Context): void {
  ctx.provide('tokenMeter', {
    measure() {
      return { totalTokens: 0 }
    },
  } as never)
}

/** Minimal advisory-catalog llm stub for tests composing their own context. */
function provideLlmCatalog(ctx: Context): void {
  ctx.provide('llm', {
    listProviders: () => [],
    listModels: () => Promise.resolve([]),
    resolveModelInfo: (provider: string, model: string) => Promise.resolve({
      provider,
      id: model,
      name: model,
    }),
  } as never)
}

/** Register the minimal current Agent contract used by terminal-mount tests. */
function registerMountAgent(ctx: Context, session: ReturnType<Context['sessions']['create']>, status: Agent['status']): Agent {
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    status,
    ctx,
    inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: task => task(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  }
  ctx.agents.register(agent)
  return agent
}

describe('TUI config', () => {
  it('defaults every direct-call TUI option', () => {
    expect(resolveTuiConfig(undefined)).toEqual({
      fullscreen: true,
      mouse: true,
      showReasoning: false,
      maxToolOutputLines: 6,
      maxDiffEditLength: 1000,
      maxQuestionOptions: 8,
      maxModelOptions: 8,
      maxResumeOptions: 8,
      resumeScanConcurrency: 4,
      questionDialogWidth: 200,
      questionDialogMaxHeight: 20,
      modelDialogWidth: 76,
      modelDialogMaxHeight: 20,
      detailsDialogWidth: 72,
      fileSearchMaxResults: 20,
      fileSearchMaxEntries: 10_000,
      fileSearchExcludedDirectories: ['.git', 'node_modules'],
      showHardwareCursor: true,
      theme: {
        color: true,
        truecolor: false,
        leftPrompt: '${cwd}${git/worktree}',
        rightPrompt: '${details}${status}${model}${token_meter/cache_hit_rate}${context}${queued}',
        inputPrompt: '${symbol} ${indicator}',
        inputPlaceholder: 'Describe a task, @ a file, or / for commands',
      },
      title: 'DeepSeek Harness',
    })
    expect(resolveTuiConfig({
      fullscreen: false,
      mouse: false,
      showReasoning: true,
      maxToolOutputLines: 2,
      maxDiffEditLength: 12,
      maxQuestionOptions: 3,
      maxModelOptions: 4,
      maxResumeOptions: 5,
      resumeScanConcurrency: 2,
      questionDialogWidth: 60,
      questionDialogMaxHeight: 14,
      modelDialogWidth: 64,
      modelDialogMaxHeight: 16,
      detailsDialogWidth: 44,
      fileSearchMaxResults: 7,
      fileSearchMaxEntries: 123,
      fileSearchExcludedDirectories: ['.git', 'generated'],
      showHardwareCursor: false,
      theme: { color: false, truecolor: true },
      title: 'DSH',
    })).toEqual({
      fullscreen: false,
      mouse: false,
      showReasoning: true,
      maxToolOutputLines: 2,
      maxDiffEditLength: 12,
      maxQuestionOptions: 3,
      maxModelOptions: 4,
      maxResumeOptions: 5,
      resumeScanConcurrency: 2,
      questionDialogWidth: 60,
      questionDialogMaxHeight: 14,
      modelDialogWidth: 64,
      modelDialogMaxHeight: 16,
      detailsDialogWidth: 44,
      fileSearchMaxResults: 7,
      fileSearchMaxEntries: 123,
      fileSearchExcludedDirectories: ['.git', 'generated'],
      showHardwareCursor: false,
      theme: {
        color: false,
        truecolor: true,
        leftPrompt: '${cwd}${git/worktree}',
        rightPrompt: '${details}${status}${model}${token_meter/cache_hit_rate}${context}${queued}',
        inputPrompt: '${symbol} ${indicator}',
        inputPlaceholder: 'Describe a task, @ a file, or / for commands',
      },
      title: 'DSH',
    })
  })
})

describe('software input cursor', () => {
  it('alternates the focused placeholder caret without relying on terminal blink support', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const result = await setup()
    try {
      const call = intervalSpy.mock.calls.find(([, delay]) => delay === CURSOR_BLINK_INTERVAL_MS)
      expect(call).toBeDefined()
      expect(result.terminal.output).toContain('dsh > │Describe a task')

      result.terminal.output = ''
      const blink = call?.[0]
      if (typeof blink !== 'function') throw new Error('cursor blink callback was not installed')
      blink()
      await tick()
      expect(result.terminal.output).toContain('dsh >  Describe a task')
      expect(result.terminal.output).not.toContain('dsh > │Describe a task')

      result.terminal.output = ''
      blink()
      await tick()
      expect(result.terminal.output).toContain('dsh > │Describe a task')
    } finally {
      intervalSpy.mockRestore()
      await dispose(result)
    }
  })

  it('does not render or schedule the caret when cursor display is disabled', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const result = await setup({ config: { showHardwareCursor: false } })
    try {
      const call = intervalSpy.mock.calls.find(([, delay]) => delay === CURSOR_BLINK_INTERVAL_MS)
      expect(call).toBeUndefined()
      expect(result.terminal.output).toContain('dsh > Describe a task')
      expect(result.terminal.output).not.toContain('dsh > │Describe a task')
    } finally {
      intervalSpy.mockRestore()
      await dispose(result)
    }
  })
})

describe('shared settings, appearance, and workspaces', () => {
  const composeFrontDoorServices = (
    install: (ctx: Context) => void,
  ) => async (ctx: Context): Promise<void> => {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    install(ctx)
  }

  it('persists /theme through the shared ui-theme field and exposes the settings document', async () => {
    const uiTheme = settingsNamespace('ui-theme')
    let preference = 'system'
    const mutate = vi.fn(async (
      namespace: string,
      ops: ReadonlyArray<{ op: string; path: readonly string[]; value?: unknown }>,
    ) => {
      const previous = { preference }
      const operation = ops[0]
      if (namespace === uiTheme && operation?.op === 'set' && operation.path.join('.') === 'preference') {
        preference = String(operation.value)
        const next = { preference }
        resultContext?.emit('settings/updated', uiTheme, next, previous, 'update')
      }
    })
    let resultContext: Context | undefined
    const result = await setup({
      configureContext: composeFrontDoorServices((ctx) => {
        resultContext = ctx
        ctx.provide('settings', {
          get: (namespace: string) => namespace === uiTheme ? { preference } : undefined,
          mutate,
          describe: () => [{
            ns: uiTheme,
            schema: { type: 'object' },
            value: { preference },
            revision: 0,
            applies: 'live',
          }],
          writable: true,
          documentPath: '/home/test/.dsh/settings.yml',
          prepareDocument: () => Promise.resolve('/home/test/.dsh/settings.yml'),
        } as never)
      }),
    })

    result.terminal.send('/theme dark')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(mutate).toHaveBeenCalledWith(uiTheme, [{ op: 'set', path: ['preference'], value: 'dark' }])
    expect(result.terminal.output).toContain('Theme preference: dark')

    result.terminal.send('/settings document')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('/home/test/.dsh/settings.yml')
    await dispose(result)
  })

  it('shares /language with the Web locale preference and refreshes terminal chrome', async () => {
    const localeNamespace = settingsNamespace('locale')
    let preference = 'en'
    let resultContext: Context | undefined
    const mutate = vi.fn(async (
      namespace: string,
      ops: ReadonlyArray<{ op: string; path: readonly string[]; value?: unknown }>,
    ) => {
      const operation = ops[0]
      if (namespace !== localeNamespace || operation?.op !== 'set') return
      const previous = { preference }
      preference = String(operation.value)
      resultContext?.emit('settings/updated', localeNamespace, { preference }, previous, 'update')
    })
    const result = await setup({
      configureContext: composeFrontDoorServices((ctx) => {
        resultContext = ctx
        ctx.provide('settings', {
          get: (namespace: string) => namespace === localeNamespace ? { preference } : undefined,
          mutate,
          describe: () => [{
            ns: localeNamespace,
            schema: { type: 'object' },
            value: { preference },
            revision: 0,
            applies: 'live',
          }],
          writable: true,
          documentPath: '/home/test/.dsh/settings.yml',
          prepareDocument: () => Promise.resolve('/home/test/.dsh/settings.yml'),
        } as never)
      }),
    })

    result.terminal.send('/language zh')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(mutate).toHaveBeenCalledWith(localeNamespace, [{ op: 'set', path: ['preference'], value: 'zh' }])
    expect(result.terminal.output).toContain('界面语言已切换为中文。')
    expect(result.terminal.output).toContain('描述任务，@ 添加文件，或输入 / 查看命令')

    expect(resultContext).toBeDefined()
    resultContext?.emit('settings/updated', localeNamespace, { preference: 'en' }, { preference: 'zh' }, 'update')
    await tick()
    expect(result.terminal.output).toContain('Describe a task, @ a file, or / for commands')
    await dispose(result)
  })

  it('lists durable workspaces without rewriting the current session cwd', async () => {
    const workspace = workspaceFixture('secondary-workspace', '/secondary', 'Secondary project')
    const result = await setup({
      cwd: '/workspace',
      configureContext: composeFrontDoorServices((ctx) => {
        ctx.provide('workspaceRegistry', {
          list: () => [workspace],
          create: () => Promise.resolve(workspace),
        } as never)
      }),
    })

    result.terminal.send('/workspace')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Select workspace')
    expect(result.terminal.output).toContain('Secondary project')
    expect(result.terminal.output).toContain('/secondary')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('this host cannot start it in place')
    expect(result.session.header.cwd).toBe('/workspace')
    await dispose(result)
  })

  it('latches a workspace selection before asynchronous preflight', async () => {
    const pendingStatus = Promise.withResolvers<'ok'>()
    const status = vi.fn(() => pendingStatus.promise)
    const workspace = workspaceFixture('latched-workspace', '/latched', 'Latched project', status)
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffWorkspace']>>(
      () => Promise.reject(new Error('test host retained process')),
    )
    const result = await setup({
      handoffWorkspace: handoff,
      configureContext: composeFrontDoorServices((ctx) => {
        ctx.provide('workspaceRegistry', {
          list: () => [workspace],
          create: () => Promise.resolve(workspace),
        } as never)
      }),
    })

    result.terminal.send('/workspace')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('\r')
    result.terminal.send('\r')
    await tick()
    expect(status).toHaveBeenCalledTimes(1)
    pendingStatus.resolve('ok')
    await tick(); await tick()
    expect(handoff).toHaveBeenCalledTimes(1)
    await dispose(result)
  })

  it('creates a path entry and hands off a fresh session while preserving the old header', async () => {
    const status = vi.fn(() => Promise.resolve('ok' as const))
    const target = workspaceFixture('created-workspace', '/fresh-project', 'fresh-project', status)
    const create = vi.fn(() => Promise.resolve(target))
    // oxlint-disable-next-line prefer-const -- handoff runs later but closes over the post-setup harness.
    let mounted: Awaited<ReturnType<typeof setup>> | undefined
    let outputAtHandoff = 0
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffWorkspace']>>(
      () => {
        if (mounted === undefined) throw new Error('test handoff ran before mount completed')
        outputAtHandoff = mounted.terminal.output.length
        return Promise.reject(new Error('test host retained process'))
      },
    )
    const result = await setup({
      cwd: '/workspace',
      handoffWorkspace: handoff,
      configureContext: composeFrontDoorServices((ctx) => {
        ctx.provide('workspaceRegistry', { list: () => [], create } as never)
      }),
    })
    mounted = result

    result.terminal.send('/workspace /fresh-project')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(create).toHaveBeenCalledWith('/fresh-project')
    expect(status).toHaveBeenCalledTimes(1)
    expect(handoff).toHaveBeenCalledWith('/fresh-project')
    expect(result.session.header.cwd).toBe('/workspace')
    expect(result.terminal.stopped).toBeGreaterThan(0)
    expect(result.terminal.output).toContain('Workspace switch failed: test host retained process')
    expect(result.terminal.output.slice(outputAtHandoff)).toContain('Coding agent ready.')
    await dispose(result)
  })

  it('starts a fresh current-workspace session through /new and /clear', async () => {
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffWorkspace']>>(
      () => Promise.reject(new Error('test host retained process')),
    )
    const result = await setup({ cwd: '/workspace', handoffWorkspace: handoff })

    result.terminal.send('/new')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(handoff).toHaveBeenNthCalledWith(1, '/workspace')
    expect(result.terminal.output).toContain('New session failed: test host retained process')

    result.terminal.send('/clear')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(handoff).toHaveBeenNthCalledWith(2, '/workspace')
    expect(result.session.header.cwd).toBe('/workspace')
    expect(result.terminal.stopped).toBeGreaterThanOrEqual(2)

    result.terminal.send('/new with-a-prompt')
    result.terminal.send('\r')
    result.terminal.send('/clear later')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Usage: /new (no arguments)')
    expect(result.terminal.output).toContain('Usage: /clear (no arguments)')
    expect(handoff).toHaveBeenCalledTimes(2)
    await dispose(result)
  })

  it('keeps /new in the current process when a fresh-session handoff is unavailable or busy', async () => {
    const unavailable = await setup({ cwd: '/workspace' })
    unavailable.terminal.send('/new')
    unavailable.terminal.send('\r')
    await tick(); await tick()
    expect(unavailable.terminal.output).toContain('New session is available, but this host cannot start it in place.')
    await dispose(unavailable)

    const busyHandoff = vi.fn<NonNullable<TuiRuntime['handoffWorkspace']>>()
    const busy = await setup({ cwd: '/workspace', handoffWorkspace: busyHandoff })
    busy.agent.status = 'running'
    busy.terminal.send('/new')
    busy.terminal.send('\r')
    await tick(); await tick()
    expect(busy.terminal.output).toContain('New session command failed: Starting a session requires an idle agent')
    expect(busyHandoff).not.toHaveBeenCalled()
    await dispose(busy)
  })

  it('does not stop pi-tui twice when root disposal follows a committed workspace handoff', async () => {
    const target = workspaceFixture('committed-workspace', '/committed', 'Committed project')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffWorkspace']>>(
      () => new Promise<never>(() => {}),
    )
    const result = await setup({
      handoffWorkspace: handoff,
      configureContext: composeFrontDoorServices((ctx) => {
        ctx.provide('workspaceRegistry', {
          list: () => [],
          create: () => Promise.resolve(target),
        } as never)
      }),
    })

    result.terminal.send('/workspace /committed')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(handoff).toHaveBeenCalledOnce() })
    expect(result.terminal.stopped).toBe(1)
    await result.controller.dispose()
    expect(result.terminal.stopped).toBe(1)
    await result.ctx.fiber.dispose()
  })
})

describe('goodbye message and /resume', () => {
  const header = (id: string, createdAt: number, cwd: string): SessionHeader =>
    ({ version: 0, id: SessionId(id), createdAt, cwd })
  const resumeEvents = (
    title: string,
    provider = 'deepseek-official',
    time = 100,
    reason: TurnEndReason = { kind: 'completed' },
  ): SessionEvent[] => [
    { type: 'turn/start', seq: 0, time, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: time + 1, data: createUserMessage({
      content: [{ type: 'text', text: 'resume me' }], source: { kind: 'user' },
    }), surfaceOp: 'append' },
    { type: 'step/start', seq: 2, time: time + 2, data: { turn: 1, step: 1 } },
    { type: 'request/header', seq: 3, time: time + 3, data: { header: { config: { provider, model: 'model-1' } }, reason: 'initial' } },
    { type: 'assistant/message', seq: 4, time: time + 4, data: {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{ provider, model: 'model-1' },
        },
      }),
    }, surfaceOp: 'append' },
    { type: 'step/end', seq: 5, time: time + 5, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 6, time: time + 6, data: { turn: 1, reason } },
    { type: 'session/title', seq: 7, time: time + 7, data: { title, messageSeqs: [1], source: { kind: 'fallback' } } },
  ]
  /** Derive the selector's batch title read from a fake per-session readSession. */
  const titlesViaReadSession = (
    readSession: (id: SessionId) => Promise<{ session: SessionHeader; events: SessionEvent[] }>,
  ) => (ids: readonly SessionId[]) => Promise.all(ids.map(async (sessionId) => {
    try {
      const snapshot = await readSession(sessionId)
      const titleEvent = snapshot.events.findLast(event => event.type === 'session/title')
      const title = titleEvent?.type === 'session/title' ? { title: titleEvent.data.title } : undefined
      return {
        sessionId,
        status: 'fulfilled',
        value: { session: snapshot.session, ...title === undefined ? {} : { title } },
      }
    } catch (reason) {
      return { sessionId, status: 'rejected', reason }
    }
  }))

  it('prints the host goodbye message on exit', async () => {
    const result = await setup({
      cwd: '/workspace',
      goodbyeMessage: 'To resume this session: dsh --resume main-session',
    })
    result.terminal.send('/exit')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('To resume this session: dsh --resume main-session')
    expect(result.exit).toHaveBeenCalledWith(0)
    await dispose(result)
  })

  it('prints nothing on exit when the host supplies no goodbye message', async () => {
    const result = await setup({ cwd: '/workspace' })
    result.terminal.send('/exit')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).not.toContain('To resume this session')
    expect(result.exit).toHaveBeenCalledWith(0)
    await dispose(result)
  })

  it('escapes terminal controls in the host goodbye message', async () => {
    const result = await setup({
      cwd: '/workspace',
      goodbyeMessage: 'resume \u001b]2;hijacked\u0007now',
    })
    result.terminal.send('/exit')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('resume \\x1b]2;hijacked\\x07now')
    expect(result.terminal.output).not.toContain('\u001b]2;hijacked')
    await dispose(result)
  })

  it('opens a newest-active-first searchable selector and Esc clears before cancelling', async () => {
    const older = header('older-session', 500, '/workspace')
    const newer = header('newer-session', 2000, '/workspace')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>()
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      sessionPersistence: {
        list: async () => [older, newer, header('foreign-session', 3000, '/elsewhere')],
        load: async id => id === newer.id
          ? { meta: newer, events: resumeEvents('Newer product work', 'deepseek-official', 300) }
          : { meta: older, events: resumeEvents('Older investigation', 'deepseek-official', 100) },
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    const output = result.terminal.output
    expect(output).toContain('Resume session')
    expect(output).toContain('Newer product work')
    expect(output).toContain('Older investigation')
    expect(output).toContain('current · live')
    expect(output.indexOf('Newer product work')).toBeLessThan(output.indexOf('Older investigation'))
    // Default scope is the current workspace; one of the four records (three
    // listed plus the live current session) belongs to another.
    expect(output).not.toContain('foreign-session')
    expect(output).toContain('all workspaces (4)')
    result.terminal.send('Older')
    await tick()
    expect(result.terminal.output).toContain('⌕ Older')
    result.terminal.send('\x1b')
    await tick()
    expect(result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session')))
      .not.toContain('⌕ Older')
    result.terminal.send('\x1b')
    await tick()
    expect(handoff).not.toHaveBeenCalled()
    await dispose(result)
  })

  it('resumes an exact persisted session id without opening the selector', async () => {
    const target = header('direct-target', 10, '/direct-workspace')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>(
      () => Promise.reject(new Error('test host retained process')),
    )
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Direct target') }),
      },
    })

    result.terminal.send('/resume direct-target')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(handoff).toHaveBeenCalledWith(target.id, '/direct-workspace')
    expect(result.terminal.output).toContain('Resume handoff failed: test host retained process')
    expect(result.terminal.output).not.toContain('Resume session')

    result.terminal.send('/resume missing-target')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Session "missing-target" is no longer available.')
    expect(handoff).toHaveBeenCalledTimes(1)
    await dispose(result)
  })

  it('handles selector navigation, empty matches, and backspace search edits', async () => {
    const target = header('keyboard-target', 10, '/workspace')
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Keyboard target') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('\x1b[B')
    result.terminal.send('\x1b[A')
    // A key the search editor swallows without changing its value (backspace on
    // an empty box) keeps the selection and error untouched.
    result.terminal.send('\x7f')
    result.terminal.send('zz')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('No session matches this search')
    result.terminal.send('\x7f')
    result.terminal.send('\x7f')
    await tick()
    const cleared = result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session'))
    expect(cleared).toContain('⌕ ')
    expect(cleared).not.toContain('zz')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('current session')
    result.terminal.send('\x1b')
    await dispose(result)
  })

  it('sanitizes bracketed-paste terminal controls before storing the search query', async () => {
    const target = header('safe-target', 10, '/workspace')
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Safe target') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('\x1b[200~Safe\x1b]0;own')
    result.terminal.send('ed\x07 target\x1b[31m\x1b[201~')
    await tick()
    const rendered = result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session'))
    expect(rendered).toContain('⌕ Safe target')
    expect(rendered).not.toContain('owned')
    expect(rendered).not.toContain('[31m')
    result.terminal.send('\x1b')
    result.terminal.send('Safe\x1b[200~\x1b[201~ target')
    await tick()
    expect(result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session')))
      .toContain('⌕ Safe target')
    await dispose(result)
  })

  it('pages by the number of candidates that fit the current viewport', async () => {
    const targets = Array.from({ length: 8 }, (_, index) =>
      header(`paged-${index}`, 1000 - index, '/workspace'))
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => targets,
        load: async id => ({
          meta: targets.find(target => target.id === id)!,
          events: resumeEvents(`Paged ${id.slice('paged-'.length)}`, 'deepseek-official', 1000 - Number(id.slice('paged-'.length)) * 10),
        }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('\x1b[6~')
    await tick()
    const rendered = result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session'))
    expect(rendered).toContain('❯ Paged 5')
    result.terminal.send('\x1b[5~')
    await tick()
    expect(result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session')))
      .toContain('❯ Untitled session')
    result.terminal.resize(10)
    await tick()
    expect(result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session')))
      .toContain('⌕')
    result.terminal.send('\x03')
    await dispose(result)
  })

  it('clips candidate count through the configured visible-session limit', async () => {
    const targets = [header('limited-a', 10, '/workspace'), header('limited-b', 20, '/workspace')]
    const result = await setup({
      cwd: '/workspace',
      config: { maxResumeOptions: 1 },
      sessionPersistence: {
        list: async () => targets,
        load: async id => ({
          meta: targets.find(target => target.id === id)!,
          events: resumeEvents(`Limited ${id}`),
        }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('(1 of 3)')
    await dispose(result)
  })

  it('resolves titles through the projection cache without scanning logs', async () => {
    const current = header('main-session', 5, '/workspace')
    const cachedRow = header('cached-title', 40, '/workspace')
    const rowless = header('rowless-title', 30, '/workspace')
    const untitled = header('untitled-title', 20, '/workspace')
    const broken = header('broken-title', 10, '/workspace')
    let coldReads = 0
    const result = await setup({
      cwd: '/workspace',
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('sessionQuery', {
          listSessions: () => Promise.resolve([
            { header: current, live: true, persisted: false },
            { header: cachedRow, live: false, persisted: true },
            { header: rowless, live: false, persisted: true },
            { header: untitled, live: false, persisted: true },
            { header: broken, live: false, persisted: true },
          ]),
          readTitleSnapshots: () => Promise.reject(new Error('the ladder must not scan logs')),
        } as never)
        ctx.provide('sessionProjections', {
          snapshot: () => ({ asOfSeq: 0, values: { title: 'Live projected' } }),
        } as never)
        ctx.provide('sessionProjectionCache', {
          cachedSnapshot: (meta: SessionHeader) => {
            if (meta.id === cachedRow.id) return { asOfSeq: 3, values: { title: 'Cached projected' } }
            if (meta.id === untitled.id) return { asOfSeq: 3, values: { title: null } }
            if (meta.id === rowless.id) return { asOfSeq: 3, values: {} }
            return undefined
          },
          coldSnapshot: async (id: SessionId) => {
            coldReads += 1
            if (id === broken.id) throw new Error('checkpoint restore failed')
            return { asOfSeq: 5, values: { title: 'Cold projected' } }
          },
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Live projected')
    expect(result.terminal.output).toContain('Cached projected')
    expect(result.terminal.output).toContain('Cold projected')
    expect(result.terminal.output).toContain('Untitled session')
    expect(result.terminal.output).toContain('Unreadable session')
    expect(result.terminal.output).toContain('checkpoint restore failed')
    expect(result.terminal.output).not.toContain('the ladder must not scan logs')
    expect(coldReads).toBe(2)
    await dispose(result)
  })

  it('shows a live row untitled when the cache is mounted without the registry', async () => {
    const current = header('main-session', 5, '/workspace')
    const result = await setup({
      cwd: '/workspace',
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('sessionQuery', {
          listSessions: () => Promise.resolve([{ header: current, live: true, persisted: false }]),
        } as never)
        ctx.provide('sessionProjectionCache', {
          cachedSnapshot: () => undefined,
          coldSnapshot: async () => ({ asOfSeq: -1, values: {} }),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Untitled session')
    await dispose(result)
  })

  it('orders rows by artifact mtime without reading logs for the timestamp', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-resume-mtime-'))
    const stale = join(dir, 'stale.log')
    const fresh = join(dir, 'fresh.log')
    await writeFile(stale, 'x')
    await writeFile(fresh, 'x')
    await utimes(stale, new Date(1000), new Date(60_000))
    await utimes(fresh, new Date(1000), new Date(120_000))
    // Creation order contradicts mtime order, so the sort proves its source.
    const createdLate = header('created-late-touched-early', 50, '/workspace')
    const createdEarly = header('created-early-touched-late', 40, '/workspace')
    const gone = header('artifact-gone', 30, '/workspace')
    const goneTwin = header('artifact-gone-twin', 30, '/workspace')
    const paths = new Map([
      [createdLate.id, stale],
      [createdEarly.id, fresh],
      [gone.id, join(dir, 'missing.log')],
      [goneTwin.id, join(dir, 'missing-twin.log')],
    ])
    const titles = new Map([
      [createdLate.id, 'Touched early'],
      [createdEarly.id, 'Touched late'],
      [gone.id, 'Artifact gone'],
      [goneTwin.id, 'Artifact gone twin'],
    ])
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => [createdLate, createdEarly, gone, goneTwin],
        load: async id => ({
          meta: [createdLate, createdEarly, gone, goneTwin].find(target => target.id === id)!,
          events: resumeEvents(titles.get(id)!),
        }),
        locate: meta => ({ kind: 'jsonl', path: paths.get(meta.id)! }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    const rendered = result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session'))
    expect(rendered).toContain(new Date(120_000).toISOString())
    expect(rendered.indexOf('Touched late')).toBeLessThan(rendered.indexOf('Touched early'))
    // A missing artifact falls back to the header's creation time; equal
    // times tie-break by id.
    expect(rendered).toContain(new Date(gone.createdAt).toISOString())
    expect(rendered.indexOf('artifact-gone')).toBeLessThan(rendered.indexOf('artifact-gone-twin'))
    await rm(dir, { recursive: true, force: true })
    await dispose(result)
  })

  it('refuses while running instead of cancelling or switching', async () => {
    const result = await setup({ cwd: '/workspace', status: 'running' })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('finish or be cancelled first')
    expect(result.agent.cancelled).toEqual([])
    await dispose(result)
  })

  it('warns when the optional session-query service is absent', async () => {
    const result = await setup({ cwd: '/workspace', mountSessionQuery: false })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('session query is not mounted')
    await dispose(result)
  })

  it('allows a transient session-query state but rejects a terminal state', async () => {
    let queryCtx: Context | undefined
    let listCalls = 0
    const result = await setup({
      cwd: '/workspace',
      async configureContext(ctx) {
        await ctx.plugin({
          apply(child: Context) {
            queryCtx = child
            child.provide('sessionQuery', {
              listSessions: async () => { listCalls++; return [] },
              readTitleSnapshots: async () => [],
            } as never)
          },
        })
      },
    })
    if (queryCtx === undefined) throw new Error('query provider did not mount')
    const activeState = queryCtx.fiber.state
    queryCtx.fiber.state = 0
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(listCalls).toBe(1)
    result.terminal.send('\u001B')
    await tick()
    queryCtx.fiber.state = 5
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('session query is not mounted')
    expect(listCalls).toBe(1)
    queryCtx.fiber.state = activeState
    await dispose(result)
  })

  it('keeps persisted query records readable without a persistence service', async () => {
    const target = header('query-only-persisted', 10, '/workspace')
    const result = await setup({
      cwd: '/workspace',
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        const readSession = () => Promise.resolve({
          session: target,
          events: resumeEvents('Query-only persisted session'),
        })
        ctx.provide('sessionQuery', {
          listSessions: () => Promise.resolve([{
            header: target,
            live: false,
            persisted: true,
          }]),
          readSession,
          readTitleSnapshots: titlesViaReadSession(readSession),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Query-only persisted session')
    expect(result.terminal.output).toContain('persisted')
    expect(result.terminal.output).not.toContain('session cannot be loaded')
    await dispose(result)
  })

  it('contains a session-query scan failure in the current TUI', async () => {
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('sessionQuery', {
          listSessions: () => Promise.reject(new Error('index unavailable')),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Resume session scan failed: index unavailable')
    expect(result.terminal.stopped).toBe(0)
    await dispose(result)
  })

  it('supersedes a slower prior selector scan', async () => {
    const first = Promise.withResolvers<SessionRecord[]>()
    let calls = 0
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('sessionQuery', {
          listSessions: () => ++calls === 1 ? first.promise : Promise.resolve([]),
          readTitleSnapshots: async () => [],
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    // The loading picker owns input as soon as /resume runs, so the second
    // scan starts after dismissing the first overlay, not by typing a second
    // slash command over it.
    result.terminal.send('\u001B')
    await tick()
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    first.reject(new Error('superseded scan failed'))
    await tick()
    expect(calls).toBe(2)
    expect(result.terminal.output).toContain('No matching sessions')
    expect(result.terminal.output).not.toContain('superseded scan failed')
    result.terminal.send('\x1b[A')
    result.terminal.send('\x1b[B')
    await dispose(result)
  })

  it('drops a selector scan that resolves after TUI disposal', async () => {
    const listing = Promise.withResolvers<SessionRecord[]>()
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('sessionQuery', { listSessions: () => listing.promise } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    await dispose(result)
    listing.resolve([])
    await tick()
    expect(result.terminal.stopped).toBeGreaterThan(0)
  })

  it('clears the still-loading error the moment scanned rows arrive', () => {
    const picker = new ResumePicker(
      undefined,
      10,
      '/workspace',
      () => 30,
      createPalette(false),
      () => {},
      () => {},
    )
    picker.focused = true
    picker.handleInput('\r')
    expect(picker.render(80).join('\n')).toContain('Sessions are still loading.')
    picker.setCandidates([])
    const rendered = picker.render(80).join('\n')
    expect(rendered).not.toContain('Sessions are still loading.')
    expect(rendered).toContain('No matching sessions.')
  })

  it('aborts an in-flight scan when the loading picker is dismissed', async () => {
    const listing = Promise.withResolvers<SessionRecord[]>()
    let scanSignal: AbortSignal | undefined
    let projections = 0
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('sessionQuery', {
          listSessions: (signal?: AbortSignal) => { scanSignal = signal; return listing.promise },
          readTitleSnapshots: async () => { projections += 1; return [] },
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Loading sessions…')
    result.terminal.send('\u001B')
    await tick()
    expect(scanSignal?.aborted).toBe(true)
    // A signal-ignoring backend can still fulfill after dismissal: the stale
    // scan must neither read titles nor report.
    listing.resolve([])
    await tick()
    expect(projections).toBe(0)
    expect(result.terminal.output).not.toContain('Resume session scan failed')
    await dispose(result)
  })

  it('drops a title read that settles after the picker was dismissed', async () => {
    const projecting = Promise.withResolvers<never[]>()
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('sessionQuery', {
          listSessions: async () => [],
          readTitleSnapshots: () => projecting.promise,
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('\u001B')
    await tick()
    projecting.resolve([])
    await tick()
    expect(result.terminal.output).not.toContain('(0 of 0)')
    expect(result.terminal.output).not.toContain('Resume session scan failed')
    await dispose(result)
  })

  it('closes the loading picker and reports a scan that fails after listing', async () => {
    const target = header('titles-explode', 10, '/workspace')
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('sessionQuery', {
          listSessions: () => Promise.resolve([{ header: target, live: false, persisted: true }]),
          readTitleSnapshots: () => Promise.reject(new Error('titles exploded')),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Resume session scan failed: titles exploded')
    expect(result.terminal.stopped).toBe(0)
    await dispose(result)
  })

  it('opens a loading picker immediately and swaps in the scanned rows', async () => {
    const target = header('late-listing', 10, '/workspace')
    const listing = Promise.withResolvers<SessionRecord[]>()
    const result = await setup({
      cwd: '/workspace',
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        const readSession = () => Promise.resolve({
          session: target,
          events: resumeEvents('Late listing'),
        })
        ctx.provide('sessionQuery', {
          listSessions: () => listing.promise,
          readSession,
          readTitleSnapshots: titlesViaReadSession(readSession),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Loading sessions…')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Sessions are still loading.')
    listing.resolve([{ header: target, live: false, persisted: true }])
    await tick(); await tick()
    expect(result.terminal.output).toContain('Late listing')
    await dispose(result)
  })

  it('drops loaded selector summaries when the TUI disposed during log reads', async () => {
    const target = header('dispose-during-load', 10, '/workspace')
    const loading = Promise.withResolvers<{ meta: SessionHeader; events: SessionEvent[] }>()
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => [target],
        load: () => loading.promise,
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    await dispose(result)
    loading.resolve({ meta: target, events: resumeEvents('Disposed load') })
    await tick()
    expect(result.terminal.stopped).toBeGreaterThan(0)
  })

  it('preflights route availability and corrupt sessions without losing the current TUI', async () => {
    const missing = header('missing-route', 10, '/workspace')
    const corrupt = header('corrupt', 30, '/workspace')
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => [missing, corrupt],
        load: async (id) => {
          if (id === corrupt.id) throw new Error('checksum mismatch')
          return {
            meta: missing,
            events: resumeEvents('Missing adapter', 'absent-provider'),
          }
        },
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Missing adapter')
    // Rows carry no route: availability surfaces only at Enter-time preflight.
    expect(result.terminal.output).not.toContain('absent-provider/model-1')
    expect(result.terminal.output).toContain('Unreadable session')
    result.terminal.send('Missing adapter')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('route is currently unavailable')
    expect(result.terminal.stopped).toBe(0)
    await dispose(result)
  })

  it('keeps a session already live in this runtime visible but disabled', async () => {
    const target = header('live-target', 10, '/workspace')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>()
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        const readSession = () => Promise.resolve({
          session: target,
          events: resumeEvents('Live target'),
        })
        ctx.provide('sessionQuery', {
          listSessions: () => Promise.resolve([{
            header: target,
            live: true,
            persisted: true,
          }]),
          readSession,
          readTitleSnapshots: titlesViaReadSession(readSession),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Live target')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('session is already live in this runtime')
    expect(handoff).not.toHaveBeenCalled()
    await dispose(result)
  })

  it('rechecks record liveness at preflight rather than trusting the listed row', async () => {
    const target = header('turns-live', 10, '/workspace')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>()
    let listings = 0
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        const readSession = () => Promise.resolve({
          session: target,
          events: resumeEvents('Turns live'),
        })
        ctx.provide('sessionQuery', {
          listSessions: () => Promise.resolve([{
            header: target,
            live: ++listings > 1,
            persisted: true,
          }]),
          readSession,
          readTitleSnapshots: titlesViaReadSession(readSession),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Turns live')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('session is already live in this runtime')
    expect(handoff).not.toHaveBeenCalled()
    await dispose(result)
  })

  it('falls back to assistant provenance and header creation time for sparse logs', async () => {
    const assistantOnly = header('assistant-route', 20, '/workspace')
    const empty = header('empty-log', 10, '/workspace')
    const events = resumeEvents('Assistant route', 'absent-provider')
      .filter(event => event.type !== 'request/header')
      .map((event, seq) => ({ ...event, seq })) as SessionEvent[]
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => [assistantOnly, empty],
        load: async id => id === assistantOnly.id
          ? { meta: assistantOnly, events }
          : { meta: empty, events: [] },
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    // Without a persisted artifact to stat, listing falls back to creation time.
    expect(result.terminal.output).toContain(new Date(empty.createdAt).toISOString())
    // The preflight route fold falls back to assistant provenance when the
    // log carries no request header.
    result.terminal.send('Assistant route')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('route is currently unavailable')
    // The failed preflight closed the picker; reopen and pick the routeless
    // log, which passes the route check — only the absent host stops it.
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('empty-log')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('cannot hand it off in place')
    await dispose(result)
  })

  it('flushes, releases the terminal, and invokes one host handoff for the same SessionId and workspace', async () => {
    const target = header('target-session', 10, '/workspace')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>(() => Promise.reject(new Error('test host retained process')))
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Target session') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Target session')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(handoff).toHaveBeenCalledTimes(1)
    expect(handoff).toHaveBeenCalledWith(target.id, '/workspace')
    expect(result.terminal.stopped).toBeGreaterThan(0)
    expect(result.terminal.output).toContain('Resume handoff failed: test host retained process')
    await dispose(result)
  })

  it('restores the UI when a host returns instead of replacing the process', async () => {
    const target = header('returning-host', 10, '/workspace')
    const result = await setup({
      cwd: '/workspace',
      handoffResume: async () => undefined as never,
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Returning host') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Returning host')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('resume host returned without replacing the process')
    await dispose(result)
  })

  it('keeps the current TUI when the selected log fails its second preflight load', async () => {
    const target = header('racing-corruption', 10, '/workspace')
    let loads = 0
    const result = await setup({
      cwd: '/workspace',
      handoffResume: vi.fn(),
      sessionPersistence: {
        list: async () => [target],
        load: async () => {
          if (++loads > 1) throw new Error('log changed during selection')
          return { meta: target, events: resumeEvents('Racing corruption') }
        },
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Racing corruption')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Resume failed: session cannot be loaded: failed to inspect session')
    expect(result.terminal.output).toContain('log changed during selection')
    expect(result.terminal.stopped).toBe(0)
    await dispose(result)
  })

  it('does not flush or hand off when disposal begins during selected-session preflight', async () => {
    const target = header('dispose-during-preflight', 10, '/workspace')
    const secondListing = Promise.withResolvers<SessionRecord[]>()
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>()
    const flush = vi.fn()
    let listings = 0
    const record: SessionRecord = { header: target, live: false, persisted: true }
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.on('session/flush', flush)
        const readSession = () => Promise.resolve({
          session: target,
          events: resumeEvents('Dispose during preflight'),
        })
        ctx.provide('sessionQuery', {
          listSessions: () => ++listings === 1 ? Promise.resolve([record]) : secondListing.promise,
          readSession,
          readTitleSnapshots: titlesViaReadSession(readSession),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('Dispose during preflight')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(listings).toBe(2) })
    await dispose(result)
    secondListing.resolve([record])
    await tick()
    expect(flush).not.toHaveBeenCalled()
    expect(handoff).not.toHaveBeenCalled()
  })

  it('hands off a validated session exposed by a query backend without a persistence service', async () => {
    const target = header('query-without-persistence', 10, '/workspace')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>(
      () => Promise.reject(new Error('test host retained process')),
    )
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        const readSession = () => Promise.resolve({
          session: target,
          events: resumeEvents('Query without persistence'),
        })
        ctx.provide('sessionQuery', {
          listSessions: () => Promise.resolve([{
            header: target,
            live: false,
            persisted: true,
          }]),
          readSession,
          readTitleSnapshots: titlesViaReadSession(readSession),
        } as never)
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Query without persistence')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(handoff).toHaveBeenCalledWith(target.id, '/workspace')
    expect(result.terminal.output).toContain('Resume handoff failed: test host retained process')
    await dispose(result)
  })

  it('does not hand off after disposal begins during the current-session flush', async () => {
    const target = header('dispose-during-flush', 10, '/workspace')
    const flushing = Promise.withResolvers<undefined>()
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>()
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.on('session/flush', () => flushing.promise)
      },
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Dispose during flush') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Dispose during flush')
    result.terminal.send('\r')
    await tick()
    const disposing = dispose(result)
    await tick()
    flushing.resolve(undefined)
    await disposing
    expect(handoff).not.toHaveBeenCalled()
  })

  it('does not hand off after disposal begins while terminal input drains', async () => {
    const target = header('dispose-during-drain', 10, '/workspace')
    const draining = Promise.withResolvers<undefined>()
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>()
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Dispose during drain') }),
      },
    })
    result.terminal.drainInput.mockImplementationOnce(() => draining.promise)
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Dispose during drain')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.terminal.drainInput).toHaveBeenCalled() })
    await dispose(result)
    draining.resolve(undefined)
    await tick()
    expect(handoff).not.toHaveBeenCalled()
  })

  it('does not restart the terminal when a pending host rejects during disposal', async () => {
    const target = header('host-rejects-during-disposal', 10, '/workspace')
    const host = Promise.withResolvers<never>()
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>(() => host.promise)
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Host disposal') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Host disposal')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(handoff).toHaveBeenCalled() })
    const startsBeforeDispose = result.terminal.started
    await dispose(result)
    host.reject(new Error('host rejected after disposal'))
    await tick()
    expect(result.terminal.started).toBe(startsBeforeDispose)
    expect(result.terminal.output).not.toContain('host rejected after disposal')
  })

  // A cwd that changes between listing and preflight is no longer a rejection:
  // resume targets whatever workspace the record names at preflight, so the
  // handoff must carry the RE-READ cwd rather than the one the row displayed.
  it('hands off with the cwd re-read at preflight, not the one listed', async () => {
    const target = header('moving-workspace', 10, '/workspace')
    const moved = header('moving-workspace', 10, '/elsewhere')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>(
      () => Promise.reject(new Error('test host retained process')),
    )
    let listings = 0
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      sessionPersistence: {
        list: async () => [++listings <= 2 ? target : moved],
        load: async () => ({
          meta: listings <= 2 ? target : moved,
          events: resumeEvents('Moving workspace'),
        }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Moving workspace')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(handoff).toHaveBeenCalledWith(target.id, '/elsewhere')
    await dispose(result)
  })

  it('keeps a session with no recorded workspace visible but disabled', async () => {
    // The key is omitted, not set to undefined: an explicit undefined is not
    // losslessly JSON-serializable and the header validator rejects it.
    const { cwd: _cwd, ...rootless } = header('no-workspace', 10, '/workspace')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>()
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      sessionPersistence: {
        list: async () => [rootless],
        load: async () => ({ meta: rootless, events: resumeEvents('Rootless session') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    // A cwd-less session lists under all workspaces, never the current one.
    result.terminal.send('\t')
    await tick()
    result.terminal.send('Rootless session')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('session has no recorded workspace')
    expect(handoff).not.toHaveBeenCalled()
    await dispose(result)
  })

  it('lists other workspaces only in the all-workspaces scope and resumes into their cwd', async () => {
    const local = header('local-session', 2000, '/workspace')
    const foreign = header('foreign-session', 3000, '/elsewhere')
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>(
      () => Promise.reject(new Error('test host retained process')),
    )
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      sessionPersistence: {
        list: async () => [local, foreign],
        load: async id => id === local.id
          ? { meta: local, events: resumeEvents('Local product work') }
          : { meta: foreign, events: resumeEvents('Foreign investigation') },
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    // Three records: the two listed plus the live current session.
    expect(result.terminal.output).toContain('Local product work')
    expect(result.terminal.output).not.toContain('Foreign investigation')
    expect(result.terminal.output).toContain('all workspaces (3)')
    result.terminal.send('\t')
    await tick()
    const scoped = result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session'))
    expect(scoped).toContain('Foreign investigation')
    expect(scoped).toContain('workspace /elsewhere')
    expect(scoped).toContain('this workspace (2)')
    // Searching the workspace label reaches a row the title would not match.
    result.terminal.send('elsewhere')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(handoff).toHaveBeenCalledWith(foreign.id, '/elsewhere')
    await dispose(result)
  })

  it('returns to the current workspace when Tab toggles back and clears the search', async () => {
    const local = header('scope-local', 2000, '/workspace')
    const foreign = header('scope-foreign', 3000, '/elsewhere')
    const result = await setup({
      cwd: '/workspace',
      handoffResume: vi.fn(),
      sessionPersistence: {
        list: async () => [local, foreign],
        load: async id => id === local.id
          ? { meta: local, events: resumeEvents('Scope local') }
          : { meta: foreign, events: resumeEvents('Scope foreign') },
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('\t')
    await tick()
    result.terminal.send('Scope foreign')
    await tick()
    expect(result.terminal.output).toContain('⌕ Scope foreign')
    result.terminal.send('\t')
    await tick()
    const back = result.terminal.output.slice(result.terminal.output.lastIndexOf('Resume session'))
    expect(back).not.toContain('⌕ Scope foreign')
    expect(back).toContain('Scope local')
    expect(back).not.toContain('Scope foreign')
    await dispose(result)
  })

  it('admits only one handoff while the selected preflight is pending', async () => {
    const target = header('single-handoff', 10, '/workspace')
    const preflight = Promise.withResolvers<{ meta: SessionHeader; events: SessionEvent[] }>()
    let loads = 0
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => [target],
        load: () => ++loads === 1
          ? Promise.resolve({ meta: target, events: resumeEvents('Single handoff') })
          : preflight.promise,
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Single handoff')
    result.terminal.send('\r')
    result.terminal.send('\r')
    await tick()
    preflight.resolve({ meta: target, events: resumeEvents('Single handoff') })
    await tick(); await tick()
    expect(loads).toBe(2)
    await dispose(result)
  })

  it('rechecks running state and candidate existence before loading the selected log', async () => {
    const target = header('preflight-races', 10, '/workspace')
    const result = await setup({
      cwd: '/workspace',
      handoffResume: vi.fn(),
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Preflight races') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.agent.status = 'running'
    result.terminal.send('Preflight races')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Resume requires an idle agent (status: running)')
    result.agent.status = 'idle'
    await dispose(result)

    let disappearingLists = 0
    const disappearing = await setup({
      cwd: '/workspace',
      handoffResume: vi.fn(),
      sessionPersistence: {
        list: async () => ++disappearingLists <= 2 ? [target] : [],
        load: async () => ({ meta: target, events: resumeEvents('Disappearing target') }),
      },
    })
    disappearing.terminal.send('/resume')
    disappearing.terminal.send('\r')
    await tick(); await tick()
    disappearing.terminal.send('Disappearing target')
    disappearing.terminal.send('\r')
    await tick()
    expect(disappearing.terminal.output).toContain('is no longer available')
    await dispose(disappearing)
  })

  it('rechecks idleness after the selected log finishes loading', async () => {
    const target = header('load-turns-running', 10, '/workspace')
    let loads = 0
    const result = await setup({
      cwd: '/workspace',
      handoffResume: vi.fn(),
      sessionPersistence: {
        list: async () => [target],
        load: async () => {
          loads += 1
          if (loads === 2) result.agent.status = 'running'
          return { meta: target, events: resumeEvents('Load turns running') }
        },
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Load turns running')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Resume requires an idle agent (status: running)')
    result.agent.status = 'idle'
    await dispose(result)
  })

  it('warns without releasing the terminal when the host cannot hand off', async () => {
    const target = header('no-fallback-session', 10, '/workspace')
    const result = await setup({
      cwd: '/workspace',
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('No fallback target') }),
      },
    })
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('No fallback target')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('Session is resumable, but this host cannot hand it off in place')
    })
    expect(result.terminal.stopped).toBe(0)
    await dispose(result)
  })

  it('rechecks idleness after the current-session flush', async () => {
    const target = header('post-flush-running', 10, '/workspace')
    const control: { setRunning?: () => void } = {}
    const handoff = vi.fn<NonNullable<TuiRuntime['handoffResume']>>()
    const result = await setup({
      cwd: '/workspace',
      handoffResume: handoff,
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.on('session/flush', () => { control.setRunning?.() })
      },
      sessionPersistence: {
        list: async () => [target],
        load: async () => ({ meta: target, events: resumeEvents('Post-flush running') }),
      },
    })
    control.setRunning = () => { result.agent.status = 'running' }
    result.terminal.send('/resume')
    result.terminal.send('\r')
    await tick(); await tick()
    result.terminal.send('Post-flush running')
    result.terminal.send('\r')
    await tick(); await tick()
    expect(result.terminal.output).toContain('Resume requires an idle agent (status: running)')
    expect(handoff).not.toHaveBeenCalled()
    result.agent.status = 'idle'
    await dispose(result)
  })
})

describe('pi-tui chat lifecycle and transcript', () => {
  it('shows the split zero-state welcome card until the first turn begins', async () => {
    const result = await setup({ omitInitialLifecycle: true })
    await tick()
    expect(result.terminal.output).toContain('Welcome back!')
    expect(result.terminal.output).toContain("What's new")
    expect(result.terminal.output).toContain('Recent sessions')
    expect(result.terminal.output).toContain('permissions:')
    expect(result.terminal.output).toContain('/skills')
    expect(result.terminal.output).toContain('╭ Message ')

    result.terminal.output = ''
    result.session.append('turn/start', { turn: 1 })
    result.session.append('step/start', { turn: 1, step: 1 })
    await tick()
    expect(result.terminal.output).toContain('DEEPSEEK HARNESS')
    expect(result.terminal.output).not.toContain('Welcome back!')
    expect(result.terminal.output).not.toContain("What's new")
    expect(result.terminal.output).not.toContain('Recent sessions')
    await dispose(result)
  })

  it('restores durable goal phase without implying automatic continuation', async () => {
    const change: GoalSnapshotChangeMeta = {
      kind: 'goal/change',
      version: GOAL_CHANGE_VERSION,
      operation: 'create',
      goal: {
        id: GoalId('restored-goal'),
        revision: 1,
        objective: 'Resume only with human confirmation',
        phase: 'active',
        maxGoalRounds: 4,
      },
      roundsStarted: 0,
      createdAt: 10,
      updatedAt: 10,
    }
    const result = await setup({
      beforeMount(session) {
        session.append('goal/change', change)
      },
    })
    expect(result.terminal.output).toContain('Goal restored (active) with automatic continuation disarmed')
    expect(result.terminal.output).toContain('/goal resume')
    await dispose(result)
  })

  it('uses the latest log-backed title for the header subtitle and terminal window', async () => {
    const result = await setup({
      // A fixed short cwd keeps the footer's token counters inside the 88-column
      // fake terminal regardless of where the checkout lives; cwd rendering has
      // its own dedicated variants test below.
      cwd: '/workspace',
      beforeMount(session) {
        session.append('session/title', {
          title: 'Restored session title',
          messageSeqs: [1],
          source: { kind: 'fallback' },
        })
      },
    })

    expect(result.terminal.title).toBe('Restored session title — DeepSeek Harness')
    expect(result.terminal.output).toContain('Restored session title')
    expect(result.terminal.output).not.toContain('Coding agent ready.')

    result.session.append('session/title', {
      title: 'Live title \u001B]0;unsafe\u0007',
      messageSeqs: [1, 5],
      source: { kind: 'fallback' },
    })
    await tick()

    expect(result.terminal.title).toContain('Live title \\x1b]0;unsafe\\x07 — DeepSeek Harness')
    expect(result.terminal.title).not.toContain('\u001B')
    expect(result.terminal.output).toContain('Live title \\x1b]0;unsafe\\x07')
    await dispose(result)
  })

  it('renders its header, footer, replay, streaming answer, todos, and status', async () => {
    let now = 0
    const result = await setup({
      contextWindow: 100,
      contextTokens: 42,
      // Short cwd: the footer clips its right (context/tools) segment first,
      // and the default worktree path would swallow it at 88 columns.
      cwd: '/opt',
      now: () => now,
      beforeMount(session) {
        appendUser(session, 'restored prompt')
        appendAssistant(session, [
          { type: 'reasoning', text: 'restored thought' },
          { type: 'text', text: '**restored answer**' },
        ], { inputTokens: 1_250, outputTokens: 42 })
        session.append('todo/write', {
          todos: [
            { content: 'read code', status: 'completed' },
            { content: 'write tests', status: 'in_progress' },
            { content: 'ship', status: 'pending' },
          ],
        })
      },
    })

    expect(result.terminal.started).toBe(1)
    expect(result.terminal.title).toBe('DeepSeek Harness')
    expect(result.terminal.output).toContain('DEEPSEEK')
    expect(result.terminal.output).toContain('Coding agent ready.')
    expect(result.terminal.output).toContain('restored prompt')
    expect(result.terminal.output).not.toContain('restored thought')
    expect(result.terminal.output).toContain('restored answer')
    expect(result.terminal.output).toContain('write tests')
    expect(result.terminal.output).toContain('/opt (tui-staging)')
    expect(result.terminal.output).toContain('↑1.3k ↓42')
    expect(result.terminal.output).toContain('deepseek-v4-flash [alt+m]')
    expect(result.terminal.output).toContain('dsh > ')
    expect(result.terminal.output).not.toContain('main-session  deepseek-v4-flash')
    // Context resolution is async (resolveModelContext); settle before reading.
    await tick()
    expect(result.terminal.output).toContain('42% context')
    expect(result.terminal.output).not.toContain('tools:collapsed')
    // Narrow terminals clip the right-hand context/tools segment first; the
    // model-led left segment stays.
    result.terminal.resize(52)
    await tick()
    expect(result.terminal.output).toContain('deepseek-v4-flash')
    result.terminal.resize(88)
    await tick()

    result.agent.status = 'running'
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'running' })
    now = 8_000
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '   ' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'steering note' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'user context' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<system-reminder>\nAdditional instructions from: nested/AGENTS.md\n\nRender XML context clearly.\n</system-reminder>' }],
      source: { kind: 'plugin', plugin: 'workspace-context' },
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<system-reminder>&#155;</system-reminder>' }],
      source: { kind: 'plugin', plugin: 'workspace-control-context' },
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '' }], source: { kind: 'plugin', plugin: 'ctx' },
    }), { surfaceOp: 'append' })
    // A non-plugin injected source (goal) has no `plugin` field, so its context
    // card label falls back to the source kind.
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'goal context' }], source: { kind: 'goal', goalId: 'g1', revision: 1, round: 0 } as never,
    }), { surfaceOp: 'append' })
    appendAssistant(result.session, [])
    result.session.append('step/end', { turn: 1, step: 1 })
    result.session.append('turn/end', {
      turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } },
    })
    result.session.append('turn/start', { turn: 2 })
    result.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    result.session.append('turn/start', { turn: 3 })
    result.session.append('step/start', { turn: 3, step: 1 })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'live thought' },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 9, text: 'unannounced thought' },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'live thought complete' } },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'block-start', index: 1, blockType: 'text' },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'text-delta', index: 1, text: 'live answer' },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'block-end', index: 1, block: { type: 'text', text: 'live answer done' } },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'block-start', index: 2, blockType: 'tool-call' },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'block-end', index: 2, block: { type: 'tool-call', id: 'stream-tool' as never, name: 'tool', arguments: '{}' } },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'tool-call-delta', index: 2, id: 'stream-tool' as never, argumentsDelta: '{}' },
    })
    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
    })
    await tick()
    expect(result.terminal.output).not.toContain('live thought')
    result.terminal.send('\x12')
    await tick()
    expect(result.terminal.output).toContain('live thought')
    appendAssistant(
      result.session,
      [{ type: 'text', text: 'final live answer' }],
      { inputTokens: 500, outputTokens: 8 },
      { turn: 3, step: 1 },
    )
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('final live answer')
    })

    expect(result.terminal.output).toContain('Describe a task, @ a file, or / for commands')
    expect(result.terminal.output).toContain('steering note')
    expect(result.terminal.output).toContain('user context')
    expect(result.terminal.output).toContain('Context · workspace-context')
    // Injected context defaults to a compact disclosure instead of filling the
    // transcript; its content remains available through the details affordance.
    expect(result.terminal.output).toContain('▸ 3 lines hidden')
    expect(result.terminal.output).not.toContain('Additional instructions from: nested/AGENTS.md')
    expect(result.terminal.output).not.toContain('Render XML context clearly.')
    expect(result.terminal.output).not.toContain('&#155;')
    expect(result.terminal.output).not.toContain('\u009b')
    expect(result.terminal.output).toContain('Context · goal') // goal-sourced injected context labels by kind
    expect(result.terminal.output).toContain('Turn cancelled')
    expect(result.terminal.progress).toContain(true)

    result.session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'cleared stream' },
    })
    result.terminal.send('/clear')
    result.terminal.send('\r')
    await tick() // the host-less fixture reports that a fresh-session handoff is unavailable
    appendAssistant(result.session, [{ type: 'text', text: 'answer after clear' }], undefined, { turn: 3, step: 1 })
    await tick()
    expect(result.terminal.output).toContain('answer after clear')

    result.agent.status = 'idle'
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'idle' })
    await tick()
    expect(result.terminal.output).toContain('↑1.8k ↓50')
    expect(result.terminal.output).toContain('deepseek-v4-flash')
    expect(result.terminal.progress.at(-1)).toBe(false)
    await dispose(result)
    expect(result.terminal.stopped).toBe(1)
    expect(result.terminal.drainInput).toHaveBeenCalledWith(100, 20)
  })

  it('folds an injected-context card by default and expands it with Ctrl+O', async () => {
    const result = await setup()
    // The collapsed card shows only one disclosure row, hiding every injected
    // instruction until Ctrl+O explicitly expands the details.
    const instructions = Array.from({ length: 10 }, (_, index) => `instruction line ${index}`).join('\n')
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `<system-reminder>\n${instructions}\n</system-reminder>` }],
      source: { kind: 'plugin', plugin: 'workspace-context' },
    }), { surfaceOp: 'append' })
    await tick()

    // The redundant `system-reminder` frame element is dropped; the card is
    // collapsed by default with the shared details/Ctrl+O expand marker.
    expect(result.terminal.output).toContain('Context · workspace-context')
    expect(result.terminal.output).not.toContain('system-reminder')
    expect(result.terminal.output).toContain('▸ 10 lines hidden · click details or Ctrl+O to expand')
    expect(result.terminal.output).not.toContain('instruction line 0')
    expect(result.terminal.output).not.toContain('instruction line 5')

    result.terminal.send('\x0f')
    await tick()
    expect(result.terminal.output).toContain('Tool and context cards expanded.')
    expect(result.terminal.output).toContain('instruction line 5')

    // Third state: tool cards hide; a context card is injected instructions,
    // not tool traffic, so it stays visible as its one-line disclosure.
    result.terminal.send('\x0f')
    await tick()
    expect(result.terminal.output).toContain('Tool cards hidden.')
    // A repaint proves the context card SURVIVES the hidden phase: injected
    // instructions are not tool traffic, so they stay at the collapsed disclosure.
    result.terminal.send('\x0c')
    await tick()
    const hidden = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(hidden).toContain('Context · workspace-context')
    // Fourth press returns to the collapsed default, closing the cycle.
    result.terminal.send('\x0f')
    await tick()
    expect(result.terminal.output).toContain('Tool and context cards collapsed.')

    // Context with no frame renders as muted prose under the header; a frame
    // wrapping nothing renders header-only.
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'plain reminder text, no tags' }],
      source: { kind: 'plugin', plugin: 'plain-context' },
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<system-reminder>\n</system-reminder>' }],
      source: { kind: 'plugin', plugin: 'empty-context' },
    }), { surfaceOp: 'append' })
    // Only a matched open/close pair is a frame: an unpaired tag line is prose and
    // survives, so a body is never silently truncated by a tag-like first line.
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<available_skills>\nkept prose line\n</other-tag>' }],
      source: { kind: 'plugin', plugin: 'unpaired-context' },
    }), { surfaceOp: 'append' })
    await tick()
    expect(result.terminal.output).toContain('Context · plain-context')
    expect(result.terminal.output).toContain('▸ 1 line hidden')
    expect(result.terminal.output).not.toContain('plain reminder text, no tags')
    expect(result.terminal.output).toContain('Context · empty-context')
    expect(result.terminal.output).toContain('▸ 3 lines hidden')
    expect(result.terminal.output).not.toContain('<available_skills>')
    expect(result.terminal.output).not.toContain('kept prose line')
    // Ctrl+L invalidates the mounted tree, exercising the card's invalidate hook.
    result.terminal.send('\x0c')
    await tick()
    await dispose(result)
  })

  it('renders XML-hostile instruction prose verbatim, framed and folded', async () => {
    const result = await setup()
    // Real AGENTS.md prose carries a raw `&` (a badge URL's `&logo=`) and
    // angle-bracket placeholders that name nothing (`packages/<group>/<pkg>/`).
    // Both are prose the model must read literally, and neither may affect whether
    // the frame is stripped or the body folds.
    const lines = Array.from({ length: 10 }, (_, index) => `prose line ${index}`).join('\n')
    result.session.append('user/message', createUserMessage({
      content: [{
        type: 'text',
        text: `<system-reminder>\nbadge: https://img.shields.io/badge/x?style=flat&logo=deepseek\npath: packages/<group>/<pkg>/\n${lines}\n</system-reminder>`,
      }],
      source: { kind: 'plugin', plugin: 'prose-context' },
    }), { surfaceOp: 'append' })
    await tick()

    expect(result.terminal.output).toContain('Context · prose-context')
    expect(result.terminal.output).not.toContain('<system-reminder>')
    expect(result.terminal.output).toContain('lines hidden · click details or Ctrl+O to expand')
    expect(result.terminal.output).not.toContain('prose line 5')

    result.terminal.send('\x0f')
    await tick()
    expect(result.terminal.output).toContain('prose line 5')
    // Characters that break a strict XML parse survive unescaped and unexpanded.
    expect(result.terminal.output).toContain('&logo=deepseek')
    expect(result.terminal.output).toContain('packages/<group>/<pkg>/')
    await dispose(result)
  })

  it('counts failed and recovered request usage once per step', async () => {
    const result = await setup()
    result.session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
    })
    result.session.append('llm/retry', {
      retryId: RetryId('tui-usage-retry'),
      turn: 1,
      step: 1,
      provider: 'mock',
      mode: 'normal',
      policyKey: '["normal",2,["RATE_LIMIT"],1,10000,0]',
      retry: 1,
      maxRetries: 2,
      delayMs: 500,
      failure: { message: 'temporary', code: 'SERVER' },
    })
    result.session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } },
    })
    appendAssistant(
      result.session,
      [{ type: 'text', text: 'recovered' }],
      { inputTokens: 7, outputTokens: 3 },
      { turn: 1, step: 2 },
    )
    await tick()

    expect(result.terminal.output).toContain('↑17 ↓5')
    await dispose(result)
  })

  it('retracts a failed live stream and renders its durable retry status', async () => {
    const result = await setup()
    result.session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'discarded partial answer' },
    })
    result.session.append('step/end', { turn: 1, step: 1 })
    result.session.append('llm/retry', {
      retryId: RetryId('tui-live-retry-1'),
      turn: 1,
      step: 1,
      provider: 'mock',
      mode: 'normal',
      policyKey: '["normal",2,["RATE_LIMIT"],1,10000,0]',
      retry: 1,
      maxRetries: 2,
      delayMs: 500,
      failure: { message: 'rate limited', code: 'RATE_LIMIT', status: 429 },
    })
    result.session.append('llm/retry', {
      retryId: RetryId('tui-live-retry-2'),
      turn: 1,
      step: 2,
      provider: 'mock',
      mode: 'normal',
      policyKey: '["normal",2,["RATE_LIMIT"],1,10000,0]',
      retry: 2,
      maxRetries: 2,
      delayMs: 1_000,
      failure: { message: 'failed before chunks', code: 'SERVER', status: 503 },
    })
    result.session.append('llm/retry', {
      retryId: RetryId('tui-live-retry-3'),
      turn: 1,
      step: 3,
      provider: 'mock',
      mode: 'always',
      policyKey: '["always",1,10000,0]',
      retry: 1,
      delayMs: 2_000,
      failure: { message: 'retry without limit', code: 'AUTH', status: 401 },
    })
    await tick()

    expect(result.terminal.output).toContain('Retrying model request (1/2) in 500ms: rate limited')
    expect(result.terminal.output).toContain('Retrying model request (2/2) in 1000ms: failed before chunks')
    expect(result.terminal.output).not.toContain('discarded partial answer')
    expect(result.terminal.output).toContain('Retrying model request (1/∞) in 2000ms: retry without limit')
    await dispose(result)
  })

  it('badges queued steering on the prompt context and clears it as each drains', async () => {
    // Pin a cwd free of the substring under test; the prompt context renders the path.
    const result = await setup({ status: 'running', cwd: '/workspace' })
    // Running with nothing queued: the badge is absent and the editor keeps its hint.
    expect(result.terminal.output).toContain('Assistant')
    expect(result.terminal.output).toContain('Model wait 0.0s')
    expect(result.terminal.output).toContain('Describe a task, @ a file, or / for commands')
    expect(result.terminal.output).toContain('Enter steer · Esc cancel')
    expect(result.terminal.output).toContain('│')
    expect(result.terminal.output).not.toContain('queued')

    result.terminal.output = ''
    result.terminal.send('x')
    await tick()
    expect(result.terminal.output).not.toContain('Describe a task, @ a file, or / for commands')
    result.terminal.send('\x7f')
    await tick()
    expect(result.terminal.output).toContain('Describe a task, @ a file, or / for commands')

    const submitSteering = (text: string): void => {
      result.terminal.send(text)
      result.terminal.send('\r')
    }
    const drainSteering = (text: string): void => {
      const id = result.agent.steeredIds.shift()
      if (id !== undefined) {
        agentEvents(result.ctx, result.agent).emit('agent/inbox/claimed', { message: freezeMessage({
          id,
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }), turn: 1 })
      }
      result.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    }

    // A steering queue for a different agent never touches this status line.
    const other = { ...result.agent, id: SessionId('other') } as Agent
    result.terminal.output = ''
    agentEvents(result.ctx, other).emit('agent/inbox/inserted', { message: freezeMessage({
      id: MessageId('stub'),
      role: 'user',
      content: [{ type: 'text', text: 'elsewhere' }],
      source: { kind: 'user' },
    }) })
    await tick()
    expect(result.terminal.output).not.toContain('queued')

    // Two steering messages queue while the turn runs.
    submitSteering('first')
    result.terminal.output = ''
    submitSteering('second')
    await tick()
    expect(result.terminal.output).toContain('2 queued')

    // Draining one submitted message decrements the badge.
    result.terminal.output = ''
    drainSteering('first')
    await tick()
    expect(result.terminal.output).toContain('1 queued')
    expect(result.terminal.output).not.toContain('2 queued')

    // Draining the last queued message returns the plain hint.
    result.terminal.output = ''
    drainSteering('second')
    await tick()
    expect(result.terminal.output).toContain('Describe a task, @ a file, or / for commands')
    expect(result.terminal.output).toContain('│')
    expect(result.terminal.output).not.toContain('queued')

    // A drain with no matching queued entry is ignored rather than underflowing.
    result.terminal.output = ''
    drainSteering('continuation')
    submitSteering('after')
    await tick()
    expect(result.terminal.output).toContain('1 queued')

    // A durable user/message has no inbox identity and therefore cannot consume
    // a pending slot by itself.
    result.terminal.output = ''
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'continue: goal not reached' }],
      source: { kind: 'plugin', plugin: 'hooks' },
    }), { surfaceOp: 'append' })
    await tick()
    expect(result.terminal.output).toContain('1 queued')
    result.terminal.output = ''
    drainSteering('after')
    await tick()
    expect(result.terminal.output).not.toContain('queued')

    // The turn ending resets the badge, so the next running turn starts clean.
    result.agent.status = 'idle'
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'idle' })
    result.agent.status = 'running'
    result.terminal.output = ''
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'running' })
    await tick()
    expect(result.terminal.output).toContain('│')
    expect(result.terminal.output).not.toContain('queued')

    // A cancellation discards queued steering: the badge clears without drains.
    submitSteering('third')
    submitSteering('fourth')
    await tick()
    expect(result.terminal.output).toContain('2 queued')
    const discarded = result.agent.steeredIds.splice(0).map(id => freezeMessage({
      id,
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'discarded' }],
      source: { kind: 'user' as const },
    }))
    // Another agent's dequeue/discard, and ones naming no pending id, leave
    // the badge alone.
    agentEvents(result.ctx, other).emit('agent/inbox/claimed', { message: discarded[0]!, turn: 1 })
    agentEvents(result.ctx, result.agent).emit('agent/inbox/claimed', { message: freezeMessage({
      id: MessageId('never-queued'),
      role: 'user',
      content: [{ type: 'text', text: 'x' }],
      source: { kind: 'user' },
    }), turn: 1 })
    for (const message of discarded) {
      agentEvents(result.ctx, other).emit('agent/inbox/discarded', { message })
    }
    agentEvents(result.ctx, result.agent).emit('agent/inbox/discarded', { message: freezeMessage({
      id: MessageId('never-queued'),
      role: 'user',
      content: [{ type: 'text', text: 'x' }],
      source: { kind: 'user' },
    }) })
    await tick()
    expect(result.terminal.output).toContain('2 queued')
    result.terminal.output = ''
    for (const message of discarded) {
      agentEvents(result.ctx, result.agent).emit('agent/inbox/discarded', { message })
    }
    await tick()
    expect(result.terminal.output).not.toContain('queued')

    await dispose(result)
  })

  it('accumulates exclusive timing buckets across a multi-step turn', async () => {
    let clock = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const result = await setup({ status: 'running' })

    clock += 1_000
    result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } })
    clock += 2_000
    result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'answering' } })
    clock += 1_000
    result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'reconsidering' } })
    clock += 2_000
    result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'revised' } })
    clock += 3_000
    result.session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' })
    clock += 4_000
    result.session.append('step/end', { turn: 1, step: 1 })
    result.session.append('step/start', { turn: 1, step: 2 })
    clock += 1_000
    result.session.append('assistant/chunk', { turn: 1, step: 2, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } })
    clock += 2_000
    result.session.append('assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'done' } })
    clock += 3_000
    result.terminal.output = ''
    result.session.append('step/end', { turn: 1, step: 2 })
    await tick()

    expect(result.terminal.output).toContain('Model wait 1.0s · Thinking 4.0s · Response 4.0s · Tools 4.0s')
    expect(result.terminal.output).toContain('Model wait 1.0s · Response 3.0s · Completed')
    expect(result.terminal.output).not.toContain('Thinking 0s')
    nowSpy.mockRestore()
    await dispose(result)
  })

  it('rebuilds used subsecond buckets and the durable local completion time', async () => {
    let clock = new Date(2026, 6, 21, 14, 32, 6).getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    let result: Awaited<ReturnType<typeof setup>> | undefined
    try {
      result = await setup({
        beforeMount(session) {
          clock += 250
          session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'fast' } })
          clock += 500
          session.append('step/end', { turn: 1, step: 1 })
          clock += 86_400_000
        },
      })
      const completed = 'Model wait 0.2s · Response 0.5s · Completed 2026-07-21 14:32:06'
      expect(result.terminal.output).toContain(completed)

      result.terminal.output = ''
      appendUser(result.session, 'rebuild the transcript')
      result.terminal.resize(result.terminal.columns + 1)
      await tick()
      expect(result.terminal.output).toContain(completed)
    } finally {
      if (result !== undefined) await dispose(result)
      nowSpy.mockRestore()
    }
  })

  it('renders completion for a step whose opening event is unavailable', async () => {
    const result = await setup({ omitInitialLifecycle: true })
    result.session.append('step/end', { turn: 1, step: 1 })
    await tick()
    expect(result.terminal.output).toContain('Completed ')
    expect(result.terminal.output).toContain('Assistant')
    expect(result.terminal.output).toContain('Model wait 0.0s · Completed')
    await dispose(result)
  })

  it('does not reuse a completed turn before the next turn starts', async () => {
    let clock = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    let result: Awaited<ReturnType<typeof setup>> | undefined
    try {
      result = await setup({
        beforeMount(session) {
          clock += 2_000
          session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'done' } })
          clock += 1_000
          session.append('step/end', { turn: 1, step: 1 })
          session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        },
      })
      result.agent.status = 'running'
      result.terminal.output = ''
      agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'running' })
      await tick()
      expect(result.terminal.output).not.toContain('Model wait')
      expect(result.terminal.output).toContain('Describe a task, @ a file, or / for commands')
      expect(result.terminal.output).toContain('│')
      expect(result.terminal.output).not.toContain('Response 1s')

      result.session.append('turn/start', { turn: 2 })
      result.session.append('step/start', { turn: 2, step: 1 })
      clock += 1_000
      result.terminal.output = ''
      result.session.append('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'next' } })
      await tick()
      expect(result.terminal.output).toContain('Model wait 1.0s')
      expect(result.terminal.output).not.toContain('Model wait 3.0s')
    } finally {
      if (result !== undefined) await dispose(result)
      nowSpy.mockRestore()
    }
  })

  it('starts a running status before lifecycle events arrive', async () => {
    const result = await setup({ status: 'running', omitInitialLifecycle: true })
    expect(result.terminal.output).not.toContain('Model wait')
    await dispose(result)
  })

  it('replaces the prompt caret with a phase-specific status glyph while running', async () => {
    // Hold the clock past the fade-in so the glyph is at full opacity; with
    // color off the settled glyph renders as its bare character.
    let clock = 0
    const result = await setup({ status: 'running', now: () => clock })
    clock = 1_000

    // A space separates `dsh` from the caret slot: the prompt reads
    // `dsh <glyph> ` with the same visible width as the idle `dsh > `, so the
    // cursor never shifts. Assert both the glyph slot and that constant width
    // (color is off in this harness, so output carries no ANSI to strip).
    // Each phase swaps only the glyph character in the same slot at equal width.
    const phaseGlyph: [() => void, string][] = [
      [() => result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'weighing' } }), 'dsh ✻ '],
      [() => result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'answer' } }), 'dsh ● '],
      [() => result.session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' }), 'dsh ⚙ '],
    ]
    let runningWidth: number | undefined
    for (const [drive, expected] of phaseGlyph) {
      result.terminal.output = ''
      drive()
      await tick()
      expect(result.terminal.output).toContain(expected)
      runningWidth ??= promptWidth(result.terminal.output)
      expect(promptWidth(result.terminal.output)).toBe(runningWidth)
    }

    // Idle begins a fade-out; once it settles (clock past the fade window) the
    // plain `>` caret returns at the same width — no horizontal shift. The
    // fade-out timer emits intermediate frames, so read the terminal's final
    // rendered prompt row rather than the accumulated stream.
    result.agent.status = 'idle'
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'idle' })
    clock = 2_000
    await new Promise(resolve => setTimeout(resolve, 150))
    await tick()
    const promptRow = (): string => {
      const rows = result.terminal.output.split(/\r?\n|\x1b\[[0-9;]*[A-Za-z]/u).filter(r => r.includes('dsh'))
      return rows.at(-1) ?? ''
    }
    expect(promptRow()).toContain('dsh > ')
    expect(promptRow()).not.toMatch(/dsh(?:\x1b\[[0-9;]*m| )*[◍✻●⚙⊙]/u)
    expect(promptWidth(result.terminal.output)).toBe(runningWidth)

    await dispose(result)
  })

  it('shows a live standalone compaction in the fixed status area', async () => {
    let clock = 0
    const result = await setup({ omitInitialLifecycle: true, now: () => clock })
    const idleWidth = promptWidth(result.terminal.output)

    result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
    clock = 1_000
    result.terminal.output = ''
    await new Promise(resolve => setTimeout(resolve, 75))

    expect(result.terminal.output).toContain('dsh ⊙ ')
    expect(result.terminal.output).toContain('Context being compacted 1.0s')
    expect(promptWidth(result.terminal.output)).toBe(idleWidth)
    expect(result.terminal.progress.at(-1)).toBe(true)

    clock = 1_450
    result.terminal.output = ''
    await new Promise(resolve => setTimeout(resolve, 75))
    expect(result.terminal.output).toContain('Context being compacted 1.4s')

    await dispose(result)
  })

  it('ignores a numbered compaction bracket while the status line is idle', async () => {
    const result = await setup({ now: () => 1_000 })
    result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: 1 })
    await tick()

    expect(result.terminal.output).toContain('dsh > ')
    expect(result.terminal.output).not.toContain('dsh ⊙ ')
    expect(result.terminal.progress.at(-1)).toBe(false)
    await dispose(result)
  })

  it('fades a closed standalone compaction back to the plain caret', async () => {
    let clock = 0
    const result = await setup({ omitInitialLifecycle: true, now: () => clock })
    clock = 1_000
    result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
    await tick()
    result.session.append('compaction/end', { compactionId: LIVE_COMPACTION_ID, turn: null })
    await tick()

    clock = 2_000
    await new Promise(resolve => setTimeout(resolve, 120))
    result.terminal.output = ''
    result.terminal.resize(result.terminal.columns + 1)
    await tick()

    expect(result.terminal.output).toContain('dsh > ')
    expect(result.terminal.output).not.toMatch(/dsh [◍✻●⚙⊙]/u)
    expect(result.terminal.output).not.toContain('Context being compacted')
    expect(result.terminal.progress.at(-1)).toBe(false)
    await dispose(result)
  })

  it('reports a failed standalone compaction when its live bracket closes', async () => {
    const result = await setup({ omitInitialLifecycle: true, now: () => 1_000 })
    result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
    result.terminal.output = ''
    result.session.append('compaction/end', {
      compactionId: LIVE_COMPACTION_ID, turn: null, error: 'summary failed',
    })
    await tick()

    expect(result.terminal.output).toContain('Compaction failed: summary failed')
    expect(result.terminal.progress.at(-1)).toBe(false)
    await dispose(result)
  })

  it('preserves live compaction progress across an idle status edge', async () => {
    let clock = 0
    const result = await setup({ omitInitialLifecycle: true, now: () => clock })
    result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
    clock = 1_000
    result.terminal.output = ''
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'idle' })
    result.terminal.resize(result.terminal.columns + 1)
    await tick()

    expect(result.terminal.output).toContain('dsh ⊙ ')
    expect(result.terminal.progress.at(-1)).toBe(true)
    await dispose(result)
  })

  it('keeps a running turn phase glyph ahead of standalone compaction', async () => {
    let clock = 0
    const result = await setup({ status: 'running', now: () => clock })
    clock = 1_000
    result.terminal.output = ''
    result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
    await tick()

    expect(result.terminal.output).toContain('dsh ◍ ')
    expect(result.terminal.output).not.toContain('dsh ⊙ ')
    result.session.append('compaction/end', { compactionId: LIVE_COMPACTION_ID, turn: null })
    await tick()
    result.terminal.output = ''
    result.terminal.resize(result.terminal.columns + 1)
    await tick()

    expect(result.terminal.output).toContain('dsh ◍ ')
    expect(result.terminal.output).not.toContain('dsh ⊙ ')
    expect(result.terminal.progress.at(-1)).toBe(true)
    await dispose(result)
  })

  it('treats duplicate live compaction starts as one owned bracket', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    let result: Awaited<ReturnType<typeof setup>> | undefined
    let didDispose = false
    let clock = 0
    try {
      result = await setup({ omitInitialLifecycle: true, now: () => clock })
      intervalSpy.mockClear()
      clearIntervalSpy.mockClear()
      result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
      clock = 1_000
      result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
      await tick()

      expect(intervalSpy).toHaveBeenCalledOnce()
      expect(result.terminal.output).toContain('dsh ⊙ ')
      expect(result.terminal.progress.at(-1)).toBe(true)

      result.session.append('compaction/end', { compactionId: LIVE_COMPACTION_ID, turn: null })
      await tick()
      expect(clearIntervalSpy).toHaveBeenCalledOnce()
      expect(result.terminal.progress.at(-1)).toBe(false)

      await dispose(result)
      didDispose = true
    } finally {
      if (result !== undefined && !didDispose) await dispose(result)
      intervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
    }
  })

  it('does not show compaction progress for a resumed orphaned start', async () => {
    const result = await setup({
      omitInitialLifecycle: true,
      now: () => 1_000,
      beforeMount(session) {
        session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
      },
    })

    expect(result.terminal.output).toContain('dsh > ')
    expect(result.terminal.output).not.toContain('dsh ⊙ ')
    expect(result.terminal.output).not.toContain('Context being compacted')
    expect(result.terminal.progress.at(-1)).toBe(false)
    await dispose(result)
  })

  it('releases the live compaction timer and progress bit on dispose', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    let result: Awaited<ReturnType<typeof setup>> | undefined
    let didDispose = false
    try {
      result = await setup({ omitInitialLifecycle: true, now: () => 1_000 })
      intervalSpy.mockClear()
      clearIntervalSpy.mockClear()
      result.session.append('compaction/start', { compactionId: LIVE_COMPACTION_ID, turn: null })
      expect(intervalSpy).toHaveBeenCalledOnce()
      const compactionTimer = intervalSpy.mock.results[0]?.value as ReturnType<typeof setInterval>

      await dispose(result)
      didDispose = true
      expect(clearIntervalSpy.mock.calls.some(([timer]) => timer === compactionTimer)).toBe(true)
      expect(result.terminal.progress.at(-1)).toBe(false)
    } finally {
      if (result !== undefined && !didDispose) await dispose(result)
      intervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
    }
  })

  // Extract the running glyph's interpolated gray channel from a rendered frame.
  const glyphGray = (frame: string): number => {
    const m = /\x1b\[38;2;(\d+);(\d+);(\d+)m●/u.exec(frame)
    if (m === null) throw new Error('frame did not paint a truecolor glyph')
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    // Pure gray: equal channels, never the blue-dominant accent.
    expect(r).toBe(g)
    expect(g).toBe(b)
    return r
  }

  it('throbs the running glyph in dim gray, breathing between trough and full without blanking, never accent', async () => {
    let clock = 0
    let chunkIndex = 0
    const result = await setup({ status: 'running', config: { theme: { color: true, truecolor: true } }, now: () => clock })
    // A fresh chunk index each frame changes the streamed line, forcing the
    // diffing terminal to repaint the prompt row and re-emit the glyph slot.
    const frameAt = async (t: number): Promise<string> => {
      clock = t
      chunkIndex += 1
      result.terminal.output = ''
      result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: chunkIndex, text: '.' } })
      await tick()
      return result.terminal.output
    }

    // The pulse breathes between the dimmest trough gray and the settled peak
    // and back, never blanking. At phase 0 (t=1400, pulse level 0, past fade-in)
    // the glyph still paints the trough gray, so the breath dims but never
    // disappears — a symmetric bold→dim→bold throb.
    const trough = await frameAt(1_400)
    expect(trough).toMatch(/●/u)
    expect(glyphGray(trough)).toBe(43)
    // Half a period later (t=2100, pulse peak) it paints the brightest gray.
    const peak = await frameAt(2_100)
    expect(glyphGray(peak)).toBe(136)
    // A frame partway up the swell paints a gray strictly between trough and
    // full, and the glyph is never the accent color.
    const rising = await frameAt(1_680)
    const grey = glyphGray(rising)
    expect(grey).toBeGreaterThan(43)
    expect(grey).toBeLessThan(136)
    expect(rising).not.toMatch(/\x1b\[94m●/u)

    await dispose(result)
  })

  it('fades the running glyph out to the plain caret after the turn ends', async () => {
    let clock = 0
    const result = await setup({ status: 'running', config: { theme: { color: true, truecolor: true } }, now: () => clock })
    clock = 1_000
    result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '.' } })
    await tick()

    // End the turn: the last glyph fades out over 300 ms rather than vanishing.
    result.agent.status = 'idle'
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'idle' })
    await tick()
    // Just after the end the glyph still paints a gray, not `>`.
    expect(result.terminal.output).toMatch(/\x1b\[38;2;\d+;\d+;\d+m●/u)
    expect(result.terminal.output).not.toContain('dsh \x1b[90m>')

    // While the clock stays within the fade window the timer keeps ticking
    // without clearing the fade (the not-yet-elapsed branch): the last frame is
    // still the fading glyph, and the plain caret has not returned.
    result.terminal.output = ''
    await new Promise(resolve => setTimeout(resolve, 120))
    const lastPromptRow = result.terminal.output.split(/\x1b\[[0-9;]*[A-Za-z]/u).filter(r => r.includes('dsh')).at(-1) ?? ''
    expect(lastPromptRow).not.toContain('dsh \x1b[90m>')

    // Past the fade window the fade timer clears and the plain caret returns.
    clock = 2_000
    result.terminal.output = ''
    await new Promise(resolve => setTimeout(resolve, 120))
    await tick()
    expect(result.terminal.output).not.toMatch(/dsh(?:\x1b\[[0-9;]*m| )*●/u)
    expect(result.terminal.output).toContain('>')

    await dispose(result)
  })

  it('appears past the fade midpoint and disappears without truecolor, still dim not accent', async () => {
    let clock = 0
    const result = await setup({ status: 'running', config: { theme: { color: true } }, now: () => clock })
    const frameAt = async (t: number): Promise<string> => {
      clock = t
      result.terminal.output = ''
      result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '.' } })
      await tick()
      return result.terminal.output
    }

    // Without truecolor there is no per-frame gray: below the fade midpoint the
    // glyph slot is blank; past it the glyph shows in the palette dim role,
    // never the accent (ANSI 95).
    const early = await frameAt(60)
    expect(early).not.toMatch(/dsh(?:\x1b\[[0-9;]*m| )*●/u)
    const shown = await frameAt(300)
    expect(shown).toMatch(/\x1b\[2;39m●/u)
    expect(shown).not.toMatch(/\x1b\[95m●/u)

    await dispose(result)
  })

  it('shows the plain prompt caret while idle', async () => {
    const result = await setup({ now: () => 0 })
    expect(result.terminal.output).toContain('dsh > ')
    expect(result.terminal.output).not.toMatch(/dsh [◍✻●⚙⊙]/u)
    await dispose(result)
  })

  it('escapes configured prompt controls while preserving registry-owned styling', async () => {
    const result = await setup({ config: { theme: { leftPrompt: 'LEFT\u001B]2;unsafe\u0007 ${custom}' } } })
    result.ctx.tuiPrompt.register('custom', '\u001B[1mTRUSTED\u001B[22m')
    await tick()
    expect(result.terminal.output).toContain('LEFT\\x1b]2;unsafe\\x07')
    expect(result.terminal.output).toContain('\u001B[1mTRUSTED\u001B[22m')
    expect(result.terminal.output).not.toContain('\u001B]2;unsafe\u0007')
    await dispose(result)
  })

  it('redraws when an out-of-band prompt value changes on its own schedule', async () => {
    // A plugin-owned value that changes without any other UI event must still
    // repaint: the registry notifies the renderer through its subscription.
    const result = await setup({ config: { theme: { leftPrompt: '${custom}${model}' } } })
    const handle = result.ctx.tuiPrompt.register('custom', 'BEFORE ')
    await tick()
    expect(result.terminal.output).toContain('BEFORE ')

    result.terminal.output = ''
    handle.set('AFTER ')
    // The coalesced notification lands on a microtask; no session/agent event fires.
    await tick()
    expect(result.terminal.output).toContain('AFTER ')
    expect(result.terminal.output).not.toContain('BEFORE ')
    await dispose(result)
  })

  it('tracks steering drains without a running status line', async () => {
    const result = await setup()
    const source = { kind: 'user' as const }
    agentEvents(result.ctx, result.agent).emit('agent/inbox/inserted', { message: freezeMessage({
      id: MessageId('stub'),
      role: 'user',
      content: [{ type: 'text', text: 'early' }],
      source,
    }) })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'early' }],
      source,
    }), { surfaceOp: 'append' })
    await tick()
    expect(result.terminal.output).not.toContain('queued')
    await dispose(result)
  })

  it('refreshes the running turn timing on its own timer', async () => {
    let now = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const intervals = vi.spyOn(globalThis, 'setInterval')
    let result: Awaited<ReturnType<typeof setup>> | undefined
    try {
      result = await setup({ status: 'running', now: () => now })
      // The running prompt animates at ~20 fps (50 ms); the same tick keeps the
      // elapsed timing text current, so no separate timing-only timer exists.
      const refresh = intervals.mock.calls.find(([, interval]) => interval === 50)?.[0]
      if (typeof refresh !== 'function') throw new Error('TUI did not register its running-status refresh interval')
      result.terminal.output = ''
      now += 1_000
      refresh()
      await tick()
      expect(result.terminal.output).toContain('Model wait 1.0s')
    } finally {
      if (result !== undefined) await dispose(result)
      intervals.mockRestore()
      nowSpy.mockRestore()
    }
  })

  it('shows minutes and seconds in accumulated timing', async () => {
    let clock = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const result = await setup({ status: 'running' })
    clock += 95_000
    result.terminal.output = ''
    result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } })
    await tick()
    expect(result.terminal.output).toContain('Model wait 1m35.0s')
    nowSpy.mockRestore()
    await dispose(result)
  })

  it('trails the completed step timing below the step tool cards, not above them', async () => {
    const clock = new Date(2026, 6, 21, 12, 0, 0).getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(clock)
    const result = await setup({ status: 'running' })
    // A step whose assistant message drives a tool call: the tool card is
    // appended after the assistant text, so the timing footer must follow the
    // tool output rather than sit above it (its first message).
    appendAssistant(result.session, [
      { type: 'text', text: 'Running a command' },
      { type: 'tool-call', id: 'c1' as never, name: 'bash', arguments: '{}' },
    ])
    result.session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c1' as never,
        content: [{ type: 'text', text: 'command output' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.terminal.output = ''
    result.session.append('step/end', { turn: 1, step: 1 })
    await tick()

    const frame = result.terminal.output
    const toolAt = frame.indexOf('command output')
    const timingAt = frame.indexOf('Completed 2026-07-21 12:00:00')
    expect(toolAt).toBeGreaterThanOrEqual(0)
    expect(timingAt).toBeGreaterThan(toolAt)
    nowSpy.mockRestore()
    await dispose(result)
  })

  it('preserves accumulated timing across a mid-turn color-scheme change', async () => {
    let clock = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const result = await setup({ status: 'running' })
    clock += 1_000
    result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'answering' } })
    clock += 4_000
    result.terminal.output = ''
    result.terminal.send('\x1b[?997;2n')
    await tick()
    await tick()
    expect(result.terminal.output).toContain('Model wait 1.0s · Response 4.0s')

    nowSpy.mockRestore()
    await dispose(result)
  })

  it('renders the ANSI palette and every markdown/content style', async () => {
    const result = await setup({
      cwd: '/workspace',
      config: { theme: { color: true } },
      beforeMount(session) {
        session.append('user/message', createUserMessage({
          content: [
            { type: 'text', text: '# Heading\n\n[link](https://example.com) `code`\n\n```ts\nconst x = 1\n```\n\n> quote\n\n---\n\n- item\n\n**bold** *italic* ~~strike~~' },
            { type: 'tool-call', id: 'nested' as never, name: 'nested_tool', arguments: '{}' },
            { type: 'tool-result', toolCallId: 'nested' as never, content: [{ type: 'reasoning', text: 'nested result' }] },
            { type: 'future-block' } as never,
            {} as never,
          ],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        appendAssistant(session, [
          { type: 'reasoning', text: 'styled reasoning' },
          { type: 'text', text: 'styled answer\n\n```ts\nconst answer = 42\n```' },
        ], { inputTokens: 2_000_000, outputTokens: 1_500_000 })
        session.append('todo/write', { todos: [
          { content: 'done', status: 'completed' },
          { content: 'active', status: 'in_progress' },
          { content: 'later', status: 'pending' },
        ] })
      },
    })
    result.terminal.send('/')
    await tick()
    result.terminal.send('zz')
    await tick()
    result.terminal.send('\x0c')
    await tick()

    expect(result.terminal.output).toContain('\x1b[')
    expect(result.terminal.output).toContain('Heading')
    expect(result.terminal.output).toContain('nested_tool({})')
    expect(result.terminal.output).toContain('nested result')
    expect(result.terminal.output).toContain('[future-block]')
    expect(result.terminal.output).toContain('[content]')
    expect(result.terminal.output).toContain('\x1b[36mconst answer = 42\x1b[39m')
    expect(result.terminal.output).not.toContain('```')
    expect(result.terminal.output).toContain('↑2.0m ↓1.5m')
    await dispose(result)
  })

  it('suppresses stale replay chunks and does not duplicate editor history on rebuild', async () => {
    const result = await setup({
      beforeMount(session) {
        appendUser(session, 'first prompt')
        appendUser(session, 'second prompt')
        session.append('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'text-delta', index: 0, text: 'stale partial response' },
        })
      },
    })

    expect(result.terminal.output).not.toContain('stale partial response')
    result.terminal.send('\x12')
    result.terminal.send('\x1b[A')
    result.terminal.send('\x1b[A')
    result.terminal.send('\x1b[A')
    result.terminal.send('\r')
    expect(result.agent.sent).toEqual([[{ type: 'text', text: 'first prompt' }]])
    await dispose(result)
  })

  it('formats large token totals and cwd variants', async () => {
    const home = homedir()
    const homeResult = await setup({
      cwd: home,
      beforeMount(session) {
        appendAssistant(session, [{ type: 'text', text: 'home' }], { inputTokens: 25_000, outputTokens: 10_000 })
      },
    })
    await vi.waitFor(() => {
      expect(homeResult.terminal.output).toContain('~ (tui-staging)')
      expect(homeResult.terminal.output).toContain('↑25k ↓10k')
      expect(homeResult.terminal.output).toContain('deepseek-v4-flash [alt+m]')
    })
    await dispose(homeResult)

    const childResult = await setup({ cwd: join(home, 'projects', 'dsh-tui') })
    await vi.waitFor(() => {
      expect(childResult.terminal.output).toContain(join('~', 'projects', 'dsh-tui'))
    })
    await dispose(childResult)

    const unsetResult = await setup({ cwd: null })
    await vi.waitFor(() => {
      expect(unsetResult.terminal.output).toContain('cwd unset')
    })
    await dispose(unsetResult)

    const homeParent = resolve(home, '..')
    const parentResult = await setup({ cwd: homeParent })
    await vi.waitFor(() => {
      expect(parentResult.terminal.output).toContain(homeParent)
    })
    await dispose(parentResult)

    const outsideResult = await setup({ cwd: '/opt' })
    await vi.waitFor(() => {
      expect(outsideResult.terminal.output).toContain('/opt')
    })
    await dispose(outsideResult)

    const logicalResult = await setup({
      cwd: '/w',
      formatCwd: cwd => `logical:${cwd}\x1b`,
    })
    await vi.waitFor(() => {
      expect(logicalResult.terminal.output).toContain('logical:/w\\x1b')
    })
    await dispose(logicalResult)
  })

  it('shows the session cache hit rate in the footer and updates it live', async () => {
    // Empty session: no input billed yet, so the cache segment is hidden.
    // A cwd without "cache" in it keeps the negative assertion unambiguous.
    const empty = await setup({ cwd: '/opt' })
    expect(empty.terminal.output).toContain('↑0 ↓0')
    expect(empty.terminal.output).not.toContain('cache')
    await dispose(empty)

    const result = await setup({
      // Pin a short cwd so the footer never clips the cache segment: the
      // default is process.cwd(), and a deep worktree path truncates
      // `cache 60%` at the terminal width.
      cwd: '/opt',
      beforeMount(session) {
        // Cold call: 10 billed input tokens, none served from cache.
        appendAssistant(session, [{ type: 'text', text: 'cold' }], { inputTokens: 10, outputTokens: 5 })
      },
    })
    expect(result.terminal.output).toContain('cache 0%')

    result.terminal.output = ''
    // Warm call lands live on the next step (same-step usage replaces rather
    // than accumulates): 5 uncached + 30 cache-read + 5 cache-write billed
    // input, so 30 of the 50 total prompt tokens are hits → 60%.
    appendAssistant(result.session, [{ type: 'text', text: 'warm' }], {
      inputTokens: 5,
      outputTokens: 5,
      cacheReadTokens: 30,
      cacheWriteTokens: 5,
    }, { turn: 1, step: 2 })
    await tick()
    expect(result.terminal.output).toContain('cache 60%')
    expect(result.terminal.output).not.toContain('cache 0%')
    await dispose(result)
  })

  it('shows detailed session diagnostics while the agent is running', async () => {
    const timestamp = Date.parse('2026-07-22T09:10:11.000Z')
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(timestamp)
    const result = await setup({
      cwd: '/workspace/status',
      contextWindow: 128_000,
      contextTokens: 42_000,
      config: { showReasoning: false },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      tools: {
        read: {
          name: 'read', description: 'Read a file', parameters: {},
          output: { schema: { type: 'null' }, render: () => [] }, execute: async () => null,
        },
        write: {
          name: 'write', description: 'Write a file', parameters: {},
          output: { schema: { type: 'null' }, render: () => [] }, execute: async () => null,
        },
      },
      beforeMount(session) {
        session.append('session/title', {
          title: 'Inspect status \u001B]2;unsafe\u0007',
          messageSeqs: [1],
          source: { kind: 'fallback' },
        })
        appendAssistant(session, [{ type: 'text', text: 'measured' }], {
          inputTokens: 1_250,
          outputTokens: 340,
          cacheReadTokens: 3_000,
          cacheWriteTokens: 250,
        })
        session.append('tool/call', {
          turn: 1, step: 1, callId: 'status-call-1' as never, name: 'read', arguments: '{}',
        })
        session.append('tool/call', {
          turn: 1, step: 1, callId: 'status-call-2' as never, name: 'write', arguments: '{}',
        })
      },
    })
    result.agent.status = 'running'
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'running' })
    result.terminal.send('/status')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('Session status')
    })

    expect(result.terminal.output).toContain('Session status')
    expect(result.terminal.output).toContain('main-session')
    expect(result.terminal.output).toContain('Inspect status \\x1b]2;unsafe\\x07')
    expect(result.terminal.output).toContain('/workspace/status')
    expect(result.terminal.output).toContain('deepseek-official/deepseek-v4-pro (effort default; reasoning blocks')
    expect(result.terminal.output).toContain('hidden)')
    // 6 domain events + the /status invocation's own command/run (open turn: joined directly).
    expect(result.terminal.output).toContain('running · 7 events · 1 turn · 1 step · 2 tool calls')
    expect(result.terminal.output).toContain('1,250 input + 340 output')
    expect(result.terminal.output).toContain('[███████████░░░░░] 67% hit (3,000 read + 250 write)')
    expect(result.terminal.output).toContain('[█████░░░░░░░░░░░] 33% used (42,000 / 128,000)')
    expect(result.terminal.output).toContain('2026-07-22 09:10:11 UTC')
    expect(result.terminal.output).not.toContain('System prompt')
    expect(result.terminal.output).not.toContain('Registered tools')
    expect(result.terminal.output).not.toContain('You are an AI agent powered by DeepSeek Harness.')
    expect(result.terminal.output).not.toContain('\u001B]2;unsafe\u0007')

    result.terminal.resize(56)
    result.terminal.send('\x0c')
    await tick()

    await dispose(result)
    dateNow.mockRestore()
  })

  it('labels unavailable status diagnostics without inventing values', async () => {
    const timestamp = Date.parse('2026-07-22T10:11:12.000Z')
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(timestamp)
    const result = await setup({
      cwd: null,
      omitInitialLifecycle: true,
      contextTokens: 7,
      agentOptions: {},
      catalog: {
        providers: [],
        models: [],
        resolveModelInfo: () => Promise.resolve({}),
      },
    })
    result.terminal.send('/status')
    result.terminal.send('\r')
    await tick()

    expect(result.terminal.output).toContain('untitled')
    expect(result.terminal.output).toContain('unset (effort unset; reasoning blocks hidden)')
    // The /status invocation's command/run lands directly on the empty log — no turn wraps it.
    expect(result.terminal.output).toContain('idle · 1 event · 0 turns · 0 steps · 0 tool calls')
    expect(result.terminal.output).toContain('n/a (0 read + 0 write)')
    expect(result.terminal.output).toContain('7 used · capacity unknown')
    expect(result.terminal.output).toContain('2026-07-22 10:11:12 UTC')
    expect(result.terminal.output).not.toContain('System prompt')
    expect(result.terminal.output).not.toContain('Registered tools')
    await dispose(result)
    dateNow.mockRestore()
  })

  it('/quit exits while idle', async () => {
    const result = await setup()
    result.terminal.send('/quit')
    result.terminal.send('\r')
    await tick()

    expect(result.exit).toHaveBeenCalledWith(0)
    await dispose(result)
  })

  it('/details sets card visibility and reasoning display from arguments', async () => {
    const result = await setup()
    const run = async (line: string): Promise<void> => {
      result.terminal.send(line)
      result.terminal.send('\r')
      await tick()
    }

    await run('/details hidden')
    expect(result.terminal.output).toContain('Tool cards hidden.')

    await run('/details expanded reasoning off')
    expect(result.terminal.output).toContain('Tool and context cards expanded.')
    expect(result.terminal.output).toContain('Reasoning blocks hidden.')

    await run('/details reasoning on')
    expect(result.terminal.output).toContain('Reasoning blocks shown.')

    // Bare `reasoning` toggles: shown -> hidden.
    const toggleOutput = result.terminal.output.length
    await run('/details reasoning')
    expect(result.terminal.output.slice(toggleOutput)).toContain('Reasoning blocks hidden.')
    await run('/details collapsed')
    expect(result.terminal.output.slice(toggleOutput)).toContain('Tool and context cards collapsed.')

    await run('/details bogus')
    expect(result.terminal.output).toContain('Unknown /details argument "bogus"')

    await dispose(result)
  })

  it('bare /details opens the transcript-details toggle and Tab applies immediately', async () => {
    const result = await setup()
    const open = async (): Promise<number> => {
      const from = result.terminal.output.length
      result.terminal.send('/details')
      result.terminal.send('\r')
      await vi.waitFor(() => { expect(result.terminal.output.slice(from)).toContain('Transcript details') })
      return from
    }

    const opened = await open()
    expect(result.terminal.output.slice(opened)).toContain('Tool cards')
    expect(result.terminal.output.slice(opened)).toContain('Reasoning')

    // A second /details while the selector is open replaces the overlay
    // instead of stacking a second one behind it.
    await result.ctx.commands.execute(result.agent, '/details', new AbortController().signal)
    await tick()

    // Each Tab applies one step immediately while the dialog stays open:
    // collapsed -> expanded -> hidden -> collapsed (wraparound).
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output).toContain('Tool and context cards expanded.')
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output).toContain('Tool cards hidden.')
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output).toContain('Tool and context cards collapsed.')

    // The reasoning entry toggles the same way.
    result.terminal.send('\x1b[B')
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output).toContain('Reasoning blocks shown.')

    // Enter closes without further changes.
    const entered = result.terminal.output.length
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output.slice(entered)).not.toContain('Reasoning blocks')

    // Esc and Ctrl+C also close; the reopened dialog shows the live values.
    const reopened = await open()
    expect(result.terminal.output.slice(reopened)).toContain('collapsed')
    expect(result.terminal.output.slice(reopened)).toContain('shown')
    result.terminal.send('\x1b')
    await tick()
    const ctrlCOutput = await open()
    result.terminal.send('\x03')
    await tick()
    expect(result.terminal.output.slice(ctrlCOutput)).not.toContain('Reasoning blocks')

    await dispose(result)
  })

  it('sends, steers, handles commands, global keys, and disposed-agent input', async () => {
    const result = await setup()

    result.terminal.send('do the work')
    result.terminal.send('\r')
    expect(result.agent.sent).toEqual([[{ type: 'text', text: 'do the work' }]])

    result.terminal.send('   ')
    result.terminal.send('\r')

    result.agent.status = 'running'
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'running' })
    result.terminal.send('steer it')
    result.terminal.send('\r')
    expect(result.agent.steered).toEqual([[{ type: 'text', text: 'steer it' }]])

    result.terminal.send('\x1b')
    result.terminal.send('\x04')
    result.terminal.send('\x03')
    result.terminal.send('\x12')
    result.terminal.send('\x0f')
    expect(result.agent.cancelled).toContainEqual({ kind: 'user' })

    result.agent.status = 'idle'
    for (const command of ['/help', '/palette', '/reload']) {
      result.terminal.send(command)
      result.terminal.send('\r')
      await tick()
    }
    for (const command of ['/clear', '/wat']) {
      result.terminal.send(command)
      result.terminal.send('\r')
      await tick()
    }
    result.terminal.send('draft')
    result.terminal.send('\x03')
    result.terminal.send('\x04')
    await tick()

    expect(result.terminal.output).toContain('Keyboard shortcuts')
    expect(result.terminal.output).toContain('Reasoning blocks')
    expect(result.terminal.output).toContain('Tool and context cards')
    expect(result.terminal.output).toContain('Unknown command')
    // /reload without a Loader in the context degrades to a warning.
    expect(result.terminal.output).toContain('/reload needs the cordis Loader')
    expect(result.exit).toHaveBeenCalledWith(0)

    // The exit above left the TUI disposed (the mocked runtime.exit returns):
    // a message submitted now is refused instead of reaching the agent. The
    // refusal notice lands in the transcript, but the stopped UI no longer
    // paints, so assert the refusal through the agent surface.
    const sentBefore = result.agent.sent.length
    const steeredBefore = result.agent.steered.length
    result.terminal.send('after shutdown')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.sent).toHaveLength(sentBefore)
    expect(result.agent.steered).toHaveLength(steeredBefore)
    await result.controller.dispose()
    await result.ctx.fiber.dispose()

    const ctrlCExit = await setup()
    ctrlCExit.terminal.send('\x03')
    await tick()
    expect(ctrlCExit.exit).toHaveBeenCalledWith(0)
    await ctrlCExit.controller.dispose()
    await ctrlCExit.ctx.fiber.dispose()

  })

  it('copies, renames, and inserts file mentions through Codex-shaped commands', async () => {
    const result = await setup()
    await result.ctx.plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 40,
      maxTitleBytes: 80,
    })
    appendAssistant(result.session, [{ type: 'text', text: '**latest response** 你好' }])
    await tick()

    result.terminal.send('/copy')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain(osc52ClipboardSequence(
      '**latest response** 你好',
      process.env.TMUX !== undefined,
    ))
    expect(result.terminal.output).toContain('Copied the latest assistant response to the clipboard.')

    result.terminal.send('/rename')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('Command parity')
    result.terminal.send('\r')
    await tick()
    expect(result.session.events.findLast(event => event.type === 'session/title')?.data).toMatchObject({
      title: 'Command parity',
      source: { kind: 'user' },
    })
    expect(result.terminal.title).toContain('Command parity')

    result.terminal.send('/mention src/index.ts')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('review it')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.sent.at(-1)?.[0]).toMatchObject({
      type: 'text',
      text: '@src/index.ts review it',
    })

    await dispose(result)
  })

  it('combines session autocomplete with files and prepares send/steer references asynchronously', async () => {
    const sourceId = SessionId('source-session')
    const sourceHeader: SessionHeader = {
      version: 0,
      id: sourceId,
      cwd: '/workspace',
      createdAt: 1,
    }
    const noCwdHeader: SessionHeader = {
      version: 0,
      id: SessionId('no-cwd'),
      createdAt: 2,
    }
    const sourceEvents: SessionEvent[] = [
      {
        type: 'user/message',
        seq: 0,
        time: 1,
        data: createUserMessage({
          content: [{ type: 'text', text: 'source background' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'session/title',
        seq: 1,
        time: 2,
        data: {
          title: 'Source chat',
          messageSeqs: [0],
          source: { kind: 'fallback' },
        },
      },
    ]
    const result = await setup({
      sessionPersistence: {
        list: async () => [noCwdHeader, sourceHeader],
        load: async (id) => {
          if (id === sourceId) return { meta: sourceHeader, events: sourceEvents }
          if (id === noCwdHeader.id) return { meta: noCwdHeader, events: [] }
          throw new Error(`unexpected persisted session ${id}`)
        },
      },
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
      },
    })

    result.terminal.send('@no-cwd')
    await vi.waitFor(() => { expect(result.terminal.output).toContain('Session · no-cwd') })
    expect(result.terminal.output).toContain('(no cwd)')
    result.terminal.send('\x03')

    result.terminal.send('@chat')
    await vi.waitFor(() => { expect(result.terminal.output).toContain('Session · Source chat') })
    expect(result.terminal.output).toContain('source-session')
    result.terminal.send('\t')
    await tick()
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.agent.sent).toHaveLength(1) })
    expect(result.agent.sent).toEqual([[{ type: 'text', text: '@Source chat' }]])
    // Current admission is synchronous: the exact snapshot is injected before
    // the user prompt enters the next-turn inbox.
    expect(result.agent.injected).toHaveLength(1)
    expect(result.agent.injectedOptions[0]?.source)
      .toMatchObject({ kind: 'session-reference', references: [{ sessionId: 'source-session' }] })

    const mention = formatSessionReferenceMention({ sessionId: sourceId, label: 'Source chat' })
    result.agent.status = 'running'
    result.terminal.send(`steer ${mention}`)
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.agent.steered).toHaveLength(1) })
    expect(result.agent.steered).toEqual([[{ type: 'text', text: 'steer @Source chat' }]])
    // Steering bypasses admission, so its snapshot still arrives via inject.
    expect(result.agent.injected).toHaveLength(2)
    expect(result.agent.injectedOptions[1]?.source)
      .toMatchObject({ kind: 'session-reference', references: [{ sessionId: 'source-session' }] })
    await dispose(result)
  })

  it('injects a referenced snapshot before steering a running agent', async () => {
    const result = await setup({
      status: 'running',
      omitInitialLifecycle: true,
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
        const source = ctx.sessions.create(SessionId('steering-src'), {
          meta: { cwd: process.cwd(), createdAt: 1 },
        })
        appendUser(source, 'source background')
      },
    })

    result.terminal.send(formatSessionReferenceMention({
      sessionId: SessionId('steering-src'),
      label: 'Steering source',
    }))
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.agent.steered).toHaveLength(1) })

    expect(result.agent.sent).toHaveLength(0)
    expect(result.agent.injectedOptions[0]?.source)
      .toMatchObject({ kind: 'session-reference', references: [{ sessionId: 'steering-src' }] })
    await dispose(result)
  })

  it('pairs successive idle referenced prompts with their own injected snapshots', async () => {
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
        const source = ctx.sessions.create(SessionId('pair-source'), {
          meta: { cwd: process.cwd(), createdAt: 1 },
        })
        appendUser(source, 'source background')
      },
    })
    const send = async (): Promise<void> => {
      result.terminal.send('@pair-source')
      await vi.waitFor(() => { expect(result.terminal.output).toContain('Session · pair-source') })
      result.terminal.send('\t')
      await tick()
      result.terminal.send('\r')
    }
    await send()
    await vi.waitFor(() => { expect(result.agent.sent).toHaveLength(1) })
    await send()
    await vi.waitFor(() => { expect(result.agent.sent).toHaveLength(2) })

    expect(result.agent.injectedOptions).toHaveLength(2)
    expect(result.agent.injectedOptions.map(message => message.source))
      .toEqual([
        expect.objectContaining({ kind: 'session-reference' }),
        expect.objectContaining({ kind: 'session-reference' }),
      ])
    await dispose(result)
  })

  it('fuzzy-completes files and directories while sending only the selected path text', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-tui-file-completion-'))
    await mkdir(join(cwd, 'src'), { recursive: true })
    await mkdir(join(cwd, 'docs'), { recursive: true })
    await writeFile(join(cwd, 'src', 'source-file.ts'), 'export const source = true\n')
    await writeFile(join(cwd, 'docs', 'design notes.md'), '# Design\n')
    await writeFile(join(cwd, 'unsafe\nfile.ts'), 'unsafe name\n')
    const result = await setup({
      cwd,
      tools: {
        read: {
          name: 'read',
          description: 'Read a file.',
          parameters: {},
          output: UNUSED_TOOL_OUTPUT,
          execute: () => Promise.resolve([]),
        },
      },
    })
    try {
      const assembly = await result.ctx.systemPrompt.assemble(assembleContextFor(result.agent))
      expect(assembly.sections).toContainEqual({
        name: 'ui:tui-file-reference',
        text: FILE_REFERENCE_PROMPT,
      })

      result.terminal.send('@sfts')
      await vi.waitFor(() => {
        expect(result.terminal.output).toContain('File · source-file.ts')
      })
      expect(result.terminal.output).toContain('src/source-file.ts')
      result.terminal.send('\t')
      await tick()
      result.terminal.send('\r')
      await vi.waitFor(() => { expect(result.agent.sent).toHaveLength(1) })
      expect(result.agent.sent[0]).toEqual([{ type: 'text', text: '@src/source-file.ts' }])

      result.terminal.send('@do')
      await vi.waitFor(() => {
        expect(result.terminal.output).toContain('Folder · docs/')
      })
      result.terminal.send('\t')
      await vi.waitFor(() => {
        expect(result.terminal.output).toContain('File · design notes.md')
      })
      result.terminal.send('\t')
      await vi.waitFor(() => {
        expect(result.terminal.output).toContain('@"docs/design notes.md"')
      })
      result.terminal.send('\r')
      await vi.waitFor(() => { expect(result.agent.sent).toHaveLength(2) })
      expect(result.agent.sent[1]).toEqual([{ type: 'text', text: '@"docs/design notes.md"' }])

      result.terminal.send('@unsafe')
      await tick()
      expect(result.terminal.output).not.toContain('File · unsafe')
      result.terminal.send('\x03')
    } finally {
      await result.controller.dispose()
      const assembly = await result.ctx.systemPrompt.assemble(assembleContextFor(result.agent))
      expect(assembly.sections).not.toContainEqual({
        name: 'ui:tui-file-reference',
        text: FILE_REFERENCE_PROMPT,
      })
      await result.ctx.fiber.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('isolates failed file discovery from editor autocomplete', async () => {
    const list = vi.spyOn(WorkspaceFileSearch.prototype, 'list').mockRejectedValue(new Error('search failed'))
    const result = await setup()
    try {
      result.terminal.send('@failed')
      await vi.waitFor(() => { expect(list).toHaveBeenCalled() })
      await tick()
      expect(result.agent.sent).toEqual([])
    } finally {
      list.mockRestore()
      await dispose(result)
    }
  })

  it('shows file-reference guidance only while read is visible to the agent', async () => {
    const read: ToolDefinition = {
      name: 'read',
      description: 'Read a file.',
      parameters: {},
      output: UNUSED_TOOL_OUTPUT,
      execute: () => Promise.resolve([]),
    }
    let visibility: 'none' | 'global' | 'agent' = 'none'
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', {
          get(name: string, scope?: Agent) {
            if (name !== 'read' || visibility === 'none') return undefined
            return (scope === undefined) === (visibility === 'global') ? read : undefined
          },
        } as never)
      },
    })
    const fileReferenceText = async (): Promise<string | undefined> => {
      const assembly = await result.ctx.systemPrompt.assemble(assembleContextFor(result.agent))
      return assembly.sections.find(section => section.name === 'ui:tui-file-reference')?.text
    }
    try {
      expect(await fileReferenceText()).toBe('')
      visibility = 'global'
      expect(await fileReferenceText()).toBe('')
      visibility = 'agent'
      expect(await fileReferenceText()).toBe(FILE_REFERENCE_PROMPT)
      visibility = 'none'
      expect(await fileReferenceText()).toBe('')
    } finally {
      await dispose(result)
    }
  })

  it('escapes session autocomplete metadata while preserving the referenced session id', async () => {
    const unsafeId = SessionId('evil\x1b\x07\u009b\ns')
    const unsafeCwd = '/x/\x1b\x07\u009b\nf'
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
        const source = ctx.sessions.create(unsafeId, { meta: { cwd: unsafeCwd, createdAt: 1 } })
        appendUser(source, 'safe background')
      },
    })

    result.terminal.send('@evil')
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('Session · evil\\x1b\\x07\\x9b\\x0a')
    })
    expect(result.terminal.output).toContain('/x/\\x1b\\x07\\x9b\\x0af')
    expect(result.terminal.output).not.toContain('evil\x1b\x07')
    expect(result.terminal.output).not.toContain('/x/\x1b\x07')

    result.terminal.send('\t')
    await tick()
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.agent.sent).toHaveLength(1) })
    expect(result.agent.sent).toEqual([[
      { type: 'text', text: '@evil\\x1b\\x07\\x9b\\x0as' },
    ]])
    expect(result.agent.injectedOptions[0]?.source)
      .toMatchObject({ references: [{ sessionId: unsafeId }] })
    await dispose(result)
  })

  it('falls back cleanly for non-session, empty, failed, and superseded autocomplete requests', async () => {
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
      },
    })
    const originalListCandidates = result.ctx.sessionReferenceResolver.listCandidates.bind(result.ctx.sessionReferenceResolver)
    const listCandidates = vi.spyOn(result.ctx.sessionReferenceResolver, 'listCandidates')

    result.terminal.send('plain')
    result.terminal.send('\t')
    await tick()
    result.terminal.send('\x03')

    result.terminal.send('/he')
    result.terminal.send('\t')
    await tick()
    result.terminal.send('\x03')

    listCandidates.mockRejectedValueOnce(new Error('candidate lookup failed'))
    result.terminal.send('@failed')
    await vi.waitFor(() => { expect(listCandidates).toHaveBeenCalled() })
    result.terminal.send('\x03')

    result.terminal.send('@empty')
    await tick()
    result.terminal.send('\x03')

    let releaseBase: (() => void) | undefined
    const baseSuggestions = vi.spyOn(CombinedAutocompleteProvider.prototype, 'getSuggestions')
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { releaseBase = resolve })
        return null
      })
    listCandidates.mockResolvedValueOnce([])
    result.terminal.send('@base-slow')
    await vi.waitFor(() => { expect(releaseBase).toBeTypeOf('function') })
    const baseWaitSignal = listCandidates.mock.calls.at(-1)?.[3]
    result.terminal.send('x')
    await vi.waitFor(() => { expect(baseWaitSignal?.aborted).toBe(true) })
    releaseBase?.()
    await tick()
    baseSuggestions.mockRestore()

    let delayedSignal: AbortSignal | undefined
    let delayed = true
    listCandidates.mockImplementation(async (...args) => {
      if (!delayed) return originalListCandidates(...args)
      delayed = false
      delayedSignal = args[3]
      if (delayedSignal === undefined) throw new Error('expected autocomplete cancellation signal')
      await new Promise<void>((_resolve, reject) => {
        delayedSignal?.addEventListener('abort', () => { reject(new Error('superseded')) }, { once: true })
      })
      return []
    })
    result.terminal.send('@slow')
    await vi.waitFor(() => { expect(delayedSignal).toBeDefined() })
    result.terminal.send('x')
    await vi.waitFor(() => { expect(delayedSignal?.aborted).toBe(true) })
    await dispose(result)
  })

  it('keeps failed mention input and renders durable reference contexts as compact cards', async () => {
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
      },
    })
    const missing = formatSessionReferenceMention({ sessionId: SessionId('missing'), label: 'Missing chat' })
    result.terminal.send(`keep ${missing}`)
    result.terminal.send('\r')
    await tick()
    expect(result.agent.sent).toHaveLength(0)
    expect(result.terminal.output).toContain('Session reference failed')
    expect(result.terminal.output).toContain('keep @[')

    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hidden snapshot payload' }],
      source: {
        kind: 'session-reference',
        references: [{ sessionId: 'prefixed', label: 'Prefixed source' }],
      } as never,
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'visible referenced question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await tick()
    expect(result.terminal.output).toContain('visible referenced question')
    expect(result.terminal.output).toContain('Referenced sessions · Prefixed source (prefixed)')
    expect(result.terminal.output).not.toContain('hidden snapshot payload')

    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hidden steering context' }],
      source: {
        kind: 'session-reference',
        references: [{ sessionId: 'steering-source', label: 'Steering source' }],
      } as never,
    }), { surfaceOp: 'append' })
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'visible steering prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await tick()
    expect(result.terminal.output).toContain('visible steering prompt')
    expect(result.terminal.output).toContain('Referenced sessions · Steering source (steering-source)')
    expect(result.terminal.output).not.toContain('hidden steering context')

    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'secret full snapshot payload' }],
      source: {
        kind: 'session-reference',
        version: 1,
        references: [{ sessionId: 'source', label: 'Source', capturedThroughSeq: 2 }],
      } as never,
    }), { surfaceOp: 'append' })
    await tick()
    expect(result.terminal.output).toContain('Referenced sessions · Source (source)')
    expect(result.terminal.output).not.toContain('secret full snapshot payload')

    const invalidCards: [JsonValue, string][] = [
      ['plain-string-source', 'invalid-shape'],
      [{ kind: 'other' }, 'invalid-kind'],
      [{ kind: 'session-reference', references: [null] }, 'invalid-entry'],
      [{ kind: 'session-reference', references: [{}] }, 'invalid-fields'],
    ]
    for (const [source, text] of invalidCards) {
      result.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text }],
        source: source as never,
      }), { surfaceOp: 'append' })
    }
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'same-label snapshot' }],
      source: { kind: 'session-reference', references: [{ sessionId: 'same', label: 'same' }] } as never,
    }), { surfaceOp: 'append' })
    await tick()
    expect(result.terminal.output).toContain('Referenced sessions · same')
    await dispose(result)
  })

  it('reports malformed and unavailable references without enqueueing', async () => {
    const malformed = await setup()
    malformed.terminal.send('use dsh-session:IiJ')
    malformed.terminal.send('\r')
    await tick()
    expect(malformed.agent.sent).toHaveLength(0)
    expect(malformed.terminal.output).toContain('Invalid session reference')
    await dispose(malformed)

    const unavailable = await setup()
    const mention = formatSessionReferenceMention({ sessionId: SessionId('source') })
    unavailable.terminal.send(`use ${mention}`)
    unavailable.terminal.send('\r')
    await tick()
    expect(unavailable.agent.sent).toHaveLength(0)
    expect(unavailable.terminal.output).toContain('Session reference capability unavailable')
    await dispose(unavailable)
  })

  it('clears a retyped successful mention and aborts pending preparation on disposal', async () => {
    const result = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
        ctx.sessions.create(SessionId('source'))
      },
    })
    const mention = formatSessionReferenceMention({ sessionId: SessionId('source') })
    const value = `use ${mention}`
    let release: (() => void) | undefined
    const prepare = vi.spyOn(result.ctx.sessionReferenceResolver, 'prepare').mockImplementation(
      (_agent, content) => new Promise((resolve) => {
        release = () => { resolve({ content }) }
      }),
    )
    result.terminal.send(value)
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(prepare).toHaveBeenCalledOnce() })
    result.terminal.send(value)
    release?.()
    await tick()
    expect(result.agent.sent).toEqual([[{ type: 'text', text: 'use @source' }]])

    let rejectPreparation: (() => void) | undefined
    prepare.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectPreparation = () => { reject(new Error('delayed failure')) }
    }))
    result.terminal.send(value)
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(rejectPreparation).toBeTypeOf('function') })
    result.terminal.send('new draft')
    rejectPreparation?.()
    await tick()
    expect(result.terminal.output).toContain('delayed failure')
    result.terminal.send('\x03')

    let pendingSignal: AbortSignal | undefined
    prepare.mockImplementation((_agent, _content, _references, signal) => new Promise((_resolve, reject) => {
      pendingSignal = signal
      signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    }))
    result.terminal.send(value)
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(pendingSignal).toBeDefined() })
    await result.controller.dispose()
    expect(pendingSignal?.aborted).toBe(true)
    await tick()
    await result.ctx.fiber.dispose()

    const lateSuccess = await setup({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
        ctx.sessions.create(SessionId('source'))
      },
    })
    let resolveAfterDispose: (() => void) | undefined
    const latePrepare = vi.spyOn(lateSuccess.ctx.sessionReferenceResolver, 'prepare').mockImplementation(
      (_agent, content) => new Promise((resolve) => {
        resolveAfterDispose = () => { resolve({ content }) }
      }),
    )
    lateSuccess.terminal.send(value)
    lateSuccess.terminal.send('\r')
    await vi.waitFor(() => { expect(latePrepare).toHaveBeenCalledOnce() })
    await lateSuccess.controller.dispose()
    resolveAfterDispose?.()
    await tick()
    expect(lateSuccess.agent.sent).toHaveLength(0)
    await lateSuccess.ctx.fiber.dispose()
  })

  it('opens the model selector from the prompt shortcut and its full-screen mouse target', async () => {
    const keyboard = await setup({
      agentOptions: { provider: 'alpha', model: 'a1' },
      catalog: {
        providers: [{ id: 'alpha', name: 'Alpha' }],
        models: [{ provider: 'alpha', id: 'a1', name: 'Alpha One' }],
      },
    })
    expect(keyboard.terminal.output).toContain('a1 [alt+m]')
    keyboard.terminal.send('\x1bm')
    await vi.waitFor(() => { expect(keyboard.terminal.output).toContain('Select model') })
    keyboard.terminal.send('\x1b')
    await dispose(keyboard)

    const terminal = new HeadlessTerminal(52, 24)
    const mouse = await createTuiTestHarness(terminal, vi.fn(), {
      config: { fullscreen: true, mouse: true },
      agentOptions: { provider: 'alpha', model: '模型一' },
      catalog: {
        providers: [{ id: 'alpha', name: 'Alpha' }],
        models: [{ provider: 'alpha', id: '模型一', name: '模型一' }],
      },
    })
    await terminal.waitForFrame()
    const before = await terminal.snapshot()
    const rowLine = before.split('\n').find(line => line.includes('模型一 [alt+m]'))
    expect(rowLine).toBeDefined()
    const separator = rowLine?.indexOf('| ') ?? -1
    const row = Number(rowLine?.slice(0, separator).replace('~', '')) + 1
    const text = JSON.parse(rowLine?.slice(separator + 2) ?? '""') as string
    const modelOffset = text.indexOf('模型一 [alt+m]')
    const column = visibleWidth(text.slice(0, modelOffset)) + 1
    terminal.send(`\x1b[<0;${column};${row}M`)
    await vi.waitFor(async () => {
      expect(await terminal.snapshot()).toContain('Select model')
    })
    await disposeTuiTestHarness(mouse)
    await terminal.dispose()
  })

  it('keeps injected context and reasoning folded until the prompt details target is clicked', async () => {
    const terminal = new HeadlessTerminal(96, 28)
    const result = await createTuiTestHarness(terminal, vi.fn(), {
      config: { fullscreen: true, mouse: true },
      beforeMount(session) {
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: '<system-reminder>\nprivate context line\n</system-reminder>' }],
          source: { kind: 'plugin', plugin: 'workspace-context' },
        }), { surfaceOp: 'append' })
        appendAssistant(session, [
          { type: 'reasoning', text: 'private reasoning line' },
          { type: 'text', text: 'visible answer' },
        ])
      },
    })
    await terminal.waitForFrame()
    const before = await terminal.snapshot()
    expect(before).toContain('▸ idle')
    expect(before).toContain('▸ 1 line hidden')
    expect(before).not.toContain('private context line')
    expect(before).not.toContain('private reasoning line')
    expect(before).toContain('visible answer')

    const rowLine = before.split('\n').find(line => line.includes('▸ idle'))
    expect(rowLine).toBeDefined()
    const separator = rowLine?.indexOf('| ') ?? -1
    const row = Number(rowLine?.slice(0, separator).replace('~', '')) + 1
    const text = JSON.parse(rowLine?.slice(separator + 2) ?? '""') as string
    const detailsOffset = text.indexOf('▸ idle')
    const column = visibleWidth(text.slice(0, detailsOffset)) + 1
    terminal.send(`\x1b[<0;${column};${row}M`)

    await vi.waitFor(async () => {
      const expanded = await terminal.snapshot()
      expect(expanded).toContain('▾ idle')
      expect(expanded).toContain('private context line')
      expect(expanded).toContain('private reasoning line')
    })
    await disposeTuiTestHarness(result)
    await terminal.dispose()
  })

  it('keeps a long full-screen transcript scrollable and resumes following at the tail', async () => {
    const terminal = new HeadlessTerminal(72, 24)
    const result = await createTuiTestHarness(terminal, vi.fn(), {
      config: { fullscreen: true, mouse: true },
      beforeMount(session) {
        for (let index = 0; index < 18; index++) appendUser(session, `transcript row ${String(index)}`)
      },
    })
    await terminal.waitForFrame()
    const tail = await terminal.snapshot()
    expect(tail).toContain('transcript row 17')
    expect(tail).not.toContain('transcript row 0')

    const beforeOlder = terminal.frames
    for (let index = 0; index < 24; index++) terminal.send('\x1b[<64;1;1M')
    await terminal.waitForFrame(beforeOlder)
    const older = await terminal.snapshot()
    expect(older).toContain('transcript row 0')
    expect(older).not.toContain('transcript row 17')

    const beforeTail = terminal.frames
    for (let index = 0; index < 24; index++) terminal.send('\x1b[<65;1;1M')
    await terminal.waitForFrame(beforeTail)
    expect(await terminal.snapshot()).toContain('transcript row 17')

    appendUser(result.session, 'transcript row 18')
    await terminal.waitForFrame()
    expect(await terminal.snapshot()).toContain('transcript row 18')
    await disposeTuiTestHarness(result)
    await terminal.dispose()
  })

  it('opens a keyboard selector and switches the session model without sending slash text to the agent', async () => {
    const initialContext = Promise.withResolvers<{ contextWindow: number }>()
    let deferInitialContext = true
    const result = await setup({
      agentOptions: { provider: 'alpha', model: 'a1' },
      contextTokens: 50,
      catalog: {
        providers: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
        models: [
          { provider: 'alpha', id: 'a1', name: 'Alpha One', description: 'Fast' },
          { provider: 'alpha', id: 'shared', name: 'Alpha Shared' },
          { provider: 'beta', id: 'b1', name: 'Beta One' },
          { provider: 'beta', id: 'shared', name: 'Beta Shared' },
        ],
        async resolveModelInfo(provider, model) {
          const shouldDeferContext = provider === 'alpha' && model === 'a1' && deferInitialContext
          if (shouldDeferContext) deferInitialContext = false
          const context = shouldDeferContext
            ? await initialContext.promise
            : { contextWindow: 200 }
          let reasoning: LlmModelReasoningInfo | undefined
          if (model === 'a1') {
            reasoning = {
              efforts: [
                { id: ReasoningEffortId('low'), name: 'Low' },
                { id: ReasoningEffortId('high'), name: 'High' },
              ],
              defaultEffort: ReasoningEffortId('low'),
            }
          } else if (model === 'b1') {
            reasoning = {
              efforts: [
                { id: ReasoningEffortId('high'), name: 'High' },
                { id: ReasoningEffortId('max'), name: 'Max' },
              ],
              defaultEffort: ReasoningEffortId('high'),
            }
          } else if (provider === 'alpha' && model === 'shared') {
            reasoning = {
              efforts: [
                { id: ReasoningEffortId('standard'), name: 'Standard' },
                { id: ReasoningEffortId('ultra'), name: 'Ultra' },
              ],
            }
          }
          return {
            context,
            ...reasoning === undefined ? {} : { reasoning },
          }
        },
      },
    })

    for (const command of ['/model too many model arguments', '/model missing', '/model shared', '/model alpha/a1', '/model alpha a1']) {
      result.terminal.send(command)
      result.terminal.send('\r')
      await tick()
    }
    expect(result.terminal.output).toContain('Usage: /model')
    expect(result.terminal.output).toContain('Unknown model: missing')
    expect(result.terminal.output).toContain('advertised by multiple providers')
    expect(result.terminal.output).toContain('already alpha/a1')

    const firstSelectorOutput = result.terminal.output.length
    result.terminal.send('/model')
    result.terminal.send('\r')
    result.terminal.send('/model')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output.slice(firstSelectorOutput)).toContain('Select model')
    })
    expect(result.terminal.output.slice(firstSelectorOutput)).toContain('Reasoning effort')
    expect(result.terminal.output.slice(firstSelectorOutput)).toContain('Low')
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output.slice(firstSelectorOutput)).toContain('Alpha One — Fast — High — current')
    result.terminal.send('\x1b[Z')
    await tick()
    expect(result.terminal.output.slice(firstSelectorOutput)).toContain('Alpha One — Fast — Low — current')
    const filterOpenOutput = result.terminal.output.length
    result.terminal.send('beta')
    await tick()
    expect(result.terminal.output.slice(filterOpenOutput)).toContain('> beta')
    expect(result.terminal.output.slice(filterOpenOutput)).toContain('→ beta/b1')
    const noMatchOutput = result.terminal.output.length
    result.terminal.send('zzz')
    await tick()
    expect(result.terminal.output.slice(noMatchOutput)).toContain('No models match the filter')
    result.terminal.send('\x1b[D')
    await tick()
    expect(result.terminal.output.slice(noMatchOutput)).toContain('No models match the filter')
    result.terminal.send('\x1b')
    await tick()
    const filterClearedOutput = result.terminal.output.length
    result.terminal.send('\x1b')
    await tick()
    expect(result.terminal.output.slice(filterClearedOutput)).not.toContain('Select model')

    const providerDefaultOutput = result.terminal.output.length
    result.terminal.send('/model alpha/shared')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output.slice(providerDefaultOutput)).toContain('Reasoning effort: Default.')
    })
    result.terminal.send('/model')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output.slice(providerDefaultOutput)).toContain('Select model')
    })
    expect(result.terminal.output.slice(providerDefaultOutput)).toContain('Alpha Shared — Default')
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output.slice(providerDefaultOutput)).toContain('Alpha Shared — Standard')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output.slice(providerDefaultOutput)).toContain('Reasoning effort: Standard.')

    const resetDefaultOutput = result.terminal.output.length
    result.terminal.send('/model')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output.slice(resetDefaultOutput)).toContain('Alpha Shared — Standard — current')
    })
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output.slice(resetDefaultOutput)).toContain('Alpha Shared — Ultra — current')
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output.slice(resetDefaultOutput)).toContain('Alpha Shared — Default')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output.slice(resetDefaultOutput)).toContain('Reasoning effort: Default.')
    const explicitResetSeed: LlmCallConfig = {
      provider: 'beta',
      model: 'b1',
      reasoningEffort: ReasoningEffortId('max'),
    }
    await result.ctx.systemPrompt.assemble(assembleContextFor(result.agent))
    await expect(agentEvents(result.ctx, result.agent).waterfall(
      'agent/request',
      { turn: 0, step: 0, signal: new AbortController().signal },
      () => Promise.resolve(explicitResetSeed),
    )).resolves.toEqual({ provider: 'alpha', model: 'shared' })

    const nonReasoningOutput = result.terminal.output.length
    result.terminal.send('/model')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output.slice(nonReasoningOutput)).toContain('Select model')
    })
    result.terminal.send('\x1b[B')
    result.terminal.send('\x1b[B')
    result.terminal.send('\x1b[Z')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output.slice(nonReasoningOutput)).toContain('Model selected: beta/shared.')
    result.terminal.send('/model beta/shared')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output.slice(nonReasoningOutput)).toContain('Model is already beta/shared.')
    })
    await result.ctx.systemPrompt.assemble(assembleContextFor(result.agent))
    result.terminal.send('/model alpha/a1')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output.slice(nonReasoningOutput)).toContain('Reasoning effort: Low.')
    })
    const inheritedEffort: LlmCallConfig = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('max'),
    }
    await expect(agentEvents(result.ctx, result.agent).waterfall(
      'agent/request',
      { turn: 0, step: 0, signal: new AbortController().signal },
      () => Promise.resolve(inheritedEffort),
    )).resolves.toEqual({ provider: 'beta', model: 'shared' })

    result.agent.status = 'running'
    result.terminal.send('/model')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Select model')
    expect(result.terminal.output).toContain('alpha/a1')
    expect(result.terminal.output).toContain('Alpha One — Fast — Low — current')
    expect(result.terminal.output).toContain('Beta One — High')
    result.terminal.send('\x1b[B')
    result.terminal.send('\x1b[B')
    result.terminal.send('\x1b[Z')
    await tick()
    expect(result.terminal.output).toContain('Beta One — Max')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Model selected: beta/b1')
    expect(result.terminal.output).toContain('Reasoning effort: Max.')
    expect(result.agent.sent).toEqual([])
    expect(result.agent.steered).toEqual([])
    initialContext.resolve({ contextWindow: 100 })
    await tick()
    expect(result.terminal.output).not.toContain('50% context')

    result.terminal.send('/model')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('\x1b')
    await tick()
    expect(result.agent.cancelled).not.toContain('cancelled from terminal')
    result.agent.status = 'idle'
    agentEvents(result.ctx, result.agent).emit('agent/status', { status: 'idle' })
    await tick()
    expect(result.terminal.output).toContain('b1 max [alt+m]  ')
    expect(result.terminal.output).toContain('25% context')
    expect(result.terminal.output).not.toContain('tools:collapsed')
    result.terminal.send('/status')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('beta/b1 (effort max; reasoning blocks hidden)')

    const assembly = await result.ctx.systemPrompt.assemble(assembleContextFor(result.agent))
    expect(assembly.variables).toMatchObject({ provider: 'beta', model: 'b1' })
    const seed: LlmCallConfig = { provider: 'alpha', model: 'a1', temperature: 0.2 }
    const request = await agentEvents(result.ctx, result.agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal: new AbortController().signal },
      () => Promise.resolve(seed),
    )
    expect(request).toEqual({
      provider: 'beta',
      model: 'b1',
      reasoningEffort: ReasoningEffortId('max'),
      temperature: 0.2,
    })
    await dispose(result)
  })

  it('restores the logged model, keeps an unlisted current model visible, and reports catalog failures', async () => {
    const resumed = await setup({
      agentOptions: { provider: 'alpha', model: 'configured' },
      catalog: { providers: [{ id: 'beta', name: 'Beta' }], models: [] },
      beforeMount(session) {
        session.append('request/header', {
          header: {
            config: {
              provider: 'beta',
              model: 'private',
              reasoningEffort: ReasoningEffortId('ultra'),
            },
          },
          reason: 'initial',
        })
      },
    })
    resumed.terminal.send('/model')
    resumed.terminal.send('\r')
    await tick()
    expect(resumed.terminal.output).toContain('Select model')
    expect(resumed.terminal.output).toContain('beta/private')
    expect(resumed.terminal.output).toContain('private — ultra — current')
    resumed.terminal.send('\x1b')
    await tick()
    resumed.terminal.send('/model beta/private')
    resumed.terminal.send('\r')
    await tick()
    expect(resumed.terminal.output).toContain('with reasoning effort ultra')
    await dispose(resumed)

    const resumedDefault = await setup({
      catalog: {
        providers: [{ id: 'alpha', name: 'Alpha' }],
        models: [{ provider: 'alpha', id: 'default', name: 'Default Model' }],
      },
      beforeMount(session) {
        session.append('request/header', {
          header: { config: { provider: 'alpha', model: 'default' } },
          reason: 'initial',
        })
      },
    })
    expect(resumedDefault.terminal.output).toContain('default [alt+m]')
    expect(resumedDefault.terminal.output).toContain('↑0 ↓0')
    await dispose(resumedDefault)

    const unset = await setup({
      agentOptions: {},
      catalog: {
        providers: [{ id: 'alpha', name: 'Alpha' }],
        models: [{ provider: 'alpha', id: 'a1', name: 'Alpha One' }],
        resolveModelInfo: () => Promise.resolve({}),
      },
    })
    unset.terminal.send('/model')
    unset.terminal.send('\r')
    await tick()
    unset.terminal.send('\r')
    await tick()
    expect(unset.terminal.output).toContain('Model selected: alpha/a1')
    expect(unset.terminal.output).toContain('a1  ')
    expect(unset.terminal.output).not.toContain('% context')
    await dispose(unset)

    const empty = await setup({ agentOptions: {}, catalog: { providers: [], models: [] } })
    empty.terminal.send('/model')
    empty.terminal.send('\r')
    await tick()
    expect(empty.terminal.output).toContain('Current model: unset')
    expect(empty.terminal.output).toContain('No models are advertised')
    const assembly = await empty.ctx.systemPrompt.assemble(assembleContextFor(empty.agent))
    expect(assembly.variables).toEqual({})
    const seed: LlmCallConfig = { provider: 'fallback', model: 'fallback' }
    await expect(agentEvents(empty.ctx, empty.agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal: new AbortController().signal },
      () => Promise.resolve(seed),
    )).resolves.toBe(seed)
    await dispose(empty)

    const failed = await setup({
      catalog: {
        providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
        models: [],
        listModels: () => Promise.reject(new Error('catalog offline')),
        resolveModelInfo: () => Promise.reject(new Error('capacity offline')),
      },
    })
    failed.terminal.send('/model')
    failed.terminal.send('\r')
    await vi.waitFor(() => {
      expect(failed.terminal.output).toContain('Could not read the model catalog: catalog offline')
    })
    expect(failed.terminal.output).toContain('Could not resolve model context: capacity offline')
    await dispose(failed)

    const reasoningFailed = await setup({
      catalog: {
        providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
        models: [{ provider: 'deepseek-official', id: 'model-1', name: 'Model One' }],
        resolveModelInfo: () => Promise.reject(new Error('reasoning metadata offline')),
      },
    })
    reasoningFailed.terminal.send('/model')
    reasoningFailed.terminal.send('\r')
    await vi.waitFor(() => {
      expect(reasoningFailed.terminal.output).toContain('Could not read the model catalog: reasoning metadata offline')
    })
    await dispose(reasoningFailed)
  })

  it('switches /fast through an advertised low-latency route and restores the previous model', async () => {
    const result = await setup({
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      catalog: {
        providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
        models: [
          { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
          { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        ],
      },
    })
    result.terminal.send('/fast on')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.terminal.output).toContain('Fast route enabled') })
    expect(result.terminal.output).toContain('deepseek-v4-flash')
    result.terminal.send('/fast off')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.terminal.output).toContain('Fast route disabled') })
    expect(result.terminal.output).toContain('Model selected: deepseek-official/deepseek-v4-pro')
    await dispose(result)

    const unavailable = await setup({
      agentOptions: { provider: 'alpha', model: 'pro' },
      catalog: {
        providers: [{ id: 'alpha', name: 'Alpha' }],
        models: [{ provider: 'alpha', id: 'pro', name: 'Pro' }],
      },
    })
    unavailable.terminal.send('/fast on')
    unavailable.terminal.send('\r')
    await vi.waitFor(() => { expect(unavailable.terminal.output).toContain('No advertised model is marked') })
    await dispose(unavailable)
  })

  it('defers a NO_ADAPTER context resolution until the provider registers instead of surfacing an error', async () => {
    // Loader activation order is service-driven: the TUI can mount before a
    // configured adapter plugin activates, so the initial resolveModelInfo
    // fails with NO_ADAPTER. That transient state must not print an error;
    // the resolution retries on llm/adapters-updated.
    const adapters = new Set<string>()
    const result = await setup({
      agentOptions: { provider: 'openai-codex', model: 'gpt-x' },
      contextTokens: 50_000,
      catalog: {
        providers: [],
        models: [],
        resolveModelInfo: () => adapters.has('openai-codex')
          ? Promise.resolve({ context: { contextWindow: 100_000 } })
          : Promise.reject(new LlmError('no adapter registered for provider "openai-codex"', 'NO_ADAPTER')),
      },
    })
    await tick()
    expect(result.terminal.output).not.toContain('Could not resolve model context')

    // A topology commit that still lacks the route parks the wait again.
    result.ctx.emit('llm/adapters-updated')
    await tick()
    expect(result.terminal.output).not.toContain('% context')
    expect(result.terminal.output).not.toContain('Could not resolve model context')

    adapters.add('openai-codex')
    result.ctx.emit('llm/adapters-updated')
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('% context')
    })
    expect(result.terminal.output).not.toContain('Could not resolve model context')

    // A commit after satisfaction is a no-op for the resolved value.
    result.ctx.emit('llm/adapters-updated')
    await tick()
    expect(result.terminal.output).not.toContain('Could not resolve model context')
    await dispose(result)
  })

  it('stops listening for adapter registrations after channel detach', async () => {
    // The listener disposer rides detachListeners() through the controller's
    // detach(): after dispose, a registry commit must not re-enter resolution
    // at all (the isDisposed() guard is a fallback, not the removal).
    const calls: string[] = []
    const result = await setup({
      agentOptions: { provider: 'openai-codex', model: 'gpt-x' },
      catalog: {
        providers: [],
        models: [],
        resolveModelInfo: (provider) => {
          calls.push(provider)
          return Promise.reject(new LlmError('no adapter registered for provider "openai-codex"', 'NO_ADAPTER'))
        },
      },
    })
    await tick()
    const callsAtDetach = calls.length
    await result.controller.dispose()
    result.ctx.emit('llm/adapters-updated')
    await tick()
    expect(calls.length).toBe(callsAtDetach)
    await result.ctx.fiber.dispose()
  })

  it('drops a deferred NO_ADAPTER resolution when the target moved before the adapter registered', async () => {
    const result = await setup({
      agentOptions: { provider: 'openai-codex', model: 'gpt-x' },
      catalog: {
        providers: [{ id: 'alpha', name: 'Alpha' }],
        models: [{ provider: 'alpha', id: 'a1', name: 'Alpha One' }],
        resolveModelInfo: provider => provider === 'alpha'
          ? Promise.resolve({ context: { contextWindow: 64_000 } })
          : Promise.reject(new LlmError('no adapter registered for provider "openai-codex"', 'NO_ADAPTER')),
      },
    })
    await tick()
    // Switching the model re-resolves and clears the deferred wait, so the
    // stale route's adapter arriving afterwards must be a no-op.
    result.terminal.send('/model alpha/a1')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('Model selected: alpha/a1')
    })
    result.ctx.emit('llm/adapters-updated')
    await tick()
    expect(result.terminal.output).not.toContain('Could not resolve model context')
    await dispose(result)
  })

  it('does not render a model catalog that resolves after TUI disposal', async () => {
    const deferred = Promise.withResolvers<never[]>()
    const result = await setup({
      catalog: {
        providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
        models: [],
        listModels: () => deferred.promise,
      },
    })
    result.terminal.send('/model')
    result.terminal.send('\r')
    await result.controller.dispose()
    deferred.resolve([])
    await tick()
    expect(result.terminal.output).not.toContain('Available models')
    await result.ctx.fiber.dispose()

    const rejected = Promise.withResolvers<never[]>()
    const rejectedResult = await setup({
      catalog: {
        providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
        models: [],
        listModels: () => rejected.promise,
      },
    })
    rejectedResult.terminal.send('/model')
    rejectedResult.terminal.send('\r')
    await rejectedResult.controller.dispose()
    rejected.reject(new Error('late catalog failure'))
    await tick()
    expect(rejectedResult.terminal.output).not.toContain('late catalog failure')
    await rejectedResult.ctx.fiber.dispose()

    const context = Promise.withResolvers<{ contextWindow: number }>()
    const contextResult = await setup({
      contextTokens: 99,
      catalog: {
        providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
        models: [],
        resolveModelInfo: () => context.promise.then(value => ({ context: value })),
      },
    })
    await contextResult.controller.dispose()
    context.resolve({ contextWindow: 100 })
    await tick()
    expect(contextResult.terminal.output).not.toContain('99% context')
    await contextResult.ctx.fiber.dispose()
  })

  it('keeps Vim Normal mode non-inserting and returns to Insert mode with i', async () => {
    const result = await setup()
    result.terminal.send('/vim on')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('\x1b')
    await tick()
    expect(result.terminal.output).toContain('VIM NORMAL')
    result.terminal.send('blocked')
    result.terminal.send('i')
    result.terminal.send('hello from vim')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.sent.at(-1)?.[0]).toMatchObject({ type: 'text', text: 'hello from vim' })
    await dispose(result)
  })

  it('discovers and executes plugin commands, then removes TUI-local commands on disposal', async () => {
    const result = await setup()
    const handler = vi.fn(({ rawInput }: CommandInvocation) => ({
      kind: 'success' as const,
      text: `PLUGIN:${rawInput}`,
    }))
    result.ctx.commands.register({
      name: 'plugin-check',
      description: 'Run a plugin command',
      input: { hint: '<value>' },
      handler,
    })
    result.ctx.commands.register({
      name: 'plugin-fail',
      description: 'Fail a plugin command',
      handler: () => { throw new Error('plugin command exploded') },
    })
    result.ctx.commands.register({
      name: 'plugin-error',
      description: 'Return an error result',
      handler: () => ({ kind: 'error' as const, text: 'plugin error result' }),
    })

    result.terminal.send('/plugin-ch')
    await tick()
    expect(result.terminal.output).toContain('<value> — Run a plugin command')
    result.terminal.send('\x03')

    result.terminal.send('/plugin-check  value  ')
    result.terminal.send('\r')
    await tick()

    expect(handler).toHaveBeenCalledTimes(1)
    const invocation = handler.mock.calls[0]?.[0]
    expect(invocation?.agent).toBe(result.agent)
    // pi-tui's Editor owns terminal-line normalization and removes trailing
    // spaces before onSubmit; the registry preserves the adapter-delivered line.
    expect(invocation?.rawInput).toBe('  value')
    expect(result.terminal.output).toContain('PLUGIN:  value')
    result.terminal.send('/plugin-fail')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Command failed: plugin command exploded')
    result.terminal.send('/plugin-error')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('plugin error result')
    result.terminal.send('/help')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('/plugin-check <value> — Run a plugin command')
    expect(result.ctx.commands.list(result.agent).map(command => command.name)).toContain('help')

    await result.controller.dispose()
    expect(result.ctx.commands.list(result.agent).map(command => command.name)).toEqual([
      'plugin-check',
      'plugin-error',
      'plugin-fail',
    ])
    await result.ctx.fiber.dispose()
  })

  it('aborts an in-flight plugin command during TUI disposal', async () => {
    const result = await setup()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let commandSignal: AbortSignal | undefined
    result.ctx.commands.register({
      name: 'wait-plugin',
      description: 'Wait until disposal',
      handler: ({ signal }) => {
        commandSignal = signal
        started()
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => { resolve({ kind: 'error', text: 'late result' }) }, { once: true })
        })
      },
    })

    result.terminal.send('/wait-plugin')
    result.terminal.send('\r')
    await ready
    await result.controller.dispose()

    expect(commandSignal?.aborted).toBe(true)
    expect(result.terminal.output).not.toContain('late result')
    await result.ctx.fiber.dispose()
  })

  it('suppresses a successful plugin result that settles as TUI disposal starts', async () => {
    const result = await setup()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let resolveCommand!: (result: { kind: 'success'; text: string }) => void
    result.ctx.commands.register({
      name: 'late-success',
      description: 'Resolve while the TUI closes',
      handler: () => new Promise((resolve) => {
        resolveCommand = resolve
        started()
      }),
    })

    result.terminal.send('/late-success')
    result.terminal.send('\r')
    await ready
    resolveCommand({ kind: 'success', text: 'must not render after disposal' })
    // Let the command boundary accept the result before disposal, but leave the
    // TUI continuation queued so the success-side disposal guard owns the race.
    await Promise.resolve()
    await result.controller.dispose()
    await tick()

    expect(result.terminal.output).not.toContain('must not render after disposal')
    await result.ctx.fiber.dispose()
  })

  it('cancels before /quit while running and handles agent errors/disposal', async () => {
    const result = await setup({ status: 'running' })
    result.terminal.send('/quit')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.cancelled).toContainEqual({ kind: 'user' })
    expect(result.exit).toHaveBeenCalledWith(0)

    const events = await setup()
    const unrelatedSession = events.ctx.sessions.create(SessionId('unrelated-session'))
    const unrelatedAgent = { ...events.agent, id: unrelatedSession.id, session: unrelatedSession }
    unrelatedSession.append('turn/start', { turn: 1 })
    unrelatedSession.append('todo/write', { todos: [{ content: 'hidden', status: 'pending' }] })
    agentEvents(events.ctx, unrelatedAgent).emit('agent/status', { status: 'running' })
    agentEvents(events.ctx, unrelatedAgent).emit('agent/error', { turn: 1, step: 1, error: new Error('hidden error') })
    agentEvents(events.ctx, unrelatedAgent).emit('agent/disposed', {})
    agentEvents(events.ctx, events.agent).emit('agent/error', { turn: 1, step: 1, error: new Error('live failure') })
    events.session.append('step/end', { turn: 1, step: 1 })
    events.session.append('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { message: 'live failure', code: 'UNKNOWN' } },
    })
    events.session.append('turn/start', { turn: 2 })
    events.session.append('turn/end', {
      turn: 2,
      reason: { kind: 'error', error: { message: 'durable failure', code: 'UNKNOWN' } },
    })
    events.session.append('turn/start', { turn: 3 })
    events.session.append('turn/end', { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    events.session.append('turn/start', { turn: 4 })
    events.session.append('turn/end', { turn: 4, reason: { kind: 'max-tokens' } })
    events.session.append('turn/start', { turn: 5 })
    events.session.append('turn/end', { turn: 5, reason: { kind: 'interrupted' } })
    events.session.append('turn/start', { turn: 6 })
    events.session.append('turn/end', {
      turn: 6,
      reason: { kind: 'error', error: { message: 'structured provider failure', code: 'SERVER' } },
    })
    events.session.append('turn/start', { turn: 8 })
    events.session.append('turn/end', { turn: 8, reason: { kind: 'aborted', reason: { kind: 'disposed' } } })
    events.session.append('turn/start', { turn: 9 })
    // Merge-extensible reason kind unknown to the TUI still names the stop.
    events.session.append('turn/end', { turn: 9, reason: { kind: 'plugin-policy' } as never })
    agentEvents(events.ctx, events.agent).emit('agent/disposed', {})
    await tick()
    expect(events.terminal.output).toContain('live failure')
    expect(events.terminal.output).toContain('durable failure')
    expect(events.terminal.output).toContain('Turn cancelled')
    expect(events.terminal.output).toContain('structured provider failure')
    expect(events.terminal.output).toContain('output-token limit')
    expect(events.terminal.output).toContain('previous process ended')
    expect(events.terminal.output).toContain('Turn stopped: the agent was disposed')
    expect(events.terminal.output).toContain('Turn ended: plugin-policy')
    expect(events.terminal.output).toContain('was disposed')
    await dispose(events)
  })

  it('rejects input after the agent is disposed out from under the TUI', async () => {
    const result = await setup()

    // The agent leaves the registry (e.g. an agent-loop-only reload) while the
    // TUI stays mounted. A later send must report disposal, not drive the
    // detached zombie agent.
    agentEvents(result.ctx, result.agent).emit('agent/disposed', {})
    await tick()
    expect(result.terminal.output).toContain('was disposed')

    result.terminal.send('drive the zombie')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.sent).toHaveLength(0)
    expect(result.agent.steered).toHaveLength(0)
    expect(result.terminal.output).toContain('is disposed')
    await dispose(result)
  })
})

describe('skill slash command', () => {
  const withSkills = async (ctx: Context): Promise<void> => {
    ctx.provide('tools', { get() { return undefined } } as never)
    await ctx.plugin(SkillRegistry)
    const skills = ctx.get('skills')
    if (skills === undefined) throw new Error('skills service not mounted')
    skills.register({ name: 'demo-skill', description: 'Demo skill for tests', source: 'runtime', provider: 'runtime', content: 'Demo instructions body.' })
    skills.register({ name: 'project-skill', description: 'Project skill for tests', source: 'project-dsh', provider: 'runtime', content: 'Project instructions body.' })
    skills.register({
      name: 'user-only-skill',
      description: 'User-only skill',
      invocation: { modelInvocable: false, userInvocable: true },
      source: 'runtime',
      content: 'User-only instructions body.',
    })
    skills.register({
      name: 'model-only-skill',
      description: 'Model-only skill',
      invocation: { modelInvocable: true, userInvocable: false },
      source: 'runtime',
      content: 'Model-only instructions body.',
    })
    skills.register({
      name: 'trusted-only-skill',
      description: 'Trusted-only skill',
      invocation: { modelInvocable: false, userInvocable: false },
      source: 'runtime',
      content: 'Trusted-only instructions body.',
    })
  }

  it('browses only user-invocable skills and invokes a named row through /skills', async () => {
    const result = await setup({ configureContext: withSkills })
    result.terminal.send('/skills')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.terminal.output).toContain('Demo skill for tests') })
    expect(result.terminal.output).toContain('User-only skill')
    expect(result.terminal.output).not.toContain('Model-only skill')
    result.terminal.send('\x1b')
    result.terminal.send('/skills demo-skill')
    result.terminal.send('\r')
    await vi.waitFor(() => { expect(result.agent.sent).toHaveLength(1) })
    const sent = result.agent.sent[0]?.[0]
    expect(sent?.type).toBe('text')
    if (sent?.type !== 'text') throw new Error('expected text skill invocation')
    expect(sent.text).toContain('<skill name="demo-skill">')
    await dispose(result)
  })

  it('labels slash completions by scope and applies user invocation policy', async () => {
    const result = await setup({ configureContext: withSkills })
    result.terminal.send('/')
    await tick()
    expect(result.terminal.output).toContain('approve')
    expect(result.terminal.output).not.toContain('skill:demo-skill')
    result.terminal.send('\x03')
    result.terminal.output = ''
    result.terminal.send('/skill:')
    await tick()
    expect(result.terminal.output).toContain('demo-skill')
    expect(result.terminal.output).toContain('(user)')
    expect(result.terminal.output).toContain('project-skill')
    expect(result.terminal.output).toContain('(project)')
    expect(result.terminal.output).toContain('user-only-skill')
    expect(result.terminal.output).not.toContain('[instructions]')
    expect(result.terminal.output).not.toContain('model-only-skill')
    expect(result.terminal.output).not.toContain('trusted-only-skill')
    await dispose(result)
  })

  it('refreshes slash completions after runtime skill additions and complete removals', async () => {
    let skills: SkillRegistry | undefined
    const result = await setup({
      configureContext: async (ctx) => {
        ctx.provide('tools', { get() { return undefined } } as never)
        await ctx.plugin(SkillRegistry)
        skills = ctx.get('skills')
      },
    })
    if (skills === undefined) throw new Error('skills service not mounted')

    result.terminal.send('/skill:dynamic')
    await tick()
    result.terminal.output = ''
    const disposeSkill = skills.register({
      name: 'dynamic-skill',
      description: 'DYNAMIC_COMPLETION_MARKER',
      source: 'runtime',
      content: 'Dynamic body.',
    })
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('DYNAMIC_COMPLETION_MARKER')
    })

    result.terminal.send('\x03')
    disposeSkill()
    await tick()
    result.terminal.output = ''
    result.terminal.send('/skill:dynamic')
    await tick()
    expect(result.terminal.output).not.toContain('DYNAMIC_COMPLETION_MARKER')
    await dispose(result)
  })

  it('retains last-good slash completions across incomplete snapshots', async () => {
    let skills: SkillRegistry | undefined
    let provider: SkillProvider | undefined
    let invalidate = (): void => {}
    let fail = false
    const result = await setup({
      configureContext: async (ctx) => {
        ctx.provide('tools', { get() { return undefined } } as never)
        await ctx.plugin(SkillRegistry)
        skills = ctx.get('skills')
        provider = {
          name: 'flaky-completion',
          async list() {
            if (fail) throw new Error('transient completion failure')
            return [{
              name: 'stable-skill',
              description: 'STABLE_COMPLETION_MARKER',
              invocation: { modelInvocable: true, userInvocable: true },
              source: 'test',
              provider: 'flaky-completion',
              rank: 1,
              locator: 'stable',
            }]
          },
          async get() {
            return undefined
          },
        }
        skills?.registerProvider((control) => {
          invalidate = control.invalidate
          return provider as SkillProvider
        })
      },
    })
    if (skills === undefined || provider === undefined) throw new Error('skills provider not mounted')

    fail = true
    invalidate()
    await tick()
    result.terminal.output = ''
    result.terminal.send('/skill:stable')
    await tick()
    expect(result.terminal.output).toContain('STABLE_COMPLETION_MARKER')
    await dispose(result)
  })

  it('keeps the latest slash catalog when asynchronous refreshes settle out of order', async () => {
    const pendingSnapshots: Array<PromiseWithResolvers<SkillCatalogSnapshot>> = []
    const result = await setup({
      configureContext: async (ctx) => {
        ctx.provide('tools', { get() { return undefined } } as never)
        ctx.provide('skills', {
          snapshot: () => {
            const pending = Promise.withResolvers<SkillCatalogSnapshot>()
            pendingSnapshots.push(pending)
            return pending.promise
          },
          get: () => Promise.resolve(undefined),
        } as never)
      },
    })
    expect(pendingSnapshots).toHaveLength(1)

    result.ctx.emit('skills/change')
    result.ctx.emit('skills/change')
    expect(pendingSnapshots).toHaveLength(3)
    pendingSnapshots[2]?.resolve({
      skills: [{
        name: 'latest-skill',
        description: 'LATEST_COMPLETION_MARKER',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'runtime',
        provider: 'runtime',
      }],
      complete: true,
    })
    await tick()
    pendingSnapshots[0]?.resolve({
      skills: [{ name: 'stale-first', description: 'STALE_FIRST', invocation: { modelInvocable: true, userInvocable: true }, source: 'runtime', provider: 'runtime' }],
      complete: true,
    })
    pendingSnapshots[1]?.resolve({
      skills: [{ name: 'stale-second', description: 'STALE_SECOND', invocation: { modelInvocable: true, userInvocable: true }, source: 'runtime', provider: 'runtime' }],
      complete: true,
    })
    await tick()

    result.terminal.output = ''
    result.terminal.send('/skill:latest')
    await tick()
    expect(result.terminal.output).toContain('LATEST_COMPLETION_MARKER')
    expect(result.terminal.output).not.toContain('STALE_FIRST')
    expect(result.terminal.output).not.toContain('STALE_SECOND')
    await dispose(result)
  })

  it('loads a skill as a user turn, appending typed instructions', async () => {
    const result = await setup({ configureContext: withSkills })
    result.terminal.send('/skill:demo-skill')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.sent).toEqual([[{ type: 'text', text: '<skill name="demo-skill">\nDemo instructions body.\n</skill>' }]])

    result.agent.status = 'running'
    result.terminal.send('/skill:demo-skill focus on tests')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.steered).toEqual([[{ type: 'text', text: '<skill name="demo-skill">\nDemo instructions body.\n</skill>\n\nfocus on tests' }]])
    await dispose(result)
  })

  it('invokes a user-only skill by its exact name', async () => {
    const result = await setup({ configureContext: withSkills })
    result.terminal.send('/skill:user-only-skill')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.sent).toEqual([[{ type: 'text', text: '<skill name="user-only-skill">\nUser-only instructions body.\n</skill>' }]])
    await dispose(result)
  })

  it('checks user policy before loading and rechecks the loaded definition', async () => {
    const summaries: SkillSummary[] = [
      {
        name: 'model-only-skill',
        description: 'Model-only skill',
        invocation: { modelInvocable: true, userInvocable: false },
        source: 'runtime',
        provider: 'runtime',
      },
      {
        name: 'policy-race-skill',
        description: 'Policy race skill',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'runtime',
        provider: 'runtime',
      },
    ]
    const get = vi.fn((name: string) => Promise.resolve<SkillDefinition | undefined>({
      name,
      description: 'Policy race skill',
      invocation: { modelInvocable: true, userInvocable: false },
      source: 'runtime',
      provider: 'runtime',
      content: 'Instructions must not be delivered.',
    }))
    const result = await setup({
      configureContext: async (ctx) => {
        ctx.provide('tools', { get() { return undefined } } as never)
        ctx.provide('skills', {
          snapshot: () => Promise.resolve({ skills: summaries, complete: true }),
          list: () => Promise.resolve(summaries),
          get,
        } as never)
      },
    })
    result.terminal.send('/skill:model-only-skill')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('/skill:policy-race-skill')
    result.terminal.send('\r')
    await tick()
    expect(result.agent.sent).toEqual([])
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('policy-race-skill', expect.objectContaining({ cwd: '/workspace' }))
    expect(result.terminal.output).toContain('Skill "model-only-skill" is not available for user invocation.')
    expect(result.terminal.output).toContain('Skill "policy-race-skill" is not available for user invocation.')
    expect(result.terminal.output).not.toContain('Instructions must not be delivered.')
    await dispose(result)
  })

  it('auto-invokes a launcher-seeded initial skill as the first turn', async () => {
    const result = await setup({ config: { initialSkill: 'demo-skill' }, configureContext: withSkills })
    // The seed rides the same path as a typed `/skill:demo-skill`, delivered
    // once the chat is live; no user input is required.
    await tick()
    expect(result.agent.sent).toEqual([[{ type: 'text', text: '<skill name="demo-skill">\nDemo instructions body.\n</skill>' }]])
    await dispose(result)
  })

  it('reports an unknown initial skill as a notice without sending', async () => {
    const result = await setup({ config: { initialSkill: 'nope' }, configureContext: withSkills })
    await tick()
    expect(result.terminal.output).toContain('Unknown skill: nope')
    expect(result.agent.sent).toEqual([])
    await dispose(result)
  })

  it('reports an unknown skill and an empty skill name without sending', async () => {
    const result = await setup({ configureContext: withSkills })
    result.terminal.send('/skill:does-not-exist')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('/skill:')
    result.terminal.send('\r')
    await tick()
    // A space right after the colon parses to an empty name, not a name of
    // "focus"; the documented syntax puts the name immediately after the colon.
    result.terminal.send('/skill: focus')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Unknown skill: does-not-exist')
    expect(result.terminal.output).toContain('Usage: /skill:<name>')
    expect(result.agent.sent).toEqual([])
    await dispose(result)
  })

  it('warns when no skill service is mounted', async () => {
    const result = await setup()
    result.terminal.send('/skill:demo-skill')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Skills are not available')
    expect(result.agent.sent).toEqual([])
    await dispose(result)
  })

  it('surfaces skill lookup failures as an error notice', async () => {
    const result = await setup({
      configureContext: async (ctx) => {
        ctx.provide('tools', { get() { return undefined } } as never)
        ctx.provide('skills', {
          snapshot: () => Promise.reject(new Error('list boom')),
          list: () => Promise.reject(new Error('list boom')),
          get: () => Promise.reject(new Error('get boom')),
        } as never)
      },
    })
    result.terminal.send('/skill:demo-skill')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('failed to load')
    expect(result.terminal.output).toContain('list boom')
    await dispose(result)
  })

  it('drops skill list and lookup results that settle after disposal', async () => {
    let listCalls = 0
    let resolvePendingList: ((value: SkillSummary[]) => void) | undefined
    const pendingSnapshots: Array<(value: SkillCatalogSnapshot) => void> = []
    const pendingGet: Array<{ resolve: (value: SkillDefinition | undefined) => void; reject: (error: unknown) => void }> = []
    const result = await setup({
      configureContext: async (ctx) => {
        ctx.provide('tools', { get() { return undefined } } as never)
        ctx.provide('skills', {
          snapshot: () => new Promise<SkillCatalogSnapshot>((resolve) => { pendingSnapshots.push(resolve) }),
          list: () => {
            listCalls += 1
            if (listCalls === 1 || listCalls === 2) {
              const name = listCalls === 1 ? 'demo-skill' : 'error-skill'
              return Promise.resolve<SkillSummary[]>([{
                name,
                description: 'demo',
                invocation: { modelInvocable: true, userInvocable: true },
                source: 'runtime',
                provider: 'runtime',
              }])
            }
            return new Promise<SkillSummary[]>((resolve) => { resolvePendingList = resolve })
          },
          get: () => new Promise<SkillDefinition | undefined>((resolve, reject) => { pendingGet.push({ resolve, reject }) }),
        } as never)
      },
    })
    await tick()
    result.terminal.send('/skill:demo-skill')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('/skill:error-skill')
    result.terminal.send('\r')
    await tick()
    result.terminal.send('/skill:other-skill')
    result.terminal.send('\r')
    await tick()
    await dispose(result)

    result.ctx.emit('skills/change')
    expect(pendingSnapshots).toHaveLength(1)
    for (const resolve of pendingSnapshots) {
      resolve({
        skills: [{
          name: 'late',
          description: 'late',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'runtime',
          provider: 'runtime',
        }],
        complete: true,
      })
    }
    resolvePendingList?.([{
      name: 'other-skill',
      description: 'late',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      provider: 'runtime',
    }])
    pendingGet[0]?.resolve({
      name: 'demo-skill',
      description: 'late',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'runtime',
      provider: 'runtime',
      content: 'late body',
    })
    pendingGet[1]?.reject(new Error('late failure'))
    await tick()
    expect(result.agent.sent).toEqual([])
    expect(result.terminal.output).not.toContain('late body')
    expect(result.terminal.output).not.toContain('late failure')
  })
})

describe('renderSkillInvocation', () => {
  const skill: SkillDefinition = {
    name: 'demo-skill',
    description: 'Demo skill',
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'runtime',
    provider: 'runtime',
    content: 'Body text.',
  }

  it('renders directory, url, opaque, and absent resource bases', () => {
    expect(renderSkillInvocation({ ...skill, resourceBase: { kind: 'directory', path: '/skills/demo' } }, '')).toBe(
      '<skill name="demo-skill">\nReferences in this skill are relative to /skills/demo.\n\nBody text.\n</skill>',
    )
    expect(renderSkillInvocation({ ...skill, resourceBase: { kind: 'url', url: 'https://x/y' } }, 'go')).toBe(
      '<skill name="demo-skill">\nReferences in this skill are relative to https://x/y.\n\nBody text.\n</skill>\n\ngo',
    )
    expect(renderSkillInvocation({ ...skill, resourceBase: { kind: 'opaque', description: 'held in memory' } }, '')).toBe(
      '<skill name="demo-skill">\nheld in memory\n\nBody text.\n</skill>',
    )
    expect(renderSkillInvocation(skill, '')).toBe('<skill name="demo-skill">\nBody text.\n</skill>')
  })

  it('throws on an unknown resource base kind', () => {
    expect(() => renderSkillInvocation({ ...skill, resourceBase: { kind: 'future' } as never }, '')).toThrow('unreachable variant')
  })
})

describe('tool cards and surface replay', () => {
  const tools: Record<string, ToolDefinition> = {
    bash: {
      name: 'bash', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'terminal', title: 'printf hello', description: 'Run command', cwd: '/tmp' }),
      presentResult: () => ({ card: 'terminal', output: 'hello\nworld\nthird', exitCode: 0 }),
    },
    signal: {
      name: 'signal', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'terminal', title: 'sleep 10' }),
      presentResult: () => ({ card: 'terminal', signal: 'SIGTERM' }),
    },
    edit: {
      name: 'edit', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({
        card: 'diff',
        title: 'Edit files',
        diffs: [
          { path: 'a.txt', oldText: 'old', newText: 'new' },
          { path: 'b.txt', oldText: 'before', newText: 'after' },
        ],
      }),
      presentResult: () => ({ card: 'diff', diffs: [{ path: 'a.txt', oldText: null, newText: 'created' }] }),
    },
    singleDiff: {
      name: 'singleDiff', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({
        card: 'diff',
        title: 'Edit src/only.ts',
        diffs: [{
          path: 'src/only.ts',
          oldText: 'my: my-MM\nne: ne-NP\nnl: nl-NL\nnb: no-NO\npa: pa-Guru-IN\npl: pl-PL\npt_pt: pt-PT',
          newText: 'my: my-MM\nne: ne-NP\nnl: nl-NL\nnb: nb-NO\npa: pa-Guru-IN\npl: pl-PL\npt_pt: pt-PT',
        }],
      }),
    },
    scatteredDiff: {
      name: 'scatteredDiff', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      // Three hunks in ONE file. The first two sides end in the terminator
      // newline real write/edit content carries; the third removes a line and
      // leaves an EMPTY added side (a full deletion), so `diffContentLines('')`
      // returns zero lines. The footer must read `+2 -1 · 1 file`: each trailing
      // newline terminates its line rather than adding a phantom empty one, the
      // empty side contributes no `+ ` row, and the three hunks count as the
      // single distinct path they touch.
      presentCall: () => ({
        card: 'diff',
        title: 'Edit src/scatter.ts',
        diffs: [
          { path: 'src/scatter.ts', oldText: null, newText: 'first\n' },
          { path: 'src/scatter.ts', oldText: null, newText: 'second\n' },
          { path: 'src/scatter.ts', oldText: 'gone\n', newText: '' },
        ],
      }),
    },
    generic: {
      name: 'generic', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'generic', title: 'Inspect value', rawInput: { alpha: 1 } }),
      presentResult: () => ({
        card: 'generic',
        title: 'Inspected',
        content: [{ type: 'text', text: 'result **text**\n\n```console\nstarted background task bash-5\n```' }],
      }),
    },
    throwing: {
      name: 'throwing', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => { throw new Error('call presenter boom') },
      presentResult: () => { throw new Error('result presenter boom') },
    },
    rawTerminal: {
      name: 'rawTerminal', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'terminal', title: 'raw command' }),
    },
    // An empty-string description is treated as no description: the header omits
    // the ` / <desc>` segment, exactly as an absent description does.
    emptyDescTerminal: {
      name: 'emptyDescTerminal', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'terminal', title: 'blank desc command', description: '' }),
    },
    // A generic card whose title only repeats the tool name and carries no
    // content or rawInput renders a header with an empty body block.
    emptyBody: {
      name: 'emptyBody', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'generic', title: 'emptyBody' }),
    },
    multilineTerminal: {
      name: 'multilineTerminal', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      // A multi-line bash command as the title/description: the card title and the
      // meta rows are single logical lines and must render inline, not break rows.
      presentCall: () => ({ card: 'terminal', title: 'S=/tmp\necho "$S"', description: 'set\nand echo' }),
    },
    undefinedViews: {
      name: 'undefinedViews', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => undefined,
      presentResult: () => undefined,
    },
    empty: {
      name: 'empty', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'generic', title: 'Empty card' }),
    },
    terminalResult: {
      name: 'terminalResult', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'generic', title: 'Becomes terminal' }),
      presentResult: () => ({ card: 'terminal', output: 'converted terminal' }),
    },
    // A search card carries no result text of its own; the TUI has no dedicated
    // search arm and falls back to the raw result content, rendered as the same
    // dim generic body a pre-search-card grep/glob result showed.
    search: {
      name: 'search', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'generic', title: 'Grep todo', kind: 'search' }),
      presentResult: () => ({
        card: 'search',
        shape: 'matches',
        files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'todo one' }] }],
        truncated: false,
        total: 1,
      }),
    },
    symbolic: {
      name: 'symbolic', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'generic', title: 'Symbol input', rawInput: Symbol('input') }),
    },
    knownXml: {
      name: 'knownXml', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'generic', title: 'Known XML' }),
    },
    // A web card carries no `content` copy, so it falls back to the raw result
    // content, which must still render through the dim Markdown path (bold
    // markers stripped) rather than as bare text.
    webCard: {
      name: 'webCard', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
      presentCall: () => ({ card: 'generic', title: 'Fetch page', kind: 'fetch' }),
      presentResult: () => ({ card: 'web', kind: 'fetch', title: 'https://a.test', url: 'https://a.test', statusCode: 200, truncated: false }),
    },
  }

  it('uses terminal, diff, generic, fallback, and collapsed tool presentations', async () => {
    const result = await setup({ tools, config: { maxToolOutputLines: 4 } })
    const calls = [
      ['c1', 'bash', '{"command":"printf hello"}'],
      ['c2', 'signal', '{}'],
      ['c3', 'edit', '{}'],
      ['c4', 'generic', '{}'],
      ['c5', 'throwing', '{}'],
      ['c6', 'unknown', 'not-json'],
      ['c7', 'rawTerminal', '{"value":"raw"}'],
      ['c14', 'emptyDescTerminal', '{}'],
      ['c15', 'emptyBody', '{}'],
      ['c9', 'multilineTerminal', '{}'],
      ['c8', 'undefinedViews', '{"value":8}'],
      ['c10', 'empty', '{}'],
      ['c11', 'terminalResult', '{}'],
      ['c12', 'symbolic', '{}'],
      ['c13', 'knownXml', '{}'],
      ['c16', 'webCard', '{}'],
      ['c17', 'search', '{"pattern":"todo"}'],
    ] as const
    appendAssistant(result.session, [
      { type: 'text', text: 'Calling tools' },
      ...calls.map(([id, name, args]) => ({
        type: 'tool-call' as const, id: id as never, name, arguments: args,
      })),
    ])
    for (const [id, name, args] of calls) {
      result.session.append('tool/call', { turn: 1, step: 1, callId: id as never, name, arguments: args })
    }
    await tick()
    expect(result.terminal.output).toContain('$ raw command')
    result.terminal.send('\x12')
    await tick()
    expect(result.terminal.output).toContain('call presenter boom')
    expect(result.terminal.output).toContain('Symbol(input)')
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c1' as never,
        content: [{ type: 'text', text: 'raw bash' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c2' as never,
        content: [{ type: 'text', text: 'stopped' }],
        isError: true,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c3' as never,
        content: [{ type: 'text', text: 'done' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c4' as never,
        content: [{ type: 'text', text: 'raw generic' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c5' as never,
        content: [{ type: 'text', text: 'raw throwing' }],
        isError: false,
      }),
      meta: { value: 1 },
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c7' as never,
        content: [
          { type: 'tool-call', id: 'inner' as never, name: 'inner', arguments: '{}' },
          { type: 'tool-result', toolCallId: 'inner' as never, content: [{ type: 'text', text: 'nested output' }] },
          { type: 'future-result' } as never,
        ],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c8' as never,
        content: [{ type: 'text', text: '\nundefined presenter output\n\nkept tail\n' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c11' as never,
        content: [{ type: 'text', text: '\nconverted terminal\n\nfinished\n' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c13' as never,
        content: [{ type: 'text', text: '<known><value>literal</value></known>' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c16' as never,
        content: [{ type: 'text', text: 'Fetched **body** text' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c17' as never,
        content: [{ type: 'text', text: 'Found 1 match\n\na.ts\nLine 1: todo one' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: 'orphan' as never,
        content: [{ type: 'text', text: '<result><path>/tmp/a.txt</path><content><line number="1">hello</line><line number="2">world</line></content></result>' }],
        isError: true,
      }),
      error: { name: 'InterruptedError', code: 'interrupted' },
    }, { surfaceOp: 'append' })
    await tick()

    const output = result.terminal.output
    expect(output).toContain('Run command')
    expect(output).toContain('printf hello')
    // A multi-line terminal title and description render inline (newline escaped
    // to `\x0a`), so they cannot break onto extra rows and collide with the body.
    expect(output).toContain('S=/tmp\\x0aecho "$S"')
    expect(output).toContain('set\\x0aand echo')
    expect(output).toContain('lines (Ctrl+O to expand)')
    expect(output).toContain('SIGTERM')
    // The header is a fixed `Tool / <name>` frame; the tool name shows there.
    expect(output).toContain('Tool / bash')
    expect(output).toContain('Tool / edit')
    // An empty-string terminal description contributes no ` / <desc>` segment;
    // the header ends at the tool name, and the command shows as the body $-line.
    expect(output).toContain('Tool / emptyDescTerminal')
    expect(output).not.toContain('Tool / emptyDescTerminal /')
    expect(output).toContain('$ blank desc command')
    // A card whose title only repeats the name renders header-only (empty body).
    expect(output).toContain('Tool / emptyBody')
    // A search result view carries no `content` of its own, so the card renders
    // the raw model-facing result text through the same dim generic body — the
    // TUI has no dedicated search arm.
    expect(output).toContain('Tool / search')
    expect(output).toContain('Line 1: todo one')
    // A diff card drops its title (the paths + change footer carry the meaning).
    // The first file's path is head-visible; the second file and the change
    // footer sit past this card's 4-line budget and appear only when expanded.
    expect(output).not.toContain('Edit files')
    expect(output).toContain('a.txt')
    // A generic card's presenter title moves from the header into the body.
    expect(output).toContain('Inspected')
    expect(output).toContain('result text')
    expect(output).toContain('started background task bash-5')
    expect(output).not.toContain('```console')
    expect(output).toContain('Presenter failed')
    expect(output).toContain('not-json')
    expect(output).toContain('nested output')
    expect(output).toContain('[future-result]')
    expect(output).toContain('undefined presenter output')
    expect(output).toContain('Empty card')
    expect(output).toContain('converted terminal')
    expect(output).toContain('<known><value>literal</value></known>')
    // A web card carries no `content` copy, so it falls back to the raw result
    // content, which still renders through the dim Markdown path: the bold
    // markers are stripped rather than shown literally.
    expect(output).toContain('Fetched body text')
    expect(output).not.toContain('Fetched **body** text')
    expect(output).toContain('path: /tmp/a.txt')
    expect(output).toContain('line (number="1"): hello')
    expect(output).not.toContain('<result>')

    result.terminal.send('\x0c')
    await tick()
    const collapsed = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(collapsed).toContain('Run command')
    expect(collapsed).toContain('[exit 0]')
    expect(collapsed).not.toContain('▌ hello')
    expect(collapsed).not.toContain('▌ world')
    result.terminal.send('\x0f')
    await tick()
    expect(result.terminal.output).toContain('world')
    expect(result.terminal.output).toContain('Tool and context cards expanded.')
    expect(result.terminal.output).not.toContain('tools:expanded')
    expect(result.terminal.output).toContain('+ created')
    expect(result.terminal.output).toContain('console')
    // The multi-file diff's second-file change and its footer surface once
    // expanded (`+ after` is b.txt's new text; the footer counts both files).
    expect(result.terminal.output).toContain('+ after')
    expect(result.terminal.output).toContain('· 2 files')

    // Third Ctrl+O phase hides every tool card: after a redraw the repainted
    // frame carries no tool header at all, only the conversation.
    result.terminal.send('\x0f')
    await tick()
    expect(result.terminal.output).toContain('Tool cards hidden.')
    // A result for an untracked call mints a fallback card mid-hidden: it must
    // adopt the current visibility instead of rendering collapsed.
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'untracked' as never,
        content: [{ type: 'text', text: 'fallback result body' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    await tick()
    result.terminal.send('\x0c')
    await tick()
    const hiddenFrame = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(hiddenFrame).not.toContain('Tool / bash')
    expect(hiddenFrame).not.toContain('Run command')
    expect(hiddenFrame).not.toContain('fallback result body')
    // The dozen hidden cards leave no per-card blank rows behind: each card owns
    // its leading gap, so the trimmed frame has no long blank run where the
    // cards used to be.
    const frameRows = hiddenFrame.split('\n').map(row => row.replaceAll(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim())
    const first = frameRows.findIndex(row => row.includes('Calling tools'))
    expect(first).toBeGreaterThan(-1)
    let blankRun = 0
    let longestRun = 0
    for (const row of frameRows.slice(first)) {
      blankRun = row === '' ? blankRun + 1 : 0
      longestRun = Math.max(longestRun, blankRun)
    }
    expect(longestRun).toBeLessThanOrEqual(2)
    await dispose(result)
  })

  it('names a single-file diff in the body once, under a fixed Tool header', async () => {
    const result = await setup({ tools, config: { maxToolOutputLines: 20 } })
    appendUser(result.session, 'edit one file')
    appendAssistant(result.session, [
      { type: 'text', text: 'Editing' },
      { type: 'tool-call', id: 'single' as never, name: 'singleDiff', arguments: '{}' },
    ])
    result.session.append('tool/call', {
      turn: 1, step: 1, callId: 'single' as never, name: 'singleDiff', arguments: '{}',
    })
    await tick()
    const output = result.terminal.output
    // The header is a fixed `Tool / <name>` frame; the diff title is dropped and
    // the file path shows once in the body, above the change footer.
    expect(output).toContain('Tool / singleDiff')
    expect(output).not.toContain('Edit src/only.ts')
    expect(output.split('src/only.ts').length - 1).toBe(1)
    expect(output).toContain('  my: my-MM')
    expect(output).not.toContain('- my: my-MM')
    expect(output).not.toContain('+ my: my-MM')
    expect(output).toContain('- nb: no-NO')
    expect(output).toContain('+ nb: nb-NO')
    expect(output).toContain('└ +1 -1 · 1 file')
    await dispose(result)
  })

  it('renders an empty create without a synthetic added row', async () => {
    const emptyCreate: Record<string, ToolDefinition> = {
      emptyCreate: {
        name: 'emptyCreate',
        description: '',
        parameters: {},
        output: UNUSED_TOOL_OUTPUT,
        execute: async () => [],
        presentCall: () => ({
          card: 'diff',
          title: 'Write empty.txt',
          diffs: [{ path: 'empty.txt', oldText: null, newText: '' }],
        }),
      },
    }
    const result = await setup({
      tools: emptyCreate,
      config: { maxToolOutputLines: 20, theme: { color: false } },
    })
    appendAssistant(result.session, [
      { type: 'tool-call', id: 'empty-create' as never, name: 'emptyCreate', arguments: '{}' },
    ])
    result.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'empty-create' as never,
      name: 'emptyCreate',
      arguments: '{}',
    })
    await tick()
    const rows = result.terminal.output.split('\n').map(row => row.trim())
    expect(result.terminal.output).toContain('empty.txt')
    expect(result.terminal.output).toContain('└ +0 -0 · 1 file')
    expect(rows).not.toContain('+')
    await dispose(result)
  })

  it('bounds and caches exact diff comparison before whole-side fallback', async () => {
    let oldTextReads = 0
    let newText = 'new one\nnew two'
    const boundedDiff = {
      path: 'bounded.txt',
      get oldText() {
        oldTextReads += 1
        return 'old one\nold two'
      },
      get newText() { return newText },
    }
    const boundedView = {
      card: 'diff' as const,
      title: 'Edit bounded.txt',
      diffs: [boundedDiff],
    }
    const bounded: Record<string, ToolDefinition> = {
      bounded: {
        name: 'bounded',
        description: '',
        parameters: {},
        output: UNUSED_TOOL_OUTPUT,
        execute: async () => [],
        presentCall: () => boundedView,
        presentResult: () => {
          newText = 'settled one\nsettled two'
          return boundedView
        },
      },
    }
    const result = await setup({
      tools: bounded,
      config: {
        maxToolOutputLines: 20,
        maxDiffEditLength: 1,
        theme: { color: false },
      },
    })
    appendAssistant(result.session, [
      { type: 'tool-call', id: 'bounded-diff' as never, name: 'bounded', arguments: '{}' },
    ])
    result.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'bounded-diff' as never,
      name: 'bounded',
      arguments: '{}',
    })
    await tick()
    expect(result.terminal.output).toContain('[exact line diff omitted: >1 changed lines]')
    expect(result.terminal.output).toContain('- old one')
    expect(result.terminal.output).toContain('+ new one')
    expect(result.terminal.output).toContain('└ +2 -2 · 1 file · approximate')
    const readsAfterFirstRender = oldTextReads
    expect(readsAfterFirstRender).toBeGreaterThan(0)
    result.session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: 'bounded-diff' as never,
        content: [{ type: 'text', text: 'done' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    await tick()
    expect(result.terminal.output).toContain('+ settled one')
    expect(oldTextReads).toBeGreaterThan(readsAfterFirstRender)
    const readsAfterResult = oldTextReads
    result.terminal.resize(87)
    await tick()
    expect(oldTextReads).toBe(readsAfterResult)
    await dispose(result)
  })

  it('counts a same-file diff once and terminates its trailing newline', async () => {
    // A budget past the card's row count so every hunk row stays visible (the
    // collapse arithmetic is covered elsewhere); this test is about the
    // terminator rule and the distinct-path footer count.
    const result = await setup({ tools, config: { maxToolOutputLines: 20 } })
    appendUser(result.session, 'scatter edits in one file')
    appendAssistant(result.session, [
      { type: 'text', text: 'Editing' },
      { type: 'tool-call', id: 'scatter' as never, name: 'scatteredDiff', arguments: '{}' },
    ])
    result.session.append('tool/call', {
      turn: 1, step: 1, callId: 'scatter' as never, name: 'scatteredDiff', arguments: '{}',
    })
    await tick()
    const output = result.terminal.output
    // Three hunks, one path: distinct-path count, same as the Web DiffBlock.
    expect(output).toContain('· 1 file')
    expect(output).not.toContain('· 3 files')
    // The `first\n`/`second\n` sides each contribute exactly one added line —
    // the trailing newline terminates rather than adding a phantom empty `+ `.
    expect(output).toContain('+ first')
    expect(output).toContain('+ second')
    // The third hunk removes `gone` and leaves an empty added side, which
    // contributes no `+ ` row (diffContentLines('') is zero lines).
    expect(output).toContain('- gone')
    expect(output).toContain('+2 -1')
    // Only the first hunk names the file; adjacent hunks use Web DiffBlock's
    // gap marker so scattered edits remain one visual file group.
    expect(output.match(/src\/scatter\.ts/gu)).toHaveLength(1)
    expect(output.match(/⋯/gu)).toHaveLength(2)
    await dispose(result)
  })

  it('drops blank rows from a terminal card result that the dim styling wraps', async () => {
    const blankRowTools: Record<string, ToolDefinition> = {
      trailing: {
        name: 'trailing', description: '', parameters: {}, output: UNUSED_TOOL_OUTPUT, execute: async () => [],
        presentCall: () => ({ card: 'terminal', title: 'printf out', description: 'Run it', cwd: '/tmp' }),
        // Real command output ends in a newline, so the split yields a trailing blank row.
        presentResult: () => ({ card: 'terminal', output: 'first\n\nlast\n', exitCode: 0 }),
      },
    }
    // Color on: the dim wrapper is what makes a blank row non-empty, so the
    // guard against wrapping one is only observable with ANSI enabled.
    const result = await setup({ tools: blankRowTools, config: { theme: { color: true } } })
    appendUser(result.session, 'run it')
    appendAssistant(result.session, [
      { type: 'tool-call', id: 'blank' as never, name: 'trailing', arguments: '{}' },
    ])
    result.session.append('tool/call', {
      turn: 1, step: 1, callId: 'blank' as never, name: 'trailing', arguments: '{}',
    })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'blank' as never, content: [{ type: 'text', text: 'ignored' }], isError: false,
      }),
    }, { surfaceOp: 'append' })
    await tick()
    // Each output row is dim-wrapped, and the result's blank rows are dropped
    // rather than kept as dim-wrapped empty strings: `last` is the row right
    // after `first`, and no empty dim pair reaches the terminal.
    expect(result.terminal.output).toContain('\x1b[2;39mfirst\x1b[22;39m')
    expect(result.terminal.output).toContain('\x1b[2;39mlast\x1b[22;39m')
    expect(result.terminal.output).not.toContain('\x1b[2;39m\x1b[22;39m')
    const rows = result.terminal.output.split('\n')
    const firstRow = rows.findIndex(row => row.includes('first'))
    expect(firstRow).toBeGreaterThan(-1)
    expect(rows[firstRow + 1]).toContain('last')
    expect(rows[firstRow + 2]).toContain('[exit 0]')
    await dispose(result)
  })

  it('keeps append-origin history and marks a landed compaction, live and on rebuild', async () => {
    const result = await setup({ tools })
    appendUser(result.session, 'old prompt')
    result.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'old-call' as never, name: 'bash', arguments: '{}' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'deepseek-v4-flash' },
        },
      }),
    }, { surfaceOp: 'append' })
    result.session.append('tool/call', {
      turn: 1, step: 1, callId: 'old-call' as never, name: 'bash', arguments: '{}',
    })
    const toolResult = result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'old-call' as never,
        content: [{ type: 'text', text: 'old output' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    // Result pruning rewrites one node's content in place: model-only, and no
    // boundary in the conversation, so the terminal keeps the full output.
    const originalResult = toolResult.data.message.content[0]
    result.session.append('tool/result', {
      ...toolResult.data,
      message: freezeMessage({
        ...toolResult.data.message,
        content: [{ ...originalResult, content: [{ type: 'text', text: 'pruned result copy' }] }] as [typeof originalResult],
      }),
    }, {
      surfaceOp: { op: 'replace', start: toolResult.seq, end: toolResult.seq },
      sourceEventSeqs: [toolResult.seq],
    })
    const nodes = [...result.session.surface.nodes]
    const checkpoint = result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<context_checkpoint>model-only summary payload</context_checkpoint>' }],
      source: COMPACT_CHECKPOINT_SOURCE,
    }), {
      surfaceOp: { op: 'replace', start: nodes[0] as number, end: nodes.at(-1) as number },
      sourceEventSeqs: nodes,
    })
    // A regenerated assistant message replaces one node without summarizing
    // anything, so it marks no boundary either.
    const generic = result.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'generic replacement copy' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'deepseek-v4-flash' },
        },
      }),
    }, { surfaceOp: { op: 'replace', start: checkpoint.seq, end: checkpoint.seq }, sourceEventSeqs: [checkpoint.seq] })
    // Only a checkpoint carrying the compaction seam's source marks a boundary:
    // another plugin replacing a node is model-only.
    result.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'foreign plugin replacement copy' }],
      source: { kind: 'plugin', plugin: 'other' },
    }), { surfaceOp: { op: 'replace', start: generic.seq, end: generic.seq }, sourceEventSeqs: [generic.seq] })
    await tick()

    result.terminal.resize(89)
    await tick()
    const liveRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(liveRender).toContain('old prompt')
    // The shadowed step keeps its card: one call row, one full result, no
    // second card from the pruned copy.
    expect(liveRender.split('$ printf hello')).toHaveLength(2)
    expect(liveRender).toContain('third')
    expect(liveRender.split('[exit 0]')).toHaveLength(2)
    expect(liveRender.split('… earlier context was compacted …')).toHaveLength(2)
    expect(liveRender).not.toContain('model-only summary payload')
    expect(liveRender).not.toContain('generic replacement copy')
    expect(liveRender).not.toContain('foreign plugin replacement copy')

    // Ctrl+R toggles reasoning, which rebuilds the transcript from the log; the
    // replayed projection matches what the live appends produced, including the
    // shadowed assistant message's tool card.
    result.terminal.send('\x12')
    await tick()
    result.terminal.resize(90)
    await tick()
    const replayRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(replayRender).toContain('old prompt')
    expect(replayRender.split('$ printf hello')).toHaveLength(2)
    expect(replayRender).toContain('third')
    expect(replayRender.split('[exit 0]')).toHaveLength(2)
    expect(replayRender.split('… earlier context was compacted …')).toHaveLength(2)
    expect(replayRender).not.toContain('model-only summary payload')
    expect(replayRender).not.toContain('generic replacement copy')
    expect(replayRender).not.toContain('foreign plugin replacement copy')
    await dispose(result)
  })

  it('replays a stored compaction as preserved history plus its marker', async () => {
    const result = await setup({
      beforeMount(session) {
        appendUser(session, 'prompt before compaction')
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'text', text: 'reply before compaction' }],
            source: {
              kind: 'model',
              ...{ provider: 'mock', model: 'deepseek-v4-flash' },
            },
          }),
        }, { surfaceOp: 'append' })
        const nodes = [...session.surface.nodes]
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: '<context_checkpoint>stored model-only payload</context_checkpoint>' }],
          source: COMPACT_CHECKPOINT_SOURCE,
        }), {
          surfaceOp: { op: 'replace', start: nodes[0] as number, end: nodes.at(-1) as number },
          sourceEventSeqs: nodes,
        })
      },
    })
    result.terminal.resize(89)
    await tick()

    const mounted = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(mounted).toContain('prompt before compaction')
    expect(mounted).toContain('reply before compaction')
    expect(mounted.split('… earlier context was compacted …')).toHaveLength(2)
    expect(mounted).not.toContain('stored model-only payload')
    await dispose(result)
  })

  /** The last repainted frame, with CSI/OSC escapes and carriage returns stripped. */
  const lastFrame = (terminal: FakeTerminal): string => terminal.output
    .slice(terminal.output.lastIndexOf('\x1b[2J'))
    .replaceAll(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, '')

  const countAssistantHeaders = (frame: string): number => frame.split('\n')
    .filter(row => row.trim() === 'Assistant').length

  /** One turn with text -> tool call/result -> text across two steps. */
  const appendTwoStepTurn = (session: Awaited<ReturnType<typeof setup>>['session']): void => {
    appendUser(session, 'fold me')
    appendAssistant(session, [{ type: 'text', text: 'first step text' }])
    session.append('tool/call', { turn: 1, step: 1, callId: 'fold-1' as never, name: 'bash', arguments: '{}' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'fold-1' as never, content: [{ type: 'text', text: 'tool body' }], isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('step/start', { turn: 1, step: 2 })
    appendAssistant(session, [{ type: 'text', text: 'second step text' }], undefined, { turn: 1, step: 2 })
    session.append('step/end', { turn: 1, step: 2 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  }

  it('folds a turn to one Assistant header in hidden mode and restores headers on cycle', async () => {
    const result = await setup({ tools })
    appendTwoStepTurn(result.session)
    await tick()

    // Collapsed (default): each step keeps its own header.
    result.terminal.send('\x0c')
    await tick()
    expect(countAssistantHeaders(lastFrame(result.terminal))).toBe(2)

    // collapsed -> expanded -> hidden.
    result.terminal.send('\x0f')
    result.terminal.send('\x0f')
    await tick()
    result.terminal.send('\x0c')
    await tick()
    const hidden = lastFrame(result.terminal)
    expect(countAssistantHeaders(hidden)).toBe(1)
    expect(hidden).toContain('first step text')
    expect(hidden).toContain('second step text')
    expect(hidden).not.toContain('Tool / bash')
    // The fold keeps model order: header text precedes the continuation.
    expect(hidden.indexOf('first step text')).toBeLessThan(hidden.indexOf('second step text'))

    // hidden -> collapsed restores per-step headers.
    result.terminal.send('\x0f')
    await tick()
    result.terminal.send('\x0c')
    await tick()
    expect(countAssistantHeaders(lastFrame(result.terminal))).toBe(2)
    await dispose(result)
  })

  it('gives the hidden-mode header to the first step with a visible body and keeps turns separate', async () => {
    const result = await setup({ tools })
    // Turn 1, step 1 is tool-only; step 2 carries the turn's text.
    appendUser(result.session, 'tool-only first step')
    appendAssistant(result.session, [{ type: 'tool-call', id: 'only-1' as never, name: 'bash', arguments: '{}' }])
    result.session.append('tool/call', { turn: 1, step: 1, callId: 'only-1' as never, name: 'bash', arguments: '{}' })
    result.session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'only-1' as never, content: [{ type: 'text', text: 'tool body' }], isError: false,
      }),
    }, { surfaceOp: 'append' })
    result.session.append('step/end', { turn: 1, step: 1 })
    result.session.append('step/start', { turn: 1, step: 2 })
    appendAssistant(result.session, [{ type: 'text', text: 'late turn-one text' }], undefined, { turn: 1, step: 2 })
    result.session.append('step/end', { turn: 1, step: 2 })
    result.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // Turn 2 keeps its own header.
    result.session.append('turn/start', { turn: 2 })
    appendUser(result.session, 'next turn')
    result.session.append('step/start', { turn: 2, step: 1 })
    appendAssistant(result.session, [{ type: 'text', text: 'turn-two text' }], undefined, { turn: 2, step: 1 })
    result.session.append('step/end', { turn: 2, step: 1 })
    result.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await tick()

    result.terminal.send('\x0f')
    result.terminal.send('\x0f')
    await tick()
    result.terminal.send('\x0c')
    await tick()
    const hidden = lastFrame(result.terminal)
    // One header per turn: the tool-only step neither renders a blank segment
    // nor consumes turn one's header, which the late text step owns.
    expect(countAssistantHeaders(hidden)).toBe(2)
    expect(hidden).toContain('late turn-one text')
    expect(hidden).toContain('turn-two text')
    const rows = hidden.split('\n').map(row => row.trim())
    const turnOneHeader = rows.indexOf('Assistant')
    expect(rows[turnOneHeader + 1]).toBe('late turn-one text')
    await dispose(result)
  })

  it('folds live hidden-mode streaming once a later step shows text', async () => {
    const result = await setup({ tools, status: 'running' })
    result.terminal.send('\x0f')
    result.terminal.send('\x0f')
    await tick()
    result.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'live first' } })
    result.session.append('step/end', { turn: 1, step: 1 })
    result.session.append('step/start', { turn: 1, step: 2 })
    result.session.append('assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'live second' } })
    await tick()
    result.terminal.send('\x0c')
    await tick()
    const hidden = lastFrame(result.terminal)
    expect(countAssistantHeaders(hidden)).toBe(1)
    expect(hidden).toContain('live first')
    expect(hidden).toContain('live second')

    // A transcript rebuild (resize) recomputes the same fold from the log.
    result.terminal.resize(89)
    await tick()
    const rebuilt = lastFrame(result.terminal)
    expect(countAssistantHeaders(rebuilt)).toBe(1)
    expect(rebuilt).toContain('live second')
    await dispose(result)
  })
})

describe('TUI user-interaction dialogs', () => {
  it('limits the visible option window to maxQuestionOptions', async () => {
    const result = await setup({
      config: { maxQuestionOptions: 1, questionDialogWidth: 60, questionDialogMaxHeight: 20 },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'cap',
        question: 'Pick one',
        options: [{ label: 'Visible first' }, { label: 'Hidden second' }],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('Visible first')
    expect(result.terminal.output).not.toContain('Hidden second')
    expect(result.terminal.output).toContain('↓ 1 more')
    result.terminal.send('\x03')
    await rejected

    await dispose(result)
  })

  it('renders a pending question between the transcript and editor', async () => {
    const result = await setup({
      config: { questionDialogWidth: 40, questionDialogMaxHeight: 10 },
    })
    result.terminal.send('draft input')
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'placement',
        question: 'Pick one',
        options: [{ label: 'First' }, { label: 'Second' }],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.resize(60, 20)
    await tick()
    const render = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    const questionIndex = render.indexOf('Pick one')
    const editorIndex = render.indexOf('draft input')
    expect(questionIndex).toBeGreaterThanOrEqual(0)
    expect(editorIndex).toBeGreaterThan(questionIndex)
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('answers single-select, multi-select, custom, and optionless questions', async () => {
    const result = await setup({ config: { maxQuestionOptions: 1 } })

    const single = result.ctx.userQuestions.ask({
      questions: [{
        id: 'mode', header: 'Mode', question: 'Choose a mode', detail: 'This choice controls the next turn.',
        options: [{ label: 'Safe', description: 'Use checks' }, { label: 'Fast' }],
      }],
    })
    await tick()
    expect(result.terminal.output).toContain('Choose a mode')
    expect(result.terminal.output).toContain('This choice controls the next turn.')
    expect(result.terminal.output).toContain('Question 1/1 (1 unanswered) · Mode')
    expect(result.terminal.output).toContain('1/2')
    result.terminal.send('\x1b[B')
    result.terminal.send('\r')
    await expect(single).resolves.toEqual({ answers: [{ id: 'mode', selected: ['Fast'] }] })

    const multi = result.ctx.userQuestions.ask({
      questions: [{ id: 'targets', question: 'Pick targets', multiSelect: true, options: [{ label: 'Code' }, { label: 'Docs' }] }],
    })
    await tick()
    result.terminal.send(' ')
    result.terminal.send('\x1b[B')
    result.terminal.send(' ')
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output).toContain('2 selected • Enter submit • Esc options')
    result.terminal.send('Tests')
    result.terminal.send('\r')
    await expect(multi).resolves.toEqual({
      answers: [{ id: 'targets', selected: ['Code', 'Docs'], custom: 'Tests' }],
    })

    const labelsOnly = result.ctx.userQuestions.ask({
      questions: [{
        id: 'labels-only',
        question: 'Pick one target',
        multiSelect: true,
        options: [{ label: 'Code' }, { label: 'Docs' }],
      }],
    })
    await tick()
    result.terminal.send(' ')
    result.terminal.send('\r')
    await expect(labelsOnly).resolves.toEqual({
      answers: [{ id: 'labels-only', selected: ['Code'] }],
    })

    const custom = result.ctx.userQuestions.ask({
      questions: [{ id: 'other', question: 'Choose or type', options: [{ label: 'Default' }] }],
    })
    await tick()
    const singleOptionRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('Choose or type'))
    expect(singleOptionRender).not.toContain('↑/↓ navigate')
    result.terminal.send('\t')
    result.terminal.send('my choice')
    result.terminal.send('\r')
    await expect(custom).resolves.toEqual({ answers: [{ id: 'other', selected: [], custom: 'my choice' }] })

    const free = result.ctx.userQuestions.ask({ questions: [{ id: 'note', question: 'Add a note' }] })
    await tick()
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Enter an answer before submitting')
    result.terminal.send('ship it')
    result.terminal.send('\r')
    await expect(free).resolves.toEqual({ answers: [{ id: 'note', selected: [], custom: 'ship it' }] })
    await dispose(result)
  })

  it('handles option wrapping, deselection errors, and returning from custom input', async () => {
    const result = await setup({ config: { theme: { color: true } } })
    const single = result.ctx.userQuestions.ask({
      questions: [{ id: 'single', question: 'Single options', options: [{ label: 'One' }, { label: 'Two' }] }],
    })
    const singleRejected = expect(single).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('Two')
    result.terminal.send('\x03')
    await singleRejected

    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'options',
        question: 'Exercise options',
        multiSelect: true,
        options: [{ label: 'One', description: 'first' }, { label: 'Two' }],
      }],
    })
    await tick()
    result.terminal.send('\x1b[A')
    result.terminal.send('\x1b[B')
    result.terminal.send('\x1b[B')
    result.terminal.send('\x1b[A')
    result.terminal.send(' ')
    await tick()
    result.terminal.send('x')
    result.terminal.send(' ')
    result.terminal.send('\r')
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('Select at least one option')
    })
    result.terminal.send('c')
    await tick()
    result.terminal.send('keep this')
    await tick()
    expect(result.terminal.output).toContain('0 selected • Enter submit • Esc options')
    result.terminal.send('\x1b')
    await tick()
    expect(result.terminal.output).toContain('Space toggle')
    result.terminal.send(' ')
    result.terminal.send('\r')
    await expect(answer).resolves.toEqual({
      answers: [{ id: 'options', selected: ['One'], custom: 'keep this' }],
    })
    await dispose(result)
  })

  it('scrolls tall option lists with ↑/↓ overflow markers when the dialog height is capped', async () => {
    const result = await setup({
      config: {
        questionDialogWidth: 60,
        questionDialogMaxHeight: 12,
        maxQuestionOptions: 8,
      },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'scroll',
        question: 'Pick one',
        options: [
          { label: 'Alpha', description: 'first choice with a description that will wrap to multiple lines when the dialog is narrow' },
          { label: 'Bravo', description: 'second choice' },
          { label: 'Charlie', description: 'third choice' },
          { label: 'Delta', description: 'fourth choice' },
          { label: 'Echo', description: 'fifth choice' },
          { label: 'Foxtrot', description: 'sixth choice' },
        ],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('↓')
    expect(result.terminal.output).toContain('more')
    for (let step = 0; step < 5; step += 1) result.terminal.send('\x1b[B')
    await tick()
    expect(result.terminal.output).toContain('↑')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('keeps controls visible when the selected option block exceeds the row budget', async () => {
    const result = await setup({
      config: { questionDialogWidth: 40, questionDialogMaxHeight: 10 },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'oversize',
        question: 'Pick one',
        options: [
          { label: 'Huge', description: `start ${'middle '.repeat(40)}visible tail` },
          { label: 'Other' },
        ],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('Huge')
    expect(result.terminal.output).toContain('PgUp/PgDn')
    expect(result.terminal.output).toContain('↑↓ Tab ↵ Esc')
    expect(result.terminal.output).not.toContain('visible tail')
    for (let page = 0; page < 30; page += 1) result.terminal.send('\x1b[6~')
    await tick()
    expect(result.terminal.output).toContain('visible tail')
    for (let page = 0; page < 30; page += 1) result.terminal.send('\x1b[5~')
    result.terminal.send('\x1b[6~')
    await tick()
    expect(result.terminal.output).toContain('start middle')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('pages long question detail so every plan-review line remains reachable', async () => {
    const result = await setup({
      config: { questionDialogWidth: 20, questionDialogMaxHeight: 10 },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'long-detail',
        question: 'Approve this plan?',
        detail: `visible start ${'review step '.repeat(60)}visible tail`,
        options: [{ label: 'Approve' }, { label: 'Reject' }],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.resize(60, 20)
    await tick()
    const initialRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(initialRender).toContain('plan?')
    expect(initialRender).toContain('visible start')
    expect(initialRender).not.toContain('visible tail')
    expect(initialRender).toMatch(/PgUp\/PgDn \d+\/\d+/u)
    for (let page = 0; page < 30; page += 1) result.terminal.send('\x1b[6~')
    await tick()
    const finalRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(finalRender).toContain('visible tail')
    expect(finalRender).toContain('Approve')
    result.terminal.send('\x1b[B')
    await tick()
    const movedRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(movedRender).toContain('visible tail')
    expect(movedRender).toContain('Reject')
    result.terminal.send('\x1b[A')
    result.terminal.send('\t')
    await tick()
    result.terminal.send('\x1b[6~')
    await tick()
    result.terminal.send('\x1b[5~')
    result.terminal.resize(61, 20)
    await tick()
    const customPagedRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(customPagedRender).not.toContain('visible tail')
    expect(customPagedRender).toContain('Esc options')
    result.terminal.send('\x1b')
    for (let page = 0; page < 30; page += 1) result.terminal.send('\x1b[5~')
    await tick()
    const restoredRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(restoredRender).toContain('visible start')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('reclaims enough rows to keep selected content, paging, and option markers visible', async () => {
    const result = await setup({
      config: { questionDialogWidth: 60, questionDialogMaxHeight: 8 },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'one-row',
        question: 'Pick one',
        options: [
          { label: 'Selected first', description: `start ${'middle '.repeat(30)}visible tail` },
          { label: 'Hidden second' },
        ],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('Selected first')
    expect(result.terminal.output).not.toContain('Hidden second')
    expect(result.terminal.output).toContain('↓ 1 more')
    expect(result.terminal.output).toContain('PgUp/PgDn')
    expect(result.terminal.output).toContain('Esc interrupt')
    for (let page = 0; page < 30; page += 1) result.terminal.send('\x1b[6~')
    await tick()
    expect(result.terminal.output).toContain('visible tail')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('preserves both option markers and controls at the minimum configured height', async () => {
    const result = await setup({
      config: { questionDialogWidth: 60, questionDialogMaxHeight: 6 },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'minimum-options',
        question: 'Pick one',
        multiSelect: true,
        options: ['One', 'Two', 'Three', 'Four', 'Five'].map(label => ({
          label,
          description: `${label} ${'wrapped detail '.repeat(20)}`,
        })),
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.send('\x1b[B')
    result.terminal.send('\x1b[B')
    await tick()
    expect(result.terminal.output).toContain('↑ 2 more')
    expect(result.terminal.output).toContain('Three')
    expect(result.terminal.output).toContain('PgUp/PgDn')
    expect(result.terminal.output).toContain('↓ 2 more')
    expect(result.terminal.output).toContain('Tab custom')
    expect(result.terminal.output).toContain('Space toggle')
    expect(result.terminal.output).toContain('Esc interrupt')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Error: Select at least one')
    result.terminal.resize(61)
    await tick()
    const validationRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(validationRender).toContain('Tab custom')
    expect(validationRender).toContain('Space toggle')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('preserves detail text and every action when one compact header row remains', async () => {
    const result = await setup({
      config: { questionDialogWidth: 20, questionDialogMaxHeight: 6 },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'one-header-row',
        question: 'Plan?',
        detail: 'abcdvisible tail',
        multiSelect: true,
        options: [
          { label: 'Yes', description: 'accept' },
          { label: 'No', description: 'reject' },
        ],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.resize(60, 20)
    await tick()
    const initialRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(initialRender).toContain('P↑↓ ↑↓ Tab S↵Esc')
    result.terminal.send('\x1b[6~')
    result.terminal.send('\x1b[6~')
    await tick()
    const detailRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(detailRender).toContain('visible tail')
    result.terminal.send('\x03')
    await rejected

    const single = result.ctx.userQuestions.ask({
      questions: [{
        id: 'one-header-row-single',
        question: 'Plan?',
        detail: 'abcdvisible tail',
        options: [
          { label: 'Yes', description: 'accept' },
          { label: 'No', description: 'reject' },
        ],
      }],
    })
    const singleRejected = expect(single).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.resize(61, 20)
    await tick()
    const singleRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(singleRender).toContain('P↑↓ ↑↓ Tab↵Esc')
    result.terminal.send('\x03')
    await singleRejected

    const compact = result.ctx.userQuestions.ask({
      questions: [{
        id: 'one-header-row-compact',
        question: 'Pick?',
        multiSelect: true,
        options: [
          { label: 'Yes', description: 'accept' },
          { label: 'No', description: 'reject' },
        ],
      }],
    })
    const compactRejected = expect(compact).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.resize(60, 20)
    await tick()
    const compactRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(compactRender).toContain('↑↓ Tab Sp ↵Esc')
    result.terminal.send('\x03')
    await compactRejected

    const oneOption = result.ctx.userQuestions.ask({
      questions: [{
        id: 'one-header-row-one-option',
        question: 'Pick?',
        detail: 'Review every line.',
        options: [{ label: 'Yes', description: 'wrapped detail '.repeat(8) }],
      }],
    })
    const oneOptionRejected = expect(oneOption).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.resize(61, 20)
    await tick()
    const oneOptionRender = result.terminal.output.slice(result.terminal.output.lastIndexOf('\x1b[2J'))
    expect(oneOptionRender).toContain('P↑↓ Tab↵Esc')
    expect(oneOptionRender).not.toContain('P↑↓ ↑↓')
    result.terminal.send('\x03')
    await oneOptionRejected
    await dispose(result)
  })

  it('expands the visible option window forward and backward around the selection', async () => {
    const result = await setup({
      config: {
        questionDialogWidth: 60,
        questionDialogMaxHeight: 14,
        maxQuestionOptions: 8,
      },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'middle-scroll',
        question: 'Pick one',
        options: [
          { label: 'One', description: 'a' },
          { label: 'Two', description: 'b' },
          { label: 'Three', description: 'c' },
          { label: 'Four', description: 'd' },
          { label: 'Five', description: 'e' },
          { label: 'Six', description: 'f' },
          { label: 'Seven', description: 'g' },
          { label: 'Eight', description: 'h' },
          { label: 'Nine', description: 'i' },
          { label: 'Ten', description: 'j' },
        ],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    for (let step = 0; step < 4; step += 1) result.terminal.send('\x1b[B')
    await tick()
    expect(result.terminal.output).toContain('↑')
    expect(result.terminal.output).toContain('↓')
    expect(result.terminal.output).toContain('Five')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('wraps a long option label across multiple lines instead of truncating it', async () => {
    const result = await setup({ config: { questionDialogWidth: 40 } })
    const longLabel = 'this is a very long option label that will not fit on one line in a narrow dialog'
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'long-label',
        question: 'Pick one',
        options: [{ label: longLabel }, { label: 'Short' }],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('narrow dialog')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('wraps fixed question chrome within the minimum dialog width', async () => {
    const result = await setup({ config: { questionDialogWidth: 20 } })
    const answer = result.ctx.userQuestions.ask({
      questions: [{ id: 'narrow', question: 'Answer?' }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).not.toContain('Question 1/1 (1 unanswered)')
    expect(result.terminal.output).toContain('unanswered)')
    expect(result.terminal.output).not.toContain('Enter submit • Esc cancel')
    expect(result.terminal.output).toContain('Esc cancel')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('keeps custom controls visible at the minimum dialog height', async () => {
    const result = await setup({
      config: { questionDialogWidth: 20, questionDialogMaxHeight: 6 },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{ id: 'short-viewport', question: 'Answer this deliberately long question?' }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('long question?')
    expect(result.terminal.output).toContain('Esc cancel')
    result.terminal.resize(60, 4)
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Enter an answer')
    expect(result.terminal.output).toContain('long question?')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('compacts custom controls for a question that also has options', async () => {
    const result = await setup({
      config: { questionDialogWidth: 20, questionDialogMaxHeight: 6 },
    })
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'compact-custom-options',
        question: 'Choose or type a deliberately long answer',
        options: [{ label: 'Default' }],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.send('\t')
    await tick()
    expect(result.terminal.output).toContain('Esc options')
    result.terminal.send('\x1b')
    await tick()
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('reports hidden question rows when the viewport leaves one row', async () => {
    const result = await setup({
      config: { questionDialogWidth: 60, questionDialogMaxHeight: 6 },
    })
    result.terminal.resize(60, 2)
    const answer = result.ctx.userQuestions.ask({
      questions: [{ id: 'one-row-dialog', question: 'Answer this deliberately long question?' }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('lines hidden')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('keeps question text when the viewport leaves two question rows', async () => {
    const result = await setup({
      config: { questionDialogWidth: 60, questionDialogMaxHeight: 6 },
    })
    result.terminal.resize(60, 3)
    const answer = result.ctx.userQuestions.ask({
      questions: [{ id: 'two-row-dialog', question: 'Answer this deliberately long question?' }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('long question?')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('bounds option mode when the viewport leaves three question rows', async () => {
    const result = await setup({
      config: { questionDialogWidth: 60, questionDialogMaxHeight: 6 },
    })
    result.terminal.resize(60, 4)
    const answer = result.ctx.userQuestions.ask({
      questions: [{
        id: 'three-row-options',
        question: 'Pick one',
        options: [{ label: 'First' }, { label: 'Second' }],
      }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    expect(result.terminal.output).toContain('lines hidden')
    result.terminal.send('\x03')
    await rejected
    await dispose(result)
  })

  it('keeps question rows within a sub-five-column viewport', async () => {
    const terminal = new HeadlessTerminal(4, 12)
    const result = await createTuiTestHarness(terminal, vi.fn(), {
      config: { questionDialogWidth: 20 },
    })
    const beforeQuestion = terminal.frames
    const answer = result.ctx.userQuestions.ask({
      questions: [{ id: 'narrow-viewport', question: 'Pick?', options: [{ label: 'Yes' }] }],
    })
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await terminal.waitForFrame(beforeQuestion)
    await expect(terminal.snapshot()).resolves.toContain('terminal 4x12')
    terminal.send('\x03')
    await rejected
    await disposeTuiTestHarness(result)
  })

  it('asks batches in order and rejects cancelled or aborted work', async () => {
    const result = await setup()
    const preAborted = new AbortController()
    preAborted.abort()
    await expect(result.ctx.userQuestions.ask({
      questions: [{ id: 'pre-aborted', question: 'Already cancelled?' }],
      signal: preAborted.signal,
    })).rejects.toMatchObject({ code: 'ASK_ABORTED' })

    const batch = result.ctx.userQuestions.ask({
      questions: [
        { id: 'first', question: 'First?', options: [{ label: 'Yes' }] },
        { id: 'second', question: 'Second?' },
      ],
    })
    await tick()
    expect(result.terminal.output).toContain('Question 1/2 (2 unanswered)')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Second?')
    expect(result.terminal.output).toContain('Question 2/2 (1 unanswered)')
    result.terminal.send('done')
    result.terminal.send('\r')
    await expect(batch).resolves.toEqual({ answers: [
      { id: 'first', selected: ['Yes'] },
      { id: 'second', selected: [], custom: 'done' },
    ] })

    const cancelled = result.ctx.userQuestions.ask({ questions: [{ id: 'cancel', question: 'Cancel?' }] })
    const cancelledExpectation = expect(cancelled).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    result.terminal.send('\x1b')
    await cancelledExpectation

    const controller = new AbortController()
    const active = result.ctx.userQuestions.ask({ questions: [{ id: 'active', question: 'Active?' }], signal: controller.signal })
    const queuedController = new AbortController()
    const queued = result.ctx.userQuestions.ask({ questions: [{ id: 'queued', question: 'Queued?' }], signal: queuedController.signal })
    const activeExpectation = expect(active).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    const queuedExpectation = expect(queued).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    queuedController.abort()
    controller.abort()
    await activeExpectation
    await queuedExpectation
    await dispose(result)
  })

  it('rejects active and queued dialogs on disposal', async () => {
    const result = await setup()
    const active = result.ctx.userQuestions.ask({ questions: [{ id: 'active', question: 'Active?' }] })
    const queued = result.ctx.userQuestions.ask({ questions: [{ id: 'queued', question: 'Queued?' }] })
    const activeExpectation = expect(active).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    const queuedExpectation = expect(queued).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await tick()
    await result.controller.dispose()
    await activeExpectation
    await queuedExpectation
    await expect(result.ctx.userQuestions.ask({ questions: [{ id: 'late', question: 'Late?' }] }))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
    await result.ctx.fiber.dispose()
  })

  it('rejects malformed questions when a dialog cannot be constructed', async () => {
    const result = await setup()
    const broken = {
      id: 'broken',
      question: 'Broken question',
      get options(): never {
        throw new Error('question setup failed')
      },
    }
    const answer = result.ctx.userQuestions.ask({ questions: [broken] })
    await expect(answer).rejects.toThrow('ask_user_question TUI failed: question setup failed')
    await tick()
    expect(result.terminal.output).toContain('TUI overlay failed: question setup failed')
    await dispose(result)
  })
})

describe('TUI extension service', () => {
  it('renders effect-owned plugin overlays in the shared FIFO and restores editor input', async () => {
    const result = await setup()
    const sessions: TuiOverlaySession[] = []
    const hosts: TuiOverlayHost[] = []
    const plugin = result.ctx.inject(['tui'], (pluginCtx) => {
      expect(pluginCtx.tui.agent).toBe(result.agent)
      for (const label of ['first', 'second']) {
        sessions.push(pluginCtx.tui.openOverlay({
          create(host) {
            hosts.push(host)
            return {
              focused: false,
              render: width => [
                host.theme.accent(`${label} plugin overlay`),
                [
                  host.theme.text('text'),
                  host.theme.brand('brand'),
                  host.theme.dim('dim'),
                  host.theme.success('success'),
                  host.theme.warning('warning'),
                  host.theme.error('error'),
                  host.theme.bold('bold'),
                ].join(' '),
                `${String(host.viewport.columns)}x${String(host.viewport.rows)} · ${String(width)}`,
              ],
              handleInput(data) {
                host.invalidate()
                if (data === label[0]) host.close()
              },
              invalidate() {},
            }
          },
          options: { width: 50, maxHeight: 8, anchor: 'center', margin: 1 },
        }))
      }
    })
    await plugin
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('first plugin overlay')
    })
    expect(sessions.map(session => session.state)).toEqual(['active', 'queued'])
    expect(hosts).toHaveLength(1)

    const question = result.ctx.userQuestions.ask({
      questions: [{ id: 'after-plugin', question: 'Question after plugins?', options: [{ label: 'Yes' }] }],
    })
    result.terminal.send('f')
    await expect(sessions[0]!.closed).resolves.toEqual({ reason: 'closed' })
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('second plugin overlay')
    })
    expect(hosts).toHaveLength(2)
    expect(sessions[1]?.state).toBe('active')

    result.terminal.send('s')
    await expect(sessions[1]!.closed).resolves.toEqual({ reason: 'closed' })
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('Question after plugins?')
    })
    result.terminal.send('\r')
    await expect(question).resolves.toEqual({
      answers: [{ id: 'after-plugin', selected: ['Yes'] }],
    })

    result.terminal.send('editor works again')
    result.terminal.send('\r')
    expect(result.agent.sent.at(-1)).toEqual([{ type: 'text', text: 'editor works again' }])
    await plugin.dispose()
    await dispose(result)
  })

  it('unloads and reloads dependent plugins with the mounted TUI', async () => {
    const result = await setup()
    const sessions: TuiOverlaySession[] = []
    const signals: AbortSignal[] = []
    let starts = 0
    const plugin = result.ctx.inject(['tui'], (pluginCtx) => {
      starts += 1
      sessions.push(pluginCtx.tui.openOverlay({
        create(host) {
          signals.push(host.signal)
          return {
            render: () => [`plugin mount ${String(starts)}`],
            invalidate() {},
          }
        },
      }))
    })
    await plugin
    await vi.waitFor(() => {
      expect(result.terminal.output).toContain('plugin mount 1')
    })

    await result.controller.dispose()
    await expect(sessions[0]!.closed).resolves.toEqual({ reason: 'owner-disposed' })
    expect(signals[0]?.aborted).toBe(true)
    expect(result.ctx.get('tui')).toBeUndefined()

    const secondTerminal = new FakeTerminal()
    const secondController = createTuiChat(result.ctx, {
      sessionId: result.agent.id,
      theme: { color: false },
      welcome: 'Mounted again.',
    }, {
      terminal: secondTerminal,
      exit: vi.fn(),
    })
    await vi.waitFor(() => {
      expect(starts).toBe(2)
      expect(secondTerminal.output).toContain('plugin mount 2')
    })
    await sessions[1]?.close()
    await secondController.dispose()
    await plugin.dispose()
    await result.ctx.fiber.dispose()
  })
})

describe('application exit', () => {
  it('disposes the root fiber rather than only the TUI child before exiting', async () => {
    const rootDispose = vi.fn(() => Promise.resolve())
    const childDispose = vi.fn(() => Promise.resolve())
    const ctx = {
      root: { fiber: { dispose: rootDispose } },
      fiber: { dispose: childDispose },
    } as unknown as Context
    const exit = vi.fn()
    disposeRootAndExit(ctx, 7, exit)
    await Promise.resolve()
    expect(rootDispose).toHaveBeenCalledOnce()
    expect(childDispose).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(7)
  })

  it('forces exit when root disposal does not settle', async () => {
    vi.useFakeTimers()
    try {
      let settle!: () => void
      const disposal = new Promise<void>((resolve) => { settle = resolve })
      const ctx = {
        root: { fiber: { dispose: () => disposal } },
      } as unknown as Context
      const exit = vi.fn()
      disposeRootAndExit(ctx, 9, exit)
      await vi.advanceTimersByTimeAsync(4_999)
      expect(exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(exit).toHaveBeenCalledOnce()
      expect(exit).toHaveBeenCalledWith(9)
      settle()
      await disposal
      await Promise.resolve()
      expect(exit).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('exits after a rejected root disposal without an unhandled rejection', async () => {
    const ctx = {
      root: { fiber: { dispose: () => Promise.reject(new Error('cleanup failed')) } },
    } as unknown as Context
    const exit = vi.fn()
    disposeRootAndExit(ctx, 5, exit)
    await Promise.resolve()
    await Promise.resolve()
    expect(exit).toHaveBeenCalledWith(5)
  })
})

describe('terminal mounting', () => {
  it('enters the alternate screen before terminal start and restores it after pi-tui stops', async () => {
    const result = await setup({ config: { fullscreen: true, mouse: true } })
    await tick()
    const enter = result.terminal.output.indexOf('\x1b[?1049h')
    const mouse = result.terminal.output.indexOf('\x1b[?1000h')
    const rawStart = result.terminal.output.indexOf('[hide]')
    const firstFrame = result.terminal.output.indexOf('\x1b[?2026h')
    expect(enter).toBeGreaterThanOrEqual(0)
    expect(mouse).toBeGreaterThan(enter)
    expect(rawStart).toBeGreaterThan(mouse)
    expect(firstFrame).toBeGreaterThan(rawStart)

    await result.controller.dispose()
    const piStopped = result.terminal.output.lastIndexOf('[show]')
    const mouseRestored = result.terminal.output.lastIndexOf('\x1b[?1006l')
    const screenRestored = result.terminal.output.lastIndexOf('\x1b[?1049l')
    expect(mouseRestored).toBeGreaterThan(piStopped)
    expect(screenRestored).toBeGreaterThan(mouseRestored)
    await result.ctx.fiber.dispose()
  })

  it('starts immediately when the configured agent already exists', async () => {
    const ctx = new Context()
    provideTokenMeter(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandService)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(TuiPromptService)
    ctx.provide('tools', { get: () => undefined } as never)
    const session = ctx.sessions.create(SessionId('main'))
    registerMountAgent(ctx, session, 'idle')
    const terminal = new FakeTerminal()
    mountTui(ctx, { theme: { color: false } }, { terminal, exit: vi.fn() })
    await tick()
    expect(terminal.started).toBe(1)
    await ctx.fiber.dispose()
  })

  it('degrades /reload to a warning when mounted as a real plugin without a Loader', async () => {
    // Production shape: the TUI runs inside a plugin fiber, where a bare
    // `ctx.loader` proxy read would THROW `cannot get property without
    // inject` — only the non-throwing `ctx.get` lookup degrades gracefully.
    const ctx = new Context()
    provideTokenMeter(ctx)
    provideLlmCatalog(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandService)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(TuiPromptService)
    ctx.provide('tools', { get: () => undefined } as never)
    const session = ctx.sessions.create(SessionId('main'))
    registerMountAgent(ctx, session, 'idle')
    const terminal = new FakeTerminal()
    // Mirror dsh-tui's own inject (minus loader, the absence under test).
    await ctx.plugin({
      inject: ['agents', 'commands', 'userQuestions', 'tools', 'llm', 'tokenMeter', 'tuiPrompt'],
      apply: (pluginCtx: Context) => {
        mountTui(pluginCtx, { theme: { color: false } }, { terminal, exit: vi.fn() })
      },
    })
    await tick()
    expect(terminal.started).toBe(1)
    terminal.send('/reload')
    terminal.send('\r')
    await tick()
    expect(terminal.output).toContain('/reload needs the cordis Loader')
    await ctx.fiber.dispose()
  })

  it('waits for its configured agent before starting the TUI', async () => {
    const ctx = new Context()
    provideTokenMeter(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandService)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(TuiPromptService)
    ctx.provide('tools', { get: () => undefined } as never)
    const terminal = new FakeTerminal()
    mountTui(ctx, { sessionId: 'late-session', theme: { color: false } }, { terminal, exit: vi.fn() })
    expect(terminal.started).toBe(0)

    const otherSession = ctx.sessions.create(SessionId('other-session'))
    registerMountAgent(ctx, otherSession, 'idle')
    expect(terminal.started).toBe(0)

    const session = ctx.sessions.create(SessionId('late-session'))
    registerMountAgent(ctx, session, 'idle')
    await tick()
    expect(terminal.started).toBe(1)
    await ctx.fiber.dispose()
  })

  it('prints a matching live startup failure and exits instead of waiting forever', async () => {
    const ctx = new Context()
    provideTokenMeter(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandService)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(TuiPromptService)
    ctx.provide('tools', { get: () => undefined } as never)
    const terminal = new FakeTerminal()
    const exit = vi.fn()
    mountTui(ctx, { sessionId: 'main-session', theme: { color: false } }, { terminal, exit })

    ctx.emit('agent-loop/config-start-failed', {
      sessionId: SessionId('other-session'), error: new Error('other failed'),
    })
    expect(terminal.output).toBe('')
    expect(exit).not.toHaveBeenCalled()
    ctx.emit('agent-loop/config-start-failed', {
      sessionId: SessionId('main-session'), error: new Error('resume \u001b]2;failure-controlled\u0007'),
    })
    expect(terminal.output).toBe('ui-tui: session "main-session" failed to start: resume \\x1b]2;failure-controlled\\x07\n')
    expect(exit).toHaveBeenCalledWith(1)

    const session = ctx.sessions.create(SessionId('main-session'))
    registerMountAgent(ctx, session, 'idle')
    await tick()
    expect(terminal.started).toBe(0)
    await ctx.fiber.dispose()
  })

  it('renders an uncoercible startup failure without escaping the display boundary', async () => {
    const ctx = new Context()
    provideTokenMeter(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandService)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(TuiPromptService)
    ctx.provide('tools', { get: () => undefined } as never)
    const terminal = new FakeTerminal()
    const exit = vi.fn()

    mountTui(ctx, { sessionId: 'main-session', theme: { color: false } }, { terminal, exit })
    ctx.emit('agent-loop/config-start-failed', {
      sessionId: SessionId('main-session'),
      error: { toString(): string { throw new Error('coercion failed') } },
    })

    expect(terminal.started).toBe(0)
    expect(terminal.output).toBe('ui-tui: session "main-session" failed to start: <unrenderable value>\n')
    expect(exit).toHaveBeenCalledWith(1)
    await ctx.fiber.dispose()
  })

  it('rolls back providers, listeners, and terminal state when startup fails', async () => {
    const ctx = new Context()
    provideTokenMeter(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandService)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(TuiPromptService)
    ctx.provide('tools', { get: () => undefined } as never)
    const session = ctx.sessions.create(SessionId('failed-start-session'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    registerMountAgent(ctx, session, 'running')
    const terminal = new FakeTerminal()
    terminal.start = () => { throw new Error('terminal startup failed') }

    expect(() => createTuiChat(ctx, { sessionId: 'failed-start-session', theme: { color: false } }, { terminal, exit: vi.fn() }))
      .toThrow('terminal startup failed')
    await tick()
    expect(ctx.commands.list(ctx.agents.get(SessionId('failed-start-session'))!)).toEqual([])
    expect(terminal.stopped).toBe(1)
    expect(terminal.output).toContain('\x1b[?1049h')
    expect(terminal.output).toContain('\x1b[?1000h')
    expect(terminal.output).toContain('\x1b[?1006l')
    expect(terminal.output).toContain('\x1b[?1049l')
    expect(terminal.progress).toEqual([false, true, false])
    expect(ctx.get('tui')).toBeUndefined()
    await expect(ctx.userQuestions.ask({ questions: [{ id: 'late', question: 'Late?' }] }))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'must not render' },
    })
    await tick()
    expect(terminal.output).not.toContain('must not render')
    await ctx.fiber.dispose()
  })

  it('throws when createTuiChat is called without the configured agent', async () => {
    const ctx = new Context()
    provideTokenMeter(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(CommandService)
    await ctx.plugin(UserInteractionService)
    await ctx.plugin(TuiPromptService)
    ctx.provide('tools', { get: () => undefined } as never)
    const runtime: TuiRuntime = { terminal: new FakeTerminal(), exit: vi.fn() }
    expect(() => createTuiChat(ctx, { sessionId: 'missing' }, runtime)).toThrow('is not running')
    await ctx.fiber.dispose()
  })

  it('prints every palette role through /palette, each painted by the code it reports', async () => {
    const result = await setup({ config: { theme: { color: true } } })
    const before = result.terminal.output.length
    result.terminal.send('/palette')
    result.terminal.send('\r')
    await tick()
    const printed = result.terminal.output.slice(before)

    // Every declared role appears with its purpose, so a role added to the spec
    // without a listing entry (or the reverse) fails here rather than silently
    // going unlisted.
    const spec = paletteSpec('dark')
    for (const name of COLOR_ROLES) {
      expect(printed).toContain(name)
      expect(printed).toContain(spec.colors[name].purpose)
    }
    for (const name of ATTRIBUTE_ROLES) {
      expect(printed).toContain(name)
      expect(printed).toContain(spec.attributes[name].purpose)
    }

    // Each row is painted by the role it names, so the listing cannot report one
    // code while rendering another: the sample carries the spec's own open code.
    expect(printed).toContain(`\x1b[${spec.colors.accent.open}m`)
    expect(printed).toContain(`\x1b[${spec.colors.dim.open}m`)
    expect(printed).toContain(`\x1b[${spec.attributes.selected.open}m`)
    // `text` is the terminal default, emitted as no escape at all.
    expect(printed).toContain('no escape')
    await dispose(result)
  })

  it('uses the official DeepSeek SVG ink for truecolor brand art', () => {
    expect(brandText('mark')).toBe('\x1b[38;2;77;107;254mmark\x1b[39m')
  })

  it('uses semantic palette roles for diff and patch fences', () => {
    const palette = createPalette(true)
    const source = [
      'diff --git a/a.ts b/a.ts',
      'index 111..222 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-const oldValue = true',
      '+const ready = true',
      ' const kept = true',
      '',
    ].join('\n')
    const rendered = highlightMarkdownCode(source, 'diff', palette)
    expect(rendered).toEqual([
      palette.dim('diff --git a/a.ts b/a.ts'),
      palette.dim('index 111..222 100644'),
      palette.dim('--- a/a.ts'),
      palette.dim('+++ b/a.ts'),
      palette.accent('@@ -1 +1 @@'),
      palette.error('-const oldValue = true'),
      palette.success('+const ready = true'),
      palette.code(' const kept = true'),
      '',
    ])
    expect(highlightMarkdownCode('+ready', 'PATCH title=change', palette))
      .toEqual([palette.success('+ready')])
    expect(highlightMarkdownCode('const ready = true', 'ts', palette))
      .toEqual([palette.code('const ready = true')])
    expect(highlightMarkdownCode('plain', undefined, palette))
      .toEqual([palette.code('plain')])
  })

  it('detects a light terminal color scheme and switches the scheme-dependent code role', async () => {
    const result = await setup({ config: { theme: { color: true } } })
    // `dim` is scheme-independent (SGR 2 over the default foreground), so the
    // startup render carries it on both schemes; `code` is the role that varies.
    expect(result.terminal.output).toContain('\x1b[2;39mdeepseek-v4-flash')

    // A report matching the current scheme is a no-op: no palette rebuild or
    // re-render (ESC [?997;1n = dark, the startup default).
    const beforeSameScheme = result.terminal.output.length
    result.terminal.send('\x1b[?997;1n')
    await tick()
    expect(result.terminal.output.length).toBe(beforeSameScheme)

    // Simulate the terminal responding with a light color scheme report
    // (ESC [?997;2n = light, ESC [?997;1n = dark).
    result.terminal.send('\x1b[?997;2n')
    await tick()
    await tick()
    // The rebuild re-renders under the light palette, where `code` is ANSI 34
    // (blue) rather than the dark scheme's ANSI 36 (cyan); `dim` is unchanged.
    expect(result.terminal.output).toContain('\x1b[2;39mdeepseek-v4-flash')

    result.terminal.send('\x1b[?997;1n')
    await tick()
    await tick()
    expect(result.terminal.output).toContain('\x1b[2;39mdeepseek-v4-flash')
    await dispose(result)
  })

  it('keeps the dark palette when the terminal rejects the color-scheme query', async () => {
    class QueryFailTerminal extends FakeTerminal {
      override write(data: string): void {
        // The device-status query is the only write that fails; the promise
        // rejects and the swallowed `.catch` leaves the dark palette in place.
        if (data === '\x1b[?996n') throw new Error('query write failed')
        super.write(data)
      }
    }
    const terminal = new QueryFailTerminal()
    // Anchor cwd under $HOME so the prompt renders the `~/` abbreviation
    // deterministically; process.cwd() is not guaranteed under $HOME in CI.
    const result = await createTuiTestHarness(terminal, vi.fn(), {
      config: { theme: { color: true } },
      cwd: join(homedir(), 'projects', 'dsh-tui'),
    })
    await tick()
    expect(terminal.output).toContain('\x1b[95m~/')
    expect(terminal.output).toContain('\x1b[2;39m (tui-staging)')
    await disposeTuiTestHarness(result)
  })
  it('runs /reload against every file-backed loader subtree, reports completion, and rejects re-entry while in flight', async () => {
    const refreshed: string[] = []
    let releaseRefresh!: () => void
    const gate = new Promise<void>((resolve) => { releaseRefresh = resolve })
    const result = await setup({
      configureContext: async (ctx) => {
        ctx.provide('tools', { get: () => undefined } as never)
        // A structural Loader: two file-backed subtrees and one plain entry.
        // The first subtree blocks on a gate so re-entry can be probed
        // deterministically mid-flight.
        ctx.provide('loader', {
          entries: () => [
            { subtree: { refresh: async () => { refreshed.push('root'); await gate } } },
            {},
            { subtree: { refresh: async () => { refreshed.push('nested') } } },
          ],
        } as never)
      },
    })
    result.terminal.send('/reload')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Reloading 2 config tree(s)')
    // Second /reload while the first is gated: refused, no extra refreshes.
    result.terminal.send('/reload')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('A config reload is already running.')
    expect(refreshed.sort()).toEqual(['nested', 'root'])
    releaseRefresh()
    await tick()
    expect(result.terminal.output).toContain('Config reload complete.')
    // The guard released: a third /reload runs again.
    result.terminal.send('/reload')
    result.terminal.send('\r')
    await tick()
    expect(refreshed).toHaveLength(4)
    await dispose(result)
  })

  it('reports a /reload failure if a refresh ever rejects', async () => {
    const result = await setup({
      configureContext: async (ctx) => {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('loader', {
          entries: () => [{ subtree: { refresh: () => Promise.reject(new Error('disk gone')) } }],
        } as never)
      },
    })
    result.terminal.send('/reload')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('Config reload failed: disk gone')
    // The failure arm also releases the re-entrancy guard.
    result.terminal.send('/reload')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).not.toContain('A config reload is already running.')
    await dispose(result)
  })

  it('refuses /reload while the agent is running and allows it back at idle', async () => {
    const refreshed: string[] = []
    const result = await setup({
      status: 'running',
      configureContext: async (ctx) => {
        ctx.provide('tools', { get: () => undefined } as never)
        ctx.provide('loader', {
          entries: () => [{ subtree: { refresh: async () => { refreshed.push('tree') } } }],
        } as never)
      },
    })
    result.terminal.send('/reload')
    result.terminal.send('\r')
    await tick()
    expect(result.terminal.output).toContain('/reload requires an idle agent (status: running).')
    expect(refreshed).toHaveLength(0)
    // Back at idle the same command runs.
    result.agent.status = 'idle'
    result.terminal.send('/reload')
    result.terminal.send('\r')
    await tick()
    expect(refreshed).toHaveLength(1)
    expect(result.terminal.output).toContain('Config reload complete.')
    await dispose(result)
  })

})

describe('banner sweep reveal', () => {
  it('renders the product name through the brand-gradient path when truecolor is enabled', async () => {
    // The product name carries a per-letter 24-bit gradient from the brand
    // indigo to light blue; the per-letter layout is pinned by the
    // `banner-gradient` terminal snapshot.
    const result = await setup({ config: { theme: { color: true, truecolor: true } } })
    expect(result.terminal.output).toContain('\x1b[38;2;77;107;254m')
    expect(result.terminal.output).toContain('\x1b[38;2;36;152;255m')
    expect(result.terminal.output).toContain('HARNESS')
    await dispose(result)
  })

  it('sweeps the compact banner in when no welcome is configured, ending complete', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const cleared = vi.spyOn(globalThis, 'clearInterval')
    const result = await setup({ omitWelcome: true })
    const revealHandle = intervals.mock.results.at(-1)?.value as ReturnType<typeof setInterval>
    // Run the sweep to natural completion — it clears its own timer at the end.
    const done = (): boolean => cleared.mock.calls.some(call => call[0] === revealHandle)
    const deadline = Date.now() + 5000
    while (!done() && Date.now() < deadline) await tick()
    intervals.mockRestore()
    cleared.mockRestore()
    // The finished banner carries the title and the model • session detail.
    expect(result.terminal.output).toContain('DEEPSEEK')
    expect(result.terminal.output).toContain('HARNESS')
    expect(result.terminal.output).toContain('main-session')
    // The input frame is independent of the compact, borderless banner.
    expect(result.terminal.output).toContain('╭ Message ')
    // A mid-sweep frame rendered a clipped title: `DEEPSEEK` with no `HARNESS`
    // on the same line.
    const clipped = result.terminal.output
      .split('\n')
      .some(line => line.includes('DEEPSEEK') && !line.includes('HARNESS'))
    expect(clipped).toBe(true)
    await dispose(result)
  })

  it('renders a configured welcome verbatim in a complete banner with no sweep', async () => {
    const result = await setup()
    await tick()
    expect(result.terminal.output).toContain('Coding agent ready.')
    expect(result.terminal.output).toContain('DEEPSEEK')
    expect(result.terminal.output).toContain('╭ Message ')
    // No reveal frames: the banner is drawn whole from the first render, so no
    // clipped-title frame ever appears.
    const clipped = result.terminal.output
      .split('\n')
      .some(line => line.includes('DEEPSEEK') && !line.includes('HARNESS'))
    expect(clipped).toBe(false)
    await dispose(result)
  })

  it('omits the subtitle line entirely when no welcome is configured', async () => {
    const result = await setup({ omitWelcome: true })
    const deadline = Date.now() + 5000
    while (!result.terminal.output.includes('main-session') && Date.now() < deadline) await tick()
    // Banner is title + detail only — no subtitle between them.
    expect(result.terminal.output).toContain('deepseek-v4-flash')
    expect(result.terminal.output).not.toContain('ready.')
    await dispose(result)
  })

  it('stops a mid-sweep animation on dispose', async () => {
    // The output-stability probe alone is insensitive to a leaked interval
    // (pi-tui's stopped guard silences post-stop renders), so capture the
    // reveal's own interval handle and assert dispose clears exactly it.
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const result = await setup({ omitWelcome: true })
    const revealHandle = intervals.mock.results.at(-1)?.value as ReturnType<typeof setInterval>
    expect(revealHandle).toBeDefined()
    const cleared = vi.spyOn(globalThis, 'clearInterval')
    await dispose(result)
    expect(cleared.mock.calls.some(call => call[0] === revealHandle)).toBe(true)
    intervals.mockRestore()
    cleared.mockRestore()
    const settled = result.terminal.output.length
    await tick()
    await tick()
    expect(result.terminal.output.length).toBe(settled)
  })
})
