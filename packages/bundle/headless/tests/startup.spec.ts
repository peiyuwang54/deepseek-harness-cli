/**
 * The one-shot app's ordinary command-line provider over a real Loader tree:
 * the task becomes injected runner config, while help and usage errors leave
 * the consumer pending.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, HEADLESS_STARTUP_SERVICE, type HeadlessStartupValues } from '../src/startup.ts'

/** What one boot of the fixture tree observed. */
interface Observed {
  exits: number[]
  out: string
  runnerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/**
 * Mount the real provider over a runner stand-in.
 * @param args - the invocation's inner arguments.
 * @returns the resolved service value and observed runner/process effects.
 */
async function bootStartup(args: string[]): Promise<{ task: HeadlessStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-headless-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__headlessStartupObserved.runnerConfig = config }\n')
  // Loader imports through Node's resolver, so this fixture delegates to the
  // source-plane plugin already imported by the test.
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'headless-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__headlessStartupApply(ctx)
`)
  const rowUrl = pathToFileURL(join(dir, 'row.mjs')).href
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: headless-runner',
    `  name: ${rowUrl}`,
    `  inject: [${HEADLESS_STARTUP_SERVICE}]`,
    '  config:',
    '    task: !!js ctx.headlessStartup.task',
    '- id: headless-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __headlessStartupApply: typeof apply
    __headlessStartupObserved: Observed
  }
  globals.__headlessStartupApply = apply
  globals.__headlessStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    task: ctx.get(HEADLESS_STARTUP_SERVICE),
    observed,
  }
}

describe('headless command-line provider', () => {
  it('joins the task positional into the runner config', async () => {
    const { task, observed } = await bootStartup(['run', 'the', 'tests'])
    expect(task).toEqual({
      task: 'run the tests',
      json: false,
      ephemeral: false,
      images: [],
      permissionMode: 'default',
      additionalWritableRoots: [],
    })
    expect(observed.runnerConfig).toEqual({ task: 'run the tests' })
    expect(observed.exits).toEqual([])
  })

  it('resolves JSONL, schema, image, output, ephemeral, and permission options', async () => {
    const { task } = await bootStartup([
      '--json', '--ephemeral', '--image', 'one.png', '-i', 'two.jpg',
      '--output-schema', 'result.schema.json', '-o', 'last.txt', '--full-auto', 'analyze',
    ])
    expect(task).toEqual({
      task: 'analyze',
      json: true,
      ephemeral: true,
      images: ['one.png', 'two.jpg'],
      outputSchema: 'result.schema.json',
      outputLastMessage: 'last.txt',
      permissionMode: 'full-auto',
      additionalWritableRoots: [],
    })
  })

  it('resolves newest and explicit session continuations', async () => {
    expect((await bootStartup(['--json', 'resume', '--last', '--all', '-i', 'screen.png', 'continue'])).task)
      .toEqual({
        task: 'continue',
        json: true,
        ephemeral: false,
        images: ['screen.png'],
        permissionMode: 'default',
        additionalWritableRoots: [],
        resume: { last: true, all: true },
      })
    expect((await bootStartup(['resume', 'session-123', '--yolo', 'finish', 'the', 'task'])).task)
      .toEqual({
        task: 'finish the task',
        json: false,
        ephemeral: false,
        images: [],
        permissionMode: 'yolo',
        additionalWritableRoots: [],
        resume: { sessionId: 'session-123', last: false, all: false },
      })
  })

  it('collects additional writable directories across parent and resume options', async () => {
    const { task } = await bootStartup([
      '--add-dir', '../shared', 'resume', '--last', '--add-dir', '/tmp/cache', 'continue',
    ])
    expect(task?.additionalWritableRoots).toEqual(['../shared', '/tmp/cache'])
  })

  it('resolves independent sandbox and approval selections', async () => {
    const { task, observed } = await bootStartup([
      '--sandbox', 'read-only', '--ask-for-approval', 'never', 'inspect',
    ])
    expect(task).toMatchObject({
      task: 'inspect',
      permissionMode: 'default',
      permissionPolicy: { sandbox: 'read-only', approval: 'never' },
    })
    expect(observed.exits).toEqual([])
  })

  it('lets resume-subcommand permission knobs override parent values', async () => {
    const { task } = await bootStartup([
      '--sandbox', 'workspace-write', 'resume', '--last',
      '--sandbox', 'read-only', '--ask-for-approval', 'ask', 'continue',
    ])
    expect(task?.permissionPolicy).toEqual({ sandbox: 'read-only', approval: 'ask' })
  })

  it.each([{ args: [] }, { args: ['   '] }])('rejects an invocation with no non-whitespace task ($args)', async ({ args }) => {
    const { task, observed } = await bootStartup(args)
    expect(observed.out).toContain('a task is required')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('prints its own help and leaves the runner pending', async () => {
    const { task, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('deepseek exec')
    expect(observed.out).toContain('--add-dir <dir>')
    expect(observed.out).toContain('--sandbox <mode>')
    expect(observed.out).toContain('--ask-for-approval <policy>')
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it.each([
    {
      args: ['--full-auto', '--yolo', 'task'],
      message: '--full-auto and --yolo are mutually exclusive',
    },
    {
      args: ['--yolo', '--ask-for-approval', 'ask', 'task'],
      message: 'cannot be combined with --sandbox or --ask-for-approval',
    },
    {
      args: ['--ephemeral', 'resume', '--last', 'task'],
      message: '--ephemeral cannot be used with exec resume',
    },
    {
      args: ['resume', '--all', 'session-1', 'task'],
      message: '--all requires --last',
    },
    {
      args: ['resume'],
      message: 'exec resume needs a session id or --last',
    },
    {
      args: ['resume', '   ', 'task'],
      message: 'exec resume needs a session id or --last',
    },
  ])('rejects contradictory resume and permission options ($message)', async ({ args, message }) => {
    const { task, observed } = await bootStartup(args)
    expect(observed.out).toContain(message)
    expect(task).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rejects an unknown approval policy', async () => {
    const { task, observed } = await bootStartup(['--ask-for-approval', 'sometimes', 'task'])
    expect(observed.out).toContain('Allowed choices are')
    expect(task).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})
