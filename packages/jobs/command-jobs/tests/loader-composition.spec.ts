import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as commandJobs from '@deepseek-ai/dsh-command-jobs'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('command-jobs real Loader composition', () => {
  it('discovers, lists, and stops work through the assembled command plane', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-jobs-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-jobs-local'",
      "- name: '@deepseek-ai/dsh-command-jobs'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-jobs-local', LocalJobRegistry],
      ['@deepseek-ai/dsh-command-jobs', commandJobs],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = {
      session: Session.create(SessionId('loader-command-jobs')),
      status: 'idle',
      options: {},
    } as unknown as Agent
    const cancels: Array<string | undefined> = []
    let settle!: (outcome: JobOutcome) => void
    const id = context.jobs.start({
      kind: 'bash',
      label: 'pnpm test',
      run: () => ({
        cancel(reason) { cancels.push(reason) },
        done: new Promise((resolve) => { settle = resolve }),
      }),
    })

    expect(context.commands.list(owner).map(command => command.name)).toEqual(['clean', 'ps', 'stop'])
    expect((await context.commands.execute(owner, '/ps', new AbortController().signal))?.result).toEqual({
      kind: 'success',
      text: `Background jobs\n\n  • ${id} [bash] running — pnpm test`,
    })
    expect((await context.commands.execute(owner, '/clean', new AbortController().signal))?.result).toEqual({
      kind: 'success',
      text: 'Requested cancellation for 1 background job.',
    })
    expect(cancels).toEqual(['Stopped by /clean.'])
    expect(owner.session.deriveMessages()).toEqual([])

    settle({ status: 'killed' })
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  })
})
