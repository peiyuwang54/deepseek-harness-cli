/**
 * `@deepseek-ai/dsh-headless` — non-interactive Agent driver. The bundle
 * creates or resumes one Agent, submits text and durable images, optionally
 * captures schema-valid structured output, emits text or JSONL, flushes, and
 * exits without mounting a Host, HTTP server, or browser surface.
 * @module @deepseek-ai/dsh-headless
 */

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection, type Agent, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  attachStructuredRuntime,
  type StructuredAttachment,
} from '@deepseek-ai/dsh-subagent-in-process-driver'
import { assertObjectJsonSchema, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { ExecJsonlEmitter } from './exec-events.ts'
import type { HeadlessPermissionMode, HeadlessStartupValues } from './startup.ts'

/** Stable Cordis plugin name. */
export const name = 'headless-runner'

/** Services required by fresh and resumed non-interactive runs. */
export const inject = [
  'headlessStartup',
  'agentDefaultModel',
  'agentPresets',
  'permissionPresets',
  'sandboxPolicy',
  'agents',
  'sessions',
  'sessionPersistence',
  'attachments',
]

/** The runner has no deployment tunables; the startup provider owns argv. */
export type Config = Record<never, never>

export const Config: z<Config> = z.object({})

/** Outcome of one owned run interval. */
interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/** Process-facing effects of one run. */
interface HeadlessIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdout: HeadlessIo['stdout']; stderr: HeadlessIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Report an unexpected runner failure and request a failing exit. */
function fail(io: HeadlessIo, startup: HeadlessStartupValues, error: unknown): void {
  const message = errorText(error)
  if (startup.json) {
    new ExecJsonlEmitter((value) => { io.stdout.write(`${JSON.stringify(value)}\n`) }).error(message)
  } else {
    io.stderr.write(`deepseek exec: ${message}\n`)
  }
  io.exit(1)
}

function imageMediaType(path: string): ImageMediaType {
  switch (extname(path).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: throw new Error(`unsupported image extension for ${JSON.stringify(path)}; use PNG, JPEG, WebP, or GIF`)
  }
}

/** Read and admit an ordered image batch before publishing its user message. */
async function imageBlocks(ctx: Context, paths: readonly string[]): Promise<ContentBlock[]> {
  if (paths.length === 0) return []
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('image input requires the attachment service')
  const inputs: SaveImageAttachment[] = []
  for (const path of paths) {
    const absolute = resolve(process.cwd(), path)
    const mediaType = imageMediaType(path)
    inputs.push({
      data: await readFile(absolute),
      mediaType,
      name: basename(path),
    })
  }
  return (await attachments.saveImages(inputs)).map(attachment => ({ type: 'image', attachment }))
}

/** Read and validate the supported object-rooted JSON Schema subset. */
async function outputSchema(path: string | undefined): Promise<ObjectJsonSchema | undefined> {
  if (path === undefined) return undefined
  const absolute = resolve(process.cwd(), path)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(absolute, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read output schema ${JSON.stringify(path)}: ${errorText(error)}`, { cause: error })
  }
  try {
    assertObjectJsonSchema(parsed)
  } catch (error) {
    throw new Error(`invalid output schema ${JSON.stringify(path)}: ${errorText(error)}`, { cause: error })
  }
  return parsed
}

/** Resolve an explicit id or the newest persisted session in the selected scope. */
async function resumeSessionId(ctx: Context, startup: HeadlessStartupValues): Promise<SessionId | undefined> {
  const selection = startup.resume
  if (selection === undefined) return undefined
  if (!selection.last) return SessionId(selection.sessionId as string)
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) throw new Error('exec resume requires session persistence')
  const cwd = process.cwd()
  const candidates = (await persistence.list())
    .filter(header => selection.all || header.cwd === cwd)
    .sort((left, right) => right.createdAt - left.createdAt || String(right.id).localeCompare(String(left.id)))
  const newest = candidates[0]
  if (newest === undefined) {
    throw new Error(selection.all
      ? 'no persisted session is available to resume'
      : `no persisted session is available in ${cwd}; use --all to include other workspaces`)
  }
  return newest.id
}

/** Apply a startup permission shortcut inside unpublished Agent setup. */
function installPermission(ctx: Context, agent: Agent, mode: HeadlessPermissionMode): void {
  if (mode === 'default') return
  const permissions = ctx.get('permissionPresets')
  if (permissions === undefined) throw new Error('exec permission flags require permission presets')
  const target = mode === 'yolo' ? permissions.fullAccessPreset : permissions.fullAutoPreset
  if (target === undefined) {
    throw new Error(mode === 'yolo'
      ? '--yolo is unavailable because this profile has no unrestricted preset'
      : '--full-auto is unavailable because this profile has no workspace-only unattended preset')
  }
  permissions.set(agent.session, target)
}

/** Create or resume the one Agent and finish its scoped composition before publication. */
async function prepareAgent(
  ctx: Context,
  startup: HeadlessStartupValues,
  schema: ObjectJsonSchema | undefined,
): Promise<{ agent: Agent; structured?: StructuredAttachment }> {
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const presets = ctx.get('agentPresets')
  if (agents === undefined || defaultModel === undefined || presets === undefined) {
    throw new Error('the non-interactive Agent services were disposed before startup completed')
  }
  const selection = defaultModel.currentSelection()
  let structured: StructuredAttachment | undefined
  const setup = async (agentCtx: Context): Promise<void> => {
    const agent = agentCtx.agent
    if (agent === undefined) throw new Error('exec Agent setup has no scoped Agent')
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
    if (startup.additionalWritableRoots.length > 0) {
      ctx.sandboxPolicy.addWritableRoots(agent.session, startup.additionalWritableRoots)
    }
    installPermission(ctx, agent, startup.permissionMode)
    await presets.mount(agentCtx, resolveSessionPreset(agent.session))
    if (schema !== undefined) structured = attachStructuredRuntime(agentCtx, schema)
  }
  const resumeId = await resumeSessionId(ctx, startup)
  if (resumeId !== undefined) {
    const handle = await agents.resume({
      resumeSessionId: resumeId,
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    })
    return { agent: handle.agent, ...structured === undefined ? {} : { structured } }
  }
  const preset = await presets.resolve()
  const handle = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: {
      cwd: process.cwd(),
      agentPreset: preset.id,
      ...startup.ephemeral ? { ephemeral: true } : {},
    },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup,
  })
  return { agent: handle.agent, ...structured === undefined ? {} : { structured } }
}

/** Run one fresh or resumed task and request process exit. */
async function run(ctx: Context, startup: HeadlessStartupValues, io: HeadlessIo): Promise<void> {
  await ctx.get('loader')?.await()
  if (ctx.get('headlessStartup') === undefined
    || ctx.get('agents') === undefined
    || ctx.get('agentDefaultModel') === undefined
    || ctx.get('agentPresets') === undefined
    || ctx.get('permissionPresets') === undefined
    || ctx.get('sandboxPolicy') === undefined
    || ctx.get('sessions') === undefined
    || ctx.get('sessionPersistence') === undefined
    || ctx.get('attachments') === undefined) return

  const [schema, images] = await Promise.all([
    outputSchema(startup.outputSchema),
    imageBlocks(ctx, startup.images),
  ])
  const { agent, structured } = await prepareAgent(ctx, startup, schema)
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  const jsonl = startup.json
    ? new ExecJsonlEmitter((value) => { io.stdout.write(`${JSON.stringify(value)}\n`) })
    : undefined
  jsonl?.threadStarted(String(agent.session.id))
  const stopEvents = jsonl === undefined
    ? undefined
    : ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.seq >= firstSeq) jsonl.event(event)
    })
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: startup.task }, ...images],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  } finally {
    stopEvents?.()
  }
  const sessions = ctx.get('sessions')
  if (sessions === undefined) return
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session.events, firstSeq)
  const captured = structured?.captured()
  const structuredMissing = schema !== undefined && captured === undefined
  const resultText = captured === undefined ? outcome.text : JSON.stringify(captured.value)
  if (startup.outputLastMessage !== undefined) {
    await writeFile(resolve(process.cwd(), startup.outputLastMessage), resultText, 'utf8')
  }
  if (jsonl !== undefined) {
    if (captured !== undefined) jsonl.structuredResult(captured.value)
    jsonl.finish(structuredMissing
      ? 'the model completed without reporting schema-valid structured output'
      : outcome.reason === undefined
        ? 'the run ended without a turn result'
        : undefined)
  } else {
    io.stdout.write(`${resultText}\n`)
    if (structuredMissing) {
      io.stderr.write('deepseek exec: the model completed without reporting schema-valid structured output\n')
    } else if (outcome.reason?.kind === 'error') {
      io.stderr.write(`deepseek exec: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
    }
  }
  io.exit(outcome.reason?.kind === 'completed' && !structuredMissing ? 0 : 1)
}

/**
 * Mount the non-interactive driver.
 * @param ctx - plugin context carrying startup, Agent, persistence, and output services.
 * @param _config - empty deployment config; command-line values arrive through `headlessStartup`.
 */
export function apply(ctx: Context, _config: Config = {}): void {
  const exit = ctx.get('appExit')
  const startup = ctx.get('headlessStartup')
  if (exit === undefined) throw new Error('headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  if (startup === undefined) throw new Error('headless-runner: headlessStartup must be provided before the runner mounts')
  const io: HeadlessIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, startup, io).catch((error: unknown) => { fail(io, startup, error) })
}
