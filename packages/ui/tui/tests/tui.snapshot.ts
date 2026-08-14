import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import DynamicCordisRunner from '@deepseek-ai/dsh-cordis-host-runner'
import { compactCheckpointSource, CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, CallId, type ContentBlock , createMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { SessionId, type JsonValue, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionReferenceResolver from '@deepseek-ai/dsh-session-reference'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition, type ToolResultView } from '@deepseek-ai/dsh-tools'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import * as ToolCordis from '@deepseek-ai/dsh-tool-cordis'
import * as ToolWorkflow from '@deepseek-ai/dsh-tool-workflow'
import {
  appendAssistant,
  appendUser,
  createTuiTestHarness,
  disposeTuiTestHarness,
  type TuiHarness,
  type TuiHarnessOptions,
} from './harness.ts'
import { HeadlessTerminal, type TerminalSnapshotOptions } from './headless-terminal.ts'
import { TestSessionQueryService } from './session-query.ts'

const SNAPSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const COMPACT_CHECKPOINT_SOURCE = compactCheckpointSource(CompactionId('tui-snapshot-compaction'))
const REFRESHING = process.env.DSH_SNAPSHOT === 'refresh'

const CHECKPOINTS = [
  'conversation-streaming',
  'rich-markdown',
  'shell-prompt-multiline',
  'step-timing-completed',
  'session-stats-completed',
  'session-stats-running',
  'session-stats-narrow',
  'retry-scheduled',
  'retry-recovered',
  'retry-cancelled',
  'retry-exhausted',
  'welcome-dashboard',
  'banner-gradient',
  'file-autocomplete',
  'session-title-autocomplete',
  'code-mode-pending',
  'dynamic-workflow-pending',
  'cordis-tools-pending',
  'advanced-cards-collapsed',
  'advanced-cards-expanded',
  'tool-cards-hidden-folded',
  'details-command',
  'details-selector',
  'untrusted-controls',
  'question-dialog',
  'question-dialog-detail-paged',
  'question-dialog-paged',
  'question-dialog-single-option',
  'question-dialog-validation',
  'surface-before-compaction',
  'surface-after-compaction-narrow',
  'surface-after-compaction-wide',
  'surface-replayed-compaction',
  'model-selector',
  'model-selector-filtered',
  'model-switching',
  'permissions-selector',
  'permissions-switching',
  'skills-selector',
  'keymap-selector',
  'vim-normal-mode',
  'fast-route-switching',
  'experimental-selector',
  'ide-context-selector',
  'approve-empty',
  'yolo-permission',
  'settings-hub',
  'theme-selector',
  'workspace-selector',
  'workspace-handoff-recovered',
  'errors-and-help',
  'disposed-terminal',
  'resume-sessions-loading',
  'resume-sessions',
  'resume-sessions-all-workspaces',
  'status-diagnostics',
  'status-diagnostics-narrow',
  'todo-plan-cleared',
] as const

// Real-loop scenarios own their assertions in separate snapshot suites but
// share this directory, whose inventory remains exact.
const STANDALONE_CHECKPOINTS = ['session-reference'] as const

type Checkpoint = typeof CHECKPOINTS[number]
type SnapshotHarness = TuiHarness<HeadlessTerminal, (code: number) => void>

const observedCheckpoints = new Set<Checkpoint>()

async function checkpoint(
  name: Checkpoint,
  terminal: HeadlessTerminal,
  options: TerminalSnapshotOptions = {},
  bannerGradient = false,
): Promise<void> {
  observedCheckpoints.add(name)
  const violations = terminal.themeViolations()
  if (bannerGradient) {
    // The banner paints its product name in the DeepSeek brand gradient with
    // 24-bit foreground codes: the sole sanctioned truecolor. Require it to be
    // present and to never leak a background or extended-palette color into the
    // otherwise theme-agnostic UI.
    expect(violations, `${name} must render the banner gradient`).not.toEqual([])
    expect(
      violations.every(entry => entry.endsWith('rgb-fg')),
      `${name} must confine truecolor to the banner foreground`,
    ).toBe(true)
  } else {
    expect(violations, `${name} must remain theme-agnostic`).toEqual([])
  }
  const snapshot = await terminal.snapshot(options)
  const path = join(SNAPSHOTS_DIR, `${name}.expected.txt`)
  if (REFRESHING) {
    await mkdir(SNAPSHOTS_DIR, { recursive: true })
    await writeFile(path, snapshot)
  }
  await expect(snapshot).toMatchFileSnapshot(path)
}

async function setupSnapshot(
  options: TuiHarnessOptions = {},
  size: { columns?: number; rows?: number } = {},
): Promise<SnapshotHarness> {
  const terminal = new HeadlessTerminal(size.columns ?? 96, size.rows ?? 36)
  const before = terminal.frames
  const result = await createTuiTestHarness(terminal, () => {}, {
    ...options,
    cwd: options.cwd === undefined ? '/workspace/project' : options.cwd,
    config: Object.assign({
      welcome: 'Snapshot agent ready.',
      theme: { color: true },
      title: 'DSH snapshot',
    }, options.config),
  })
  await terminal.waitForFrame(before)
  return result
}

async function renderAfter(harness: SnapshotHarness, action: () => void): Promise<void> {
  const before = harness.terminal.frames
  action()
  await harness.terminal.waitForFrame(before)
}

async function disposeSnapshot(harness: SnapshotHarness): Promise<void> {
  await disposeTuiTestHarness(harness)
  await harness.terminal.dispose()
}

/** Complete inert workspace entity for terminal-state fixtures. */
function snapshotWorkspace(id: string, path: string, title: string): Workspace {
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
    status: () => Promise.resolve('ok'),
  }
}

async function configureAdvancedTools(ctx: Context): Promise<void> {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry, { mode: 'code' })
  ctx.provide('workflowEngine', { start() {} } as never)
  await ctx.plugin(ToolWorkflow, { toolName: 'workflow', maxResultChars: 50_000 })
  await ctx.plugin(DynamicCordisRunner, { vmTimeoutMs: 5_000 })
  await ctx.plugin(ToolCordis)
}

async function configurePermissionPresets(ctx: Context): Promise<void> {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('permission snapshot does not execute shell commands') },
    run() { throw new Error('permission snapshot does not execute shell commands') },
    start() { throw new Error('permission snapshot does not execute shell commands') },
  })
  await ctx.plugin(PermissionPresetService, {
    presets: {
      'read-only': {
        sandbox: 'read-only',
        approval: 'ask',
        name: 'Ask for approval',
        description: 'Read files by default; changes and wider actions require approval.',
      },
      'workspace-write': {
        sandbox: 'workspace-write',
        approval: 'ask',
        name: 'Approve for me',
        description: 'Read and edit in the workspace; only wider actions require approval.',
      },
      'danger-full-access': {
        sandbox: 'danger-full-access',
        approval: 'never',
        name: 'Full access',
        description: 'Edit outside the workspace and access the network without approval prompts.',
      },
    },
    defaultPreset: 'workspace-write',
  })
}

async function configureSnapshotSkills(ctx: Context): Promise<void> {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SkillRegistry)
  ctx.skills.register({
    name: 'browser-workflow',
    description: 'Inspect a browser-driven workflow',
    source: 'bundled',
    content: 'Use the browser workflow.',
  })
  ctx.skills.register({
    name: 'document-review',
    description: 'Review and edit a document artifact',
    source: 'runtime',
    content: 'Review the document.',
  })
}

interface ToolCallFixture {
  id: string
  name: string
  arguments: unknown
}

function appendToolCalls(session: Session, calls: readonly ToolCallFixture[]): void {
  appendAssistant(session, calls.map(call => ({
    type: 'tool-call',
    id: CallId(call.id),
    name: call.name,
    arguments: JSON.stringify(call.arguments),
  })))
  for (const call of calls) {
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId(call.id),
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    })
  }
}

function appendToolResult(
  session: Session,
  id: string,
  content: ContentBlock[],
  options: { isError?: boolean; meta?: JsonValue } = {},
): void {
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId(id),
      content,
      isError: options.isError ?? false,
    }),
    ...options.meta === undefined ? {} : { meta: options.meta },
  }, { surfaceOp: 'append' })
}

/** Frozen clock for the compaction fixtures; see the live scenario for why. */
const COMPACTION_FIXTURE_TIME = new Date(2026, 6, 21, 14, 40, 0).getTime()

/** The surface range a compaction checkpoint replaces, with its provenance. */
interface CompactionRange {
  start: number
  end: number
  sources: number[]
}

/**
 * Append one prompt / tool-call / tool-result step, the history a compaction
 * shadows on the model surface and the transcript must keep showing. The prompt
 * text is rendered verbatim; the tool card's body comes from `bash`'s static
 * presenter, so the fixtures pin that the shadowed step's card survives rather
 * than the result content below.
 */
function appendPreCompactionLog(session: Session): CompactionRange {
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Old prompt with a long line that exercises wrapping and stays visible after compaction.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const assistant = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: CallId('old-tool'), name: 'bash', arguments: '{}' }],
      source: {
        kind: 'model',
        ...{ provider: 'mock', model: 'deepseek-v4-flash' },
      },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId: CallId('old-tool'), name: 'bash', arguments: '{}' })
  const result = session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId('old-tool'),
      content: [{ type: 'text', text: 'shadowed step tool output' }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  return { start: user.seq, end: result.seq, sources: [user.seq, assistant.seq, result.seq] }
}

/** Land a compaction: replace the range with the framed model-only checkpoint. */
function appendCompactionCheckpoint(session: Session, range: CompactionRange): void {
  session.append('user/message', createUserMessage({
    content: [{
      type: 'text',
      text: '<context_checkpoint>\nModel-only summary payload that must never reach the transcript.\n</context_checkpoint>',
    }],
    source: COMPACT_CHECKPOINT_SOURCE,
  }), {
    surfaceOp: { op: 'replace', start: range.start, end: range.end },
    sourceEventSeqs: range.sources,
  })
}

function visualTool(
  name: string,
  call: NonNullable<ToolDefinition['presentCall']>,
  result?: NonNullable<ToolDefinition['presentResult']>,
): ToolDefinition {
  return {
    name,
    description: `${name} snapshot fixture`,
    parameters: {},
    output: { schema: { type: 'null' }, render: () => [] },
    execute: () => Promise.resolve([]),
    presentCall: call,
    ...result === undefined ? {} : { presentResult: result },
  }
}

const ADVANCED_CARD_TOOLS: Record<string, ToolDefinition> = {
  bash: visualTool(
    'bash',
    () => ({ card: 'terminal', title: 'pnpm run test:coverage', description: 'Run the coverage gate', cwd: '/workspace/project' }),
    () => ({ card: 'terminal', output: 'packages/ui/tui 100%\n4016 tests passed\n1 test skipped\ncoverage complete', exitCode: 0 }),
  ),
  edit: visualTool(
    'edit',
    () => ({ card: 'diff', title: 'Edit src/view.ts', diffs: [{ path: 'src/view.ts', oldText: 'old line', newText: 'new line' }] }),
    // The fixed tool header never names a path, so the hunk retains its path.
    (): ToolResultView => ({
      card: 'diff',
      diffs: [{ path: 'src/view.ts', oldText: 'old line\nkeep', newText: 'new line\nkeep' }],
    }),
  ),
  large_edit: visualTool(
    'large_edit',
    () => ({
      card: 'diff',
      title: 'Edit src/large.ts',
      diffs: [{
        path: 'src/large.ts',
        oldText: 'old one\nold two\nold three',
        newText: 'new one\nnew two\nnew three',
      }],
    }),
    (): ToolResultView => ({
      card: 'diff',
      diffs: [{
        path: 'src/large.ts',
        oldText: 'old one\nold two\nold three',
        newText: 'new one\nnew two\nnew three',
      }],
    }),
  ),
  subagent: visualTool('subagent', args => ({
    card: 'generic',
    title: 'Delegate renderer audit',
    rawInput: (args as { prompt: string }).prompt,
  })),
  task_output: visualTool(
    'task_output',
    args => ({
      card: 'generic',
      kind: 'read',
      title: `Read output from background task ${(args as { task_id: string }).task_id}`,
      rawInput: (args as { task_id: string }).task_id,
    }),
    () => ({
      card: 'generic',
      content: [{ type: 'text', text: '```console\nstarted background task bash-5\n```' }],
    }),
  ),
  skill: visualTool('skill', args => ({
    card: 'generic',
    kind: 'read',
    title: `Load skill ${(args as { name: string }).name}`,
    rawInput: (args as { name: string }).name,
  })),
}

const CONTROL_PROBE = '\u001b]2;snapshot-controlled\u0007\t\u007f\u009b31m'
const DISPLAYED_CONTROL_PROBE = String.raw`\x1b]2;snapshot-controlled\x07\x09\x7f\x9b31m`

describe('TUI terminal-state snapshots', () => {
  it('pins an in-flight reasoning and Markdown stream', async () => {
    let clock = new Date(2026, 6, 21, 14, 30, 0).getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const harness = await setupSnapshot()
    await renderAfter(harness, () => {
      harness.agent.status = 'running'
      agentEvents(harness.ctx, harness.agent).emit('agent/status', { status: 'running' })
      appendUser(harness.session, 'Show the live update.')
      clock += 1_000
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
      })
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: 'Inspecting width and styles.' },
      })
      clock += 2_000
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 1, blockType: 'text' },
      })
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 1, text: 'Streaming **visible state**…\n\n```ts\nconst visible = true\n```' },
      })
    })
    await checkpoint('conversation-streaming', harness.terminal)
    await disposeSnapshot(harness)
    nowSpy.mockRestore()
  })

  it('pins rich GFM blocks and semantic diff-fence highlighting', async () => {
    const harness = await setupSnapshot({}, { columns: 96, rows: 40 })
    await renderAfter(harness, () => {
      appendUser(harness.session, 'Summarize the renderer changes.')
      appendAssistant(harness.session, [{
        type: 'text',
        text: [
          '# Renderer update',
          '',
          'The **terminal view** keeps `inline code` and ~~obsolete text~~ distinct.',
          '',
          '- [x] Render task lists',
          '- [ ] Verify the narrow layout',
          '',
          '> Diff rows use semantic terminal colors.',
          '',
          '| Surface | State |',
          '| --- | --- |',
          '| Markdown | ready |',
          '| Diff | ready |',
          '',
          '```diff',
          'diff --git a/view.ts b/view.ts',
          '--- a/view.ts',
          '+++ b/view.ts',
          '@@ -1 +1 @@',
          '-const state = "old"',
          '+const state = "ready"',
          '```',
        ].join('\n'),
      }])
    })
    await checkpoint('rich-markdown', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins a completed step timing summary', async () => {
    let clock = new Date(2026, 6, 21, 14, 32, 6).getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const harness = await setupSnapshot()
    await renderAfter(harness, () => {
      clock += 1_000
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: 'Checking the result.' },
      })
      clock += 2_000
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 1, text: 'The result is ready.' },
      })
      clock += 3_000
      harness.session.append('step/end', { turn: 1, step: 1 })
    })
    await checkpoint('step-timing-completed', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('pins the shared Web statistics strip in completed, running, and narrow states', async () => {
    let clock = Date.parse('2026-07-21T12:00:00.000Z')
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const harness = await setupSnapshot({ omitInitialLifecycle: true }, { columns: 120, rows: 36 })
    await renderAfter(harness, () => {
      harness.session.append('turn/start', { turn: 1 })
      harness.session.append('step/start', { turn: 1, step: 1 })
      clock += 1_200
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'The metrics are ready.' },
      })
      clock += 385
      appendAssistant(harness.session, [{ type: 'text', text: 'The metrics are ready.' }], {
        inputTokens: 7_700,
        outputTokens: 32,
      })
      harness.session.append('step/end', { turn: 1, step: 1 })
    })
    await checkpoint('session-stats-completed', harness.terminal, { includeScrollback: true })

    await renderAfter(harness, () => {
      harness.agent.status = 'running'
      agentEvents(harness.ctx, harness.agent).emit('agent/status', { status: 'running' })
      harness.session.append('turn/start', { turn: 2 })
      harness.session.append('step/start', { turn: 2, step: 1 })
    })
    await checkpoint('session-stats-running', harness.terminal, { includeScrollback: true })

    await renderAfter(harness, () => { harness.terminal.resize(72, 28) })
    await checkpoint('session-stats-narrow', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('clears the plan strip when the next turn starts', async () => {
    // Freeze Completed-at formatting: the first turn ends before the next starts,
    // so the assistant timing line still appears without a Plan strip below it.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 6, 21, 14, 45, 0).getTime())
    const harness = await setupSnapshot({
      beforeMount(session) {
        appendUser(session, 'Plan the work.')
        appendAssistant(session, [{ type: 'text', text: 'Tracking the steps.' }])
        session.append('todo/write', {
          todos: [
            { content: 'read code', status: 'completed' },
            { content: 'write tests', status: 'in_progress' },
          ],
        })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        session.append('turn/start', { turn: 2 })
        appendUser(session, 'Next question.')
      },
    })
    await checkpoint('todo-plan-cleared', harness.terminal)
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('pins failed-stream retraction, scheduled retry, and eventual success', async () => {
    const harness = await setupSnapshot()
    await renderAfter(harness, () => {
      appendUser(harness.session, 'Recover this request.')
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'discarded partial output' },
      })
      harness.session.append('llm/retry', {
        retryId: RetryId('snapshot-retry-normal'),
        turn: 1,
        step: 1,
        provider: 'mock',
        mode: 'normal',
        policyKey: '["normal",2,["RATE_LIMIT"],1,10000,0]',
        retry: 1,
        maxRetries: 2,
        delayMs: 500,
        failure: { message: 'provider rate limit', code: 'RATE_LIMIT', status: 429 },
      })
    })
    await checkpoint('retry-scheduled', harness.terminal, { includeScrollback: true })

    harness.session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Recovered on the next bounded attempt.' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'deepseek-v4-flash' },
        },
      }),
    }, { surfaceOp: 'append' })
    harness.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await checkpoint('retry-recovered', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins cancellation during a scheduled retry delay', async () => {
    const harness = await setupSnapshot()
    await renderAfter(harness, () => {
      appendUser(harness.session, 'Start then cancel.')
      harness.session.append('llm/retry', {
        retryId: RetryId('snapshot-retry-always'),
        turn: 1,
        step: 1,
        provider: 'mock',
        mode: 'always',
        policyKey: '["always",1,10000,0]',
        retry: 1,
        delayMs: 1_000,
        failure: { message: 'temporary transport failure', code: 'TRANSPORT' },
      })
      harness.session.append('turn/end', {
        turn: 1,
        reason: { kind: 'aborted', reason: { kind: 'user' } },
      })
    })
    await checkpoint('retry-cancelled', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins terminal exhaustion after retracting a failed partial stream', async () => {
    const harness = await setupSnapshot()
    await renderAfter(harness, () => {
      appendUser(harness.session, 'Let the bounded policy exhaust.')
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 3,
        chunk: { type: 'text-delta', index: 0, text: 'discarded terminal partial output' },
      })
      harness.session.append('turn/end', {
        turn: 1,
        reason: {
          kind: 'error',
          error: { message: 'provider still unavailable', code: 'SERVER', status: 503 },
        },
      })
    })
    await checkpoint('retry-exhausted', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('paints the startup banner product name in the DeepSeek brand gradient on truecolor terminals', async () => {
    const harness = await setupSnapshot({ config: { theme: { truecolor: true } } })
    await checkpoint('banner-gradient', harness.terminal, {}, true)
    await disposeSnapshot(harness)
  })

  it('pins the fresh-session welcome dashboard with recent sessions and framed input', async () => {
    const recent = [
      { version: 0, id: SessionId('recent-refactor'), createdAt: Date.parse('2026-08-13T09:30:00Z'), cwd: '/workspace/project' },
      { version: 0, id: SessionId('recent-tests'), createdAt: Date.parse('2026-08-12T14:00:00Z'), cwd: '/workspace/other' },
    ]
    const titled = (meta: typeof recent[number], title: string): { meta: typeof meta; events: SessionEvent[] } => ({
      meta,
      events: [{
        type: 'session/title',
        seq: 0,
        time: meta.createdAt,
        data: { title, messageSeqs: [], source: { kind: 'fallback' } },
      }],
    })
    const harness = await setupSnapshot({
      omitInitialLifecycle: true,
      sessionPersistence: {
        list: () => Promise.resolve(recent),
        load: id => Promise.resolve(id === recent[0]?.id
          ? titled(recent[0], 'Refactor terminal welcome screen')
          : titled(recent[1]!, 'Stabilize CLI release tests')),
      },
    }, { columns: 104, rows: 38 })
    await vi.waitFor(async () => {
      expect(await harness.terminal.snapshot()).toContain('Refactor terminal welcome screen')
    })
    await checkpoint('welcome-dashboard', harness.terminal)
    await disposeSnapshot(harness)
  })

  it('pins fuzzy file candidates and the active path-only mention', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-tui-file-snapshot-'))
    await mkdir(join(cwd, 'src'), { recursive: true })
    await writeFile(join(cwd, 'src', 'terminal-special-case.ts'), 'export const marker = true\n')
    await writeFile(join(cwd, 'src', 'terminal-state.ts'), 'export const state = true\n')
    const harness = await setupSnapshot({ cwd, formatCwd: () => '/workspace/project' })
    try {
      harness.terminal.send('@tsc')
      await vi.waitFor(async () => {
        expect(await harness.terminal.snapshot()).toContain('File · terminal-special-case.t')
      })
      await checkpoint('file-autocomplete', harness.terminal)
    } finally {
      await disposeSnapshot(harness)
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('pins session autocomplete discovered through a log-backed title', async () => {
    const harness = await setupSnapshot({
      async configureContext(ctx) {
        ctx.provide('tools', { get: () => undefined } as never)
        await ctx.plugin(TestSessionQueryService)
        await ctx.plugin(SessionReferenceResolver)
        const source = ctx.sessions.create(SessionId('opaque-source-id'), {
          meta: { cwd: '/workspace/project', createdAt: 1 },
        })
        source.append('session/title', {
          title: 'Searchable design review',
          messageSeqs: [],
          source: { kind: 'fallback' },
        })
      },
    })
    harness.terminal.send('@design')
    await vi.waitFor(async () => {
      expect(await harness.terminal.snapshot()).toContain('Session · Searchable design re')
    })
    await checkpoint('session-title-autocomplete', harness.terminal)
    await disposeSnapshot(harness)
  })

  it('pins Code Mode run_code with its production presenter', async () => {
    const harness = await setupSnapshot({ configureContext: configureAdvancedTools })
    const call = {
      id: 'code-1',
      name: 'run_code',
      arguments: {
        code: "const first = await tools.bash({ command: 'echo CODE_ONE' })\nconst second = await tools.bash({ command: 'echo CODE_TWO' })\nconsole.log(first, second)\nreturn `${first}+${second}`",
        description: 'Echo two markers and combine them',
      },
    }
    await renderAfter(harness, () => { appendToolCalls(harness.session, [call]) })
    await checkpoint('code-mode-pending', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins a dynamic workflow with phases, parallel agents, and structured output', async () => {
    const harness = await setupSnapshot({ configureContext: configureAdvancedTools })
    const call = {
      id: 'workflow-1',
      name: 'workflow',
      arguments: {
        meta: {
          name: 'tui-matrix',
          description: 'Audit terminal states from independent angles',
          phases: [
            { title: 'Inspect', detail: 'Map renderer branches' },
            { title: 'Verify', detail: 'Challenge missing states', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          ],
        },
        args: { packages: ['ui/tui', 'workflow/tool-workflow'] },
        script: "phase('Inspect')\nconst reports = await parallel([\n  () => agent('Audit layout', { label: 'layout', phase: 'Inspect' }),\n  () => agent('Audit lifecycle', { label: 'lifecycle', phase: 'Inspect' }),\n])\nphase('Verify')\nreturn { reports, verdict: 'covered' }",
      },
    }
    await renderAfter(harness, () => { appendToolCalls(harness.session, [call]) })
    await checkpoint('dynamic-workflow-pending', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins cordis inspect, define, and stop cards with production presenters', async () => {
    const harness = await setupSnapshot({ configureContext: configureAdvancedTools })
    const calls = [
      { id: 'cordis-1', name: 'cordis_inspect_list', arguments: {} },
      {
        id: 'cordis-2', name: 'cordis_define',
        arguments: {
          plugin: { kind: 'new', idPrefix: 'snap' },
          name: 'snapshot-marker',
          purpose: 'Expose a snapshot-only marker service.',
          code: { host: "return { name: 'snapshot-marker', apply(ctx) { ctx.provide('snapshotMarker', { ready: true }) } }" },
        },
      },
      { id: 'cordis-3', name: 'cordis_stop', arguments: { pluginId: 'snap-1' } },
    ]
    await renderAfter(harness, () => { appendToolCalls(harness.session, calls) })
    await checkpoint('cordis-tools-pending', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins terminal, diff, subagent, task, skill, collapsed, and expanded cards', async () => {
    const harness = await setupSnapshot({
      tools: ADVANCED_CARD_TOOLS,
      config: { maxToolOutputLines: 3, maxDiffEditLength: 2 },
    }, { columns: 100, rows: 40 })
    const calls = [
      { id: 'advanced-1', name: 'bash', arguments: { command: 'pnpm run test:coverage' } },
      { id: 'advanced-2', name: 'edit', arguments: { file_path: 'src/view.ts' } },
      { id: 'advanced-3', name: 'subagent', arguments: { prompt: 'Review renderer ownership and report only gaps.' } },
      { id: 'advanced-4', name: 'task_output', arguments: { task_id: 'subagent-7', wait: true } },
      { id: 'advanced-5', name: 'skill', arguments: { name: 'dsh-code-review' } },
      { id: 'advanced-6', name: 'large_edit', arguments: { file_path: 'src/large.ts' } },
    ]
    await renderAfter(harness, () => {
      appendToolCalls(harness.session, calls)
      appendToolResult(harness.session, 'advanced-1', [{ type: 'text', text: 'raw process output' }])
      appendToolResult(harness.session, 'advanced-2', [{ type: 'text', text: 'edit complete' }])
      appendToolResult(harness.session, 'advanced-3', [{ type: 'text', text: 'The renderer has explicit lifecycle ownership.' }])
      appendToolResult(harness.session, 'advanced-4', [{ type: 'text', text: 'audit complete\n[status: completed]' }])
      appendToolResult(harness.session, 'advanced-5', [{ type: 'text', text: 'Loaded review instructions.' }])
      appendToolResult(harness.session, 'advanced-6', [{ type: 'text', text: 'large edit complete' }])
    })
    await checkpoint('advanced-cards-collapsed', harness.terminal, { includeScrollback: true })

    await renderAfter(harness, () => { harness.terminal.send('\x0f') })
    await checkpoint('advanced-cards-expanded', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins the hidden phase folding a multi-step turn into one assistant message', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 6, 29, 22, 30, 0).getTime())
    const harness = await setupSnapshot({
      tools: ADVANCED_CARD_TOOLS,
      config: { maxToolOutputLines: 3 },
    }, { columns: 100, rows: 40 })
    await renderAfter(harness, () => {
      appendUser(harness.session, 'Refactor the renderer.')
      appendAssistant(harness.session, [{ type: 'text', text: 'Inspecting the renderer first.' }])
      appendToolCalls(harness.session, [
        { id: 'fold-1', name: 'bash', arguments: { command: 'pnpm run test' } },
      ])
      appendToolResult(harness.session, 'fold-1', [{ type: 'text', text: 'all tests pass' }])
      harness.session.append('step/end', { turn: 1, step: 1 })
      harness.session.append('step/start', { turn: 1, step: 2 })
      appendAssistant(harness.session, [{ type: 'text', text: 'The renderer is sound; no refactor needed.' }], undefined, { turn: 1, step: 2 })
      harness.session.append('step/end', { turn: 1, step: 2 })
      harness.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    })
    // collapsed -> expanded -> hidden: one Assistant header, no tool card.
    await renderAfter(harness, () => { harness.terminal.send('\x0f') })
    await renderAfter(harness, () => { harness.terminal.send('\x0f') })
    await checkpoint('tool-cards-hidden-folded', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('pins /details jumping card visibility and reasoning display to named states', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 6, 30, 18, 0, 0).getTime())
    const harness = await setupSnapshot({
      tools: ADVANCED_CARD_TOOLS,
      config: { maxToolOutputLines: 3 },
    }, { columns: 100, rows: 40 })
    await renderAfter(harness, () => {
      appendUser(harness.session, 'Inspect the renderer.')
      appendAssistant(harness.session, [
        { type: 'reasoning', text: 'The tool card and this block vanish under /details hidden reasoning off.' },
        { type: 'text', text: 'Running the check now.' },
      ])
      appendToolCalls(harness.session, [
        { id: 'details-1', name: 'bash', arguments: { command: 'pnpm run test' } },
      ])
      appendToolResult(harness.session, 'details-1', [{ type: 'text', text: 'all tests pass' }])
      harness.session.append('step/end', { turn: 1, step: 1 })
      harness.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    })
    await renderAfter(harness, () => {
      harness.terminal.send('/details hidden reasoning off')
      harness.terminal.send('\r')
    })
    await checkpoint('details-command', harness.terminal, { includeScrollback: true })
    // Bare /details opens the two-entry toggle seeded with the current
    // hidden/reasoning-off state; one Tab immediately cycles tool cards
    // hidden -> collapsed, so the frame pins the applied notice, the restored
    // tool card behind the dialog, and the updated entry value together.
    await renderAfter(harness, () => {
      harness.terminal.send('/details')
      harness.terminal.send('\r')
      harness.terminal.send('\t')
    })
    await checkpoint('details-selector', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('renders terminal controls as inert text across transcripts, tools, dialogs, diagnostics, and title', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 6, 21, 15, 0, 0).getTime())
    const tools = {
      unsafe: visualTool(
        'unsafe',
        () => ({
          card: 'terminal',
          title: `Unsafe title ${CONTROL_PROBE}`,
          description: `Unsafe description ${CONTROL_PROBE}`,
          cwd: `/unsafe/${CONTROL_PROBE}`,
        }),
        () => ({
          card: 'terminal',
          output: `Unsafe output ${CONTROL_PROBE}`,
          signal: `SIG${CONTROL_PROBE}`,
        }),
      ),
    }
    const harness = await setupSnapshot({
      tools,
      config: {
        welcome: `Unsafe welcome ${CONTROL_PROBE}`,
        title: `Unsafe terminal title ${CONTROL_PROBE}`,
      },
      beforeMount(session) {
        appendUser(session, `Unsafe user ${CONTROL_PROBE}`)
        appendAssistant(session, [
          { type: 'reasoning', text: `Unsafe reasoning ${CONTROL_PROBE}` },
          { type: 'text', text: `Unsafe assistant ${CONTROL_PROBE}` },
        ])
        appendToolCalls(session, [{ id: 'unsafe-1', name: 'unsafe', arguments: { value: CONTROL_PROBE } }])
        appendToolResult(session, 'unsafe-1', [{ type: 'text', text: `Unsafe fallback ${CONTROL_PROBE}` }])
        session.append('todo/write', {
          todos: [{ content: `Unsafe todo ${CONTROL_PROBE}`, status: 'in_progress' }],
        })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: `Unsafe context ${CONTROL_PROBE}` }],
          source: { kind: 'plugin', plugin: `unsafe-${CONTROL_PROBE}` },
        }), { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: {
            kind: 'error',
            error: { message: `Unsafe turn error ${CONTROL_PROBE}`, code: 'UNKNOWN' },
          },
        })
      },
    }, { columns: 100, rows: 34 })
    expect(harness.terminal.title).toContain(DISPLAYED_CONTROL_PROBE)
    expect(harness.terminal.title).not.toContain('\u001b')
    expect(harness.terminal.title).not.toContain('\u009b')

    const controller = new AbortController()
    const beforeQuestion = harness.terminal.frames
    const answer = harness.ctx.userQuestions.ask({
      questions: [{
        id: 'unsafe-question',
        header: `Unsafe header ${CONTROL_PROBE}`,
        question: `Unsafe question ${CONTROL_PROBE}`,
        options: [{ label: `Unsafe option ${CONTROL_PROBE}`, description: `Unsafe detail ${CONTROL_PROBE}` }],
      }],
      signal: controller.signal,
    })
    const rejected = answer.then(() => undefined, (error: unknown) => error)
    await harness.terminal.waitForFrame(beforeQuestion)
    agentEvents(harness.ctx, harness.agent).emit('agent/error', {
      turn: 8, step: 3, error: new Error(`Unsafe live error ${CONTROL_PROBE}`),
    })
    await checkpoint('untrusted-controls', harness.terminal, { includeScrollback: true })

    controller.abort()
    await expect(rejected).resolves.toMatchObject({ code: 'ASK_ABORTED' })
    await disposeSnapshot(harness)
    nowSpy.mockRestore()
  })

  it('pins a constrained multi-select question and its validation state', async () => {
    const harness = await setupSnapshot({
      config: {
        maxQuestionOptions: 3,
        questionDialogWidth: 200,
        questionDialogMaxHeight: 16,
      },
    }, { columns: 56, rows: 20 })
    const controller = new AbortController()
    const beforeQuestion = harness.terminal.frames
    const answer = harness.ctx.userQuestions.ask({
      questions: [
        {
          id: 'coverage',
          header: 'Coverage',
          question: 'Which advanced TUI states belong in the required matrix?',
          detail: `Review the complete plan ${'including every required checkpoint '.repeat(12)}visible plan tail`,
          multiSelect: true,
          options: [
            {
              label: 'Code Mode',
              description: `run_code programs and captured output ${'with complete wrapped detail '.repeat(12)}visible tail`,
            },
            { label: 'Workflows', description: 'phases and parallel agents' },
            { label: 'Cordis tools', description: 'inspect, mount, and unmount' },
            { label: 'Compaction', description: 'surface replacement and reflow' },
          ],
        },
        { id: 'priority', question: 'Which state should be implemented first?' },
        { id: 'notes', question: 'Any additional constraints?' },
      ],
      signal: controller.signal,
    })
    const rejected = answer.then(() => undefined, (error: unknown) => error)
    await harness.terminal.waitForFrame(beforeQuestion)
    await checkpoint('question-dialog', harness.terminal)

    await renderAfter(harness, () => { harness.terminal.send('\x1b[6~') })
    await checkpoint('question-dialog-detail-paged', harness.terminal)

    await renderAfter(harness, () => {
      for (let page = 0; page < 30; page += 1) harness.terminal.send('\x1b[6~')
    })
    await checkpoint('question-dialog-paged', harness.terminal)

    await renderAfter(harness, () => { harness.terminal.send('\r') })
    await checkpoint('question-dialog-validation', harness.terminal)
    controller.abort()
    await expect(rejected).resolves.toMatchObject({ code: 'ASK_ABORTED' })
    await disposeSnapshot(harness)
  })

  it('pins a single-option question', async () => {
    const harness = await setupSnapshot({
      config: {
        questionDialogWidth: 200,
        questionDialogMaxHeight: 16,
      },
    }, { columns: 56, rows: 20 })
    const controller = new AbortController()
    const beforeQuestion = harness.terminal.frames
    const answer = harness.ctx.userQuestions.ask({
      questions: [{
        id: 'confirm',
        header: 'Confirm',
        question: 'Continue with this change?',
        options: [{ label: 'Proceed', description: 'Apply the proposed change' }],
      }],
      signal: controller.signal,
    })
    const rejected = answer.then(() => undefined, (error: unknown) => error)
    await harness.terminal.waitForFrame(beforeQuestion)
    await checkpoint('question-dialog-single-option', harness.terminal)
    controller.abort()
    await expect(rejected).resolves.toMatchObject({ code: 'ASK_ABORTED' })
    await disposeSnapshot(harness)
  })

  it('pins preserved history, the compaction marker, and narrow-to-wide reflow', async () => {
    // Freeze the clock: the timing header hides zero-duration buckets, so a
    // real-clock millisecond tick between the fixture appends and the render
    // would flip `Tools 0.0s` in and out of the pinned header.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(COMPACTION_FIXTURE_TIME)
    // The awaited setup always invokes beforeMount, so the range the checkpoint
    // replaces is assigned by the time the appends below need it.
    let compacted!: CompactionRange
    const harness = await setupSnapshot({
      tools: ADVANCED_CARD_TOOLS,
      beforeMount(session) { compacted = appendPreCompactionLog(session) },
    }, { columns: 80, rows: 24 })
    await checkpoint('surface-before-compaction', harness.terminal, { includeScrollback: true })

    await renderAfter(harness, () => {
      appendCompactionCheckpoint(harness.session, compacted)
      harness.terminal.resize(44, 18)
    })
    await checkpoint('surface-after-compaction-narrow', harness.terminal, { includeScrollback: true })

    await renderAfter(harness, () => { harness.terminal.resize(104, 30) })
    await checkpoint('surface-after-compaction-wide', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
    nowSpy.mockRestore()
  })

  // The resume path, which is what regressed for real users: the replacement is
  // already stored when the terminal mounts, so the transcript comes from replay
  // rather than from live appends. Pinned against the same log the live scenario
  // ends on, at its wide size, so the two fixtures are directly comparable.
  it('pins a stored compaction replayed at mount', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(COMPACTION_FIXTURE_TIME)
    const harness = await setupSnapshot({
      tools: ADVANCED_CARD_TOOLS,
      beforeMount(session) {
        appendCompactionCheckpoint(session, appendPreCompactionLog(session))
      },
    }, { columns: 104, rows: 30 })
    await checkpoint('surface-replayed-compaction', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
    nowSpy.mockRestore()
  })

  it('pins wrapped and explicit multiline shell-prompt input', async () => {
    const harness = await setupSnapshot({}, { columns: 44, rows: 18 })
    await renderAfter(harness, () => {
      harness.terminal.send('Explain this implementation with enough detail to wrap across multiple full-width continuation rows without leaving a prompt-sized gap at the right edge.')
      harness.terminal.send('\x1b[13;2u')
      harness.terminal.send('Then suggest a simpler version.')
    })
    await checkpoint('shell-prompt-multiline', harness.terminal)
    await disposeSnapshot(harness)
  })

  it('pins help, unknown commands, live errors, turn failures, and terminal restoration', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 6, 21, 15, 5, 0).getTime())
    const harness = await setupSnapshot({}, { columns: 92, rows: 32 })
    await renderAfter(harness, () => {
      harness.terminal.send('/help')
      harness.terminal.send('\r')
      harness.terminal.send('/unknown-advanced-command')
      harness.terminal.send('\r')
      agentEvents(harness.ctx, harness.agent).emit('agent/error', {
        turn: 1, step: 1, error: new Error('provider stream failed after partial output'),
      })
      harness.session.append('step/end', { turn: 1, step: 1 })
      harness.session.append('turn/end', {
        turn: 1,
        reason: {
          kind: 'error',
          error: { message: 'provider stream failed after partial output', code: 'UNKNOWN' },
        },
      })
      harness.session.append('turn/start', { turn: 2 })
      harness.session.append('turn/end', {
        turn: 2,
        reason: { kind: 'interrupted' },
      })
      harness.session.append('turn/start', { turn: 3 })
      harness.session.append('turn/end', {
        turn: 3, reason: { kind: 'aborted', reason: { kind: 'disposed' } },
      })
      harness.session.append('turn/start', { turn: 4 })
      // A merge-extensible turn-end kind unknown to the TUI still surfaces its
      // name so the agent never stops without a visible reason.
      harness.session.append('turn/end', { turn: 4, reason: { kind: 'plugin-policy' } as never })
    })
    await checkpoint('errors-and-help', harness.terminal, { includeScrollback: true })

    await harness.controller.dispose()
    await harness.terminal.flush()
    await checkpoint('disposed-terminal', harness.terminal, { includeScrollback: true })
    await harness.ctx.fiber.dispose()
    await harness.terminal.dispose()
    nowSpy.mockRestore()
  })

  it('pins the model selector and selection notice', async () => {
    const harness = await setupSnapshot({}, { columns: 92, rows: 32 })
    await renderAfter(harness, () => {
      harness.terminal.send('/model')
      harness.terminal.send('\r')
    })
    await checkpoint('model-selector', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => {
      harness.terminal.send('pro')
    })
    await checkpoint('model-selector-filtered', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => {
      harness.terminal.send('\x1b[B')
      harness.terminal.send('\r')
    })
    await checkpoint('model-switching', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins the explicit full-access shortcut and recovery guidance', async () => {
    const harness = await setupSnapshot({
      omitInitialLifecycle: true,
      configureContext: configurePermissionPresets,
    }, { columns: 96, rows: 36 })
    await renderAfter(harness, () => {
      harness.terminal.send('/yolo')
      harness.terminal.send('\r')
    })
    await checkpoint('yolo-permission', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins the interactive permission selector and a committed switch', async () => {
    const harness = await setupSnapshot({
      omitInitialLifecycle: true,
      configureContext: configurePermissionPresets,
    }, { columns: 96, rows: 36 })
    await renderAfter(harness, () => {
      harness.terminal.send('/permissions')
      harness.terminal.send('\r')
    })
    await checkpoint('permissions-selector', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => {
      harness.terminal.send('\x1b[B')
      harness.terminal.send('\r')
    })
    await checkpoint('permissions-switching', harness.terminal, { includeScrollback: true })
    expect(harness.ctx.permissionPresets.current(harness.session.events)).toBe('danger-full-access')
    await disposeSnapshot(harness)
  })

  it('pins the skills, keymap, fast-route, experiment, IDE, and approve command surfaces', async () => {
    const harness = await setupSnapshot({
      configureContext: configureSnapshotSkills,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    }, { columns: 96, rows: 36 })
    await renderAfter(harness, () => {
      harness.terminal.send('/skills')
      harness.terminal.send('\r')
    })
    await checkpoint('skills-selector', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => { harness.terminal.send('\x1b') })
    await renderAfter(harness, () => {
      harness.terminal.send('/keymap')
      harness.terminal.send('\r')
    })
    await checkpoint('keymap-selector', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => {
      harness.terminal.send('\x1b[B')
      harness.terminal.send('\r')
    })
    await renderAfter(harness, () => { harness.terminal.send('\x1b') })
    await checkpoint('vim-normal-mode', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => {
      harness.terminal.send('i')
      harness.terminal.send('/fast on')
      harness.terminal.send('\r')
    })
    await checkpoint('fast-route-switching', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => {
      harness.terminal.send('/experimental')
      harness.terminal.send('\r')
    })
    await checkpoint('experimental-selector', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => { harness.terminal.send('\x1b') })
    await renderAfter(harness, () => {
      harness.terminal.send('/ide')
      harness.terminal.send('\r')
    })
    await checkpoint('ide-context-selector', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => { harness.terminal.send('\x1b') })
    await renderAfter(harness, () => {
      harness.terminal.send('/approve')
      harness.terminal.send('\r')
    })
    await checkpoint('approve-empty', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('pins shared Settings, Appearance, workspace selection, and handoff recovery', async () => {
    const uiTheme = settingsNamespace('ui-theme')
    const workspace = snapshotWorkspace(
      'snapshot-secondary-workspace',
      '/workspace/secondary',
      'Secondary project',
    )
    const handoff = vi.fn(() => Promise.reject(new Error('snapshot host retained process')))
    const harness = await setupSnapshot({
      config: { fullscreen: true, mouse: true },
      handoffWorkspace: handoff,
      configureContext: async (ctx) => {
        await ctx.plugin(SystemPrompt)
        await ctx.plugin(ToolRegistry)
        ctx.provide('settings', {
          get: (namespace: string) => namespace === uiTheme ? { preference: 'dark' } : undefined,
          mutate: () => Promise.resolve(),
          describe: () => [{
            ns: uiTheme,
            schema: { type: 'object' },
            value: { preference: 'dark' },
            user: { preference: 'dark' },
            revision: 1,
            applies: 'live',
          }, {
            ns: settingsNamespace('llm-deepseek'),
            schema: { type: 'object' },
            value: {},
            revision: 0,
            applies: 'restart',
            secrets: [['apiKey']],
          }],
          writable: true,
          documentPath: '/home/snapshot/.dsh/settings.yml',
          prepareDocument: () => Promise.resolve('/home/snapshot/.dsh/settings.yml'),
        } as never)
        ctx.provide('workspaceRegistry', {
          list: () => [workspace],
          create: () => Promise.resolve(workspace),
        } as never)
      },
    }, { columns: 92, rows: 32 })

    await renderAfter(harness, () => {
      harness.terminal.send('/settings')
      harness.terminal.send('\r')
    })
    await checkpoint('settings-hub', harness.terminal, { includeScrollback: true })

    await renderAfter(harness, () => { harness.terminal.send('\x1b') })
    await renderAfter(harness, () => {
      harness.terminal.send('/theme')
      harness.terminal.send('\r')
    })
    await checkpoint('theme-selector', harness.terminal, { includeScrollback: true })

    await renderAfter(harness, () => { harness.terminal.send('\x1b') })
    await renderAfter(harness, () => {
      harness.terminal.send('/workspace')
      harness.terminal.send('\r')
    })
    await checkpoint('workspace-selector', harness.terminal, { includeScrollback: true })

    const beforeHandoff = harness.terminal.frames
    harness.terminal.send('\r')
    await vi.waitFor(() => { expect(handoff).toHaveBeenCalledWith('/workspace/secondary') })
    await harness.terminal.waitForFrame(beforeHandoff)
    await new Promise(resolve => setTimeout(resolve, 25))
    const restored = await harness.terminal.snapshot({ includeScrollback: true })
    expect(restored).toContain('Workspace switch failed: snapshot host retained process')
    expect(restored).toContain('Snapshot agent ready.')
    expect(harness.session.header.cwd).toBe('/workspace/project')
    await checkpoint('workspace-handoff-recovered', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
  })

  it('opens the searchable resume selector with log-backed session summaries', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-23T08:00:00.000Z'))
    const earlier = { version: 0, id: SessionId('earlier-session'), createdAt: Date.parse('2024-01-01T00:00:00Z'), cwd: '/workspace/project' }
    const elsewhere = { version: 0, id: SessionId('elsewhere-session'), createdAt: Date.parse('2024-02-02T00:00:00Z'), cwd: '/workspace/other' }
    const log = (meta: typeof earlier, title: string, day: string): { meta: typeof earlier; events: SessionEvent[] } => ({
      meta,
      events: [
        { type: 'turn/start', seq: 0, time: Date.parse(`${day}T00:00:01Z`), data: { turn: 1 } },
        { type: 'user/message', seq: 1, time: Date.parse(`${day}T00:00:02Z`), data: createUserMessage({ content: [{ type: 'text', text: 'restore the selector' }], source: { kind: 'user' } }), surfaceOp: 'append' },
        { type: 'step/start', seq: 2, time: Date.parse(`${day}T00:00:03Z`), data: { turn: 1, step: 1 } },
        { type: 'request/header', seq: 3, time: Date.parse(`${day}T00:00:04Z`), data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }, reason: 'initial' } },
        { type: 'assistant/message', seq: 4, time: Date.parse(`${day}T00:00:05Z`), data: {
          turn: 1, step: 1,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'text', text: 'ready' }],
            source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
          }),
        }, surfaceOp: 'append' },
        { type: 'step/end', seq: 5, time: Date.parse(`${day}T00:00:06Z`), data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 6, time: Date.parse(`${day}T00:00:07Z`), data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'session/title', seq: 7, time: Date.parse(`${day}T00:00:08Z`), data: { title, messageSeqs: [1], source: { kind: 'fallback' } } },
      ],
    })
    const listGate = Promise.withResolvers<undefined>()
    // Rows show metadata activity (here the created-at fallback: the fake
    // store locates no per-session artifact to stat) plus each log's one
    // batch-folded title; nothing else is read from the logs.
    const harness = await setupSnapshot({
      sessionPersistence: {
        list: async () => {
          await listGate.promise
          return [earlier, elsewhere]
        },
        load: async id => id === elsewhere.id
          ? log(elsewhere, 'Other workspace work', '2024-02-02')
          : log(earlier, 'Resume selector design', '2024-01-01'),
      },
    }, { columns: 92, rows: 32 })
    harness.terminal.send('/resume')
    harness.terminal.send('\r')
    // The picker opens as soon as the command dispatches and owns input while
    // the persistence scan is still pending, rendering a loading placeholder
    // in place of rows; only the scan is gated, so this settle never lists.
    await new Promise(resolve => setTimeout(resolve, 60))
    await harness.terminal.flush()
    await checkpoint('resume-sessions-loading', harness.terminal, { includeScrollback: true })
    listGate.resolve(undefined)
    // With the scan released, the listing renders a tick later (the unit suite
    // waits the same way); settle, then flush.
    await new Promise(resolve => setTimeout(resolve, 60))
    await harness.terminal.flush()
    await checkpoint('resume-sessions', harness.terminal, { includeScrollback: true })
    // Tab switches to the all-workspaces scope, which adds the other workspace's
    // session and labels every row with the directory it belongs to.
    harness.terminal.send('\t')
    await new Promise(resolve => setTimeout(resolve, 60))
    await harness.terminal.flush()
    await checkpoint('resume-sessions-all-workspaces', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
    dateNow.mockRestore()
  })

  it('pins the detailed session diagnostics card', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-22T09:10:11.000Z'))
    const harness = await setupSnapshot({
      contextWindow: 128_000,
      contextTokens: 42_000,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      tools: {
        read: {
          name: 'read',
          description: 'Read a file',
          parameters: {},
          output: { schema: { type: 'null' }, render: () => [] },
          execute: async () => null,
        },
        write: {
          name: 'write',
          description: 'Write a file',
          parameters: {},
          output: { schema: { type: 'null' }, render: () => [] },
          execute: async () => null,
        },
      },
      beforeMount(session) {
        appendUser(session, 'inspect this session')
        appendAssistant(session, [{ type: 'text', text: 'Session inspected.' }], {
          inputTokens: 1_250,
          outputTokens: 340,
          cacheReadTokens: 3_000,
          cacheWriteTokens: 250,
        })
        session.append('tool/call', {
          turn: 1,
          step: 1,
          callId: CallId('status-call'),
          name: 'read',
          arguments: '{"path":"README.md"}',
        })
        session.append('session/title', {
          title: 'Inspect session diagnostics',
          messageSeqs: [1],
          source: { kind: 'fallback' },
        })
        // Renders over a boundary-bearing log. It cannot pin the exclusion:
        // `/status` appends its own `command/run` first, so the boundary is
        // never the tail here. The other two call sites pin it.
        dateNow.mockReturnValue(Date.parse('2026-07-22T10:10:11.000Z'))
        session.append('session/end-seed', {})
        dateNow.mockReturnValue(Date.parse('2026-07-22T09:10:11.000Z'))
      },
    }, { columns: 92, rows: 32 })
    await renderAfter(harness, () => {
      harness.terminal.send('/status')
      harness.terminal.send('\r')
    })
    await checkpoint('status-diagnostics', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => { harness.terminal.resize(56, 36) })
    await checkpoint('status-diagnostics-narrow', harness.terminal, { includeScrollback: true })
    await disposeSnapshot(harness)
    dateNow.mockRestore()
  })
})

afterAll(async () => {
  expect([...observedCheckpoints].sort()).toEqual([...CHECKPOINTS].sort())
  const files = (await readdir(SNAPSHOTS_DIR))
    .filter(file => file.endsWith('.expected.txt'))
    .sort()
  expect(files).toEqual([...CHECKPOINTS, ...STANDALONE_CHECKPOINTS].map(name => `${name}.expected.txt`).sort())
})
