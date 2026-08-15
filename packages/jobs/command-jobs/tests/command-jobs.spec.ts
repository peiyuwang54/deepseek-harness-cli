import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { JobHooks, JobOutcome, JobStart } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as commandJobs from '@deepseek-ai/dsh-command-jobs'

interface Producer {
  readonly spec: JobStart
  readonly cancels: Array<string | undefined>
  settle(outcome: JobOutcome): void
}

function producer(label: string, cancelError?: unknown): Producer {
  let settle!: (outcome: JobOutcome) => void
  const cancels: Array<string | undefined> = []
  const hooks: JobHooks = {
    cancel(reason) {
      cancels.push(reason)
      if (cancelError !== undefined) throw cancelError
    },
    done: new Promise((resolve) => { settle = resolve }),
  }
  return {
    spec: { kind: 'bash', label, run: () => hooks },
    cancels,
    settle,
  }
}

function agent(): Agent {
  return {
    session: Session.create(SessionId('command-jobs-test')),
    status: 'idle',
    options: {},
  } as unknown as Agent
}

async function run(ctx: Context, owner: Agent, line: string) {
  const execution = await ctx.commands.execute(owner, line, new AbortController().signal)
  if (execution === undefined) throw new Error(`command was not registered: ${line}`)
  return execution.result
}

const tick = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

async function harness() {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(LocalJobRegistry)
  const plugin = await ctx.plugin(commandJobs)
  return { ctx, plugin, owner: agent() }
}

describe('@deepseek-ai/dsh-command-jobs registration', () => {
  it('registers Loader-safe commands and detaches its job controller on disposal', async () => {
    const test = await harness()
    expect(commandJobs.name).toBe('command-jobs')
    expect(commandJobs.inject).toEqual(['commands', 'jobs'])
    expect('default' in commandJobs).toBe(false)
    expect(test.ctx.commands.list(test.owner)).toEqual(expect.arrayContaining([
      { name: 'ps', description: 'List running background jobs' },
      { name: 'stop', description: 'Stop all running background jobs' },
    ]))

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.owner, 'ps')).toBeUndefined()
    expect(test.ctx.commands.find(test.owner, 'stop')).toBeUndefined()
    expect(() => test.ctx.jobs.start(producer('sleep 60').spec)).toThrow('no job controller serves this agent')
    await test.ctx.fiber.dispose()
  })
})

describe('/ps human command', () => {
  it('lists only live caller-visible jobs without consuming output', async () => {
    const test = await harness()
    const completed = producer('already done')
    test.ctx.jobs.start(completed.spec)
    completed.settle({ status: 'completed', output: 'finished output' })
    await tick()
    const multiline = producer(`${'a'.repeat(81)}\nsecond line`)
    const stopping = producer('watch tests')
    const stoppingId = test.ctx.jobs.start(stopping.spec)
    test.ctx.jobs.start(multiline.spec)
    test.ctx.jobs.kill(stoppingId, test.owner, 'manual pre-stop')

    expect(await run(test.ctx, test.owner, '/ps')).toEqual({
      kind: 'success',
      text: `Background jobs\n\n  • ${stoppingId} [bash] stopping — watch tests\n  • bash-3 [bash] running — ${'a'.repeat(80)} […]`,
    })
    expect(test.ctx.jobs.read('bash-1' as never, test.owner).text).toBe('finished output')
    expect(await run(test.ctx, test.owner, '/ps now')).toEqual({
      kind: 'error',
      text: 'Usage: /ps (no arguments)',
    })
    expect(test.owner.session.deriveMessages()).toEqual([])

    stopping.settle({ status: 'killed' })
    multiline.settle({ status: 'completed' })
    await tick()
    await test.ctx.fiber.dispose()
  })

  it('reports an empty active set directly', async () => {
    const test = await harness()
    expect(await run(test.ctx, test.owner, '/ps')).toEqual({
      kind: 'success',
      text: 'Background jobs\n\n  • No background jobs running.',
    })
    await test.ctx.fiber.dispose()
  })
})

describe('/stop human command', () => {
  it('requests every running cancellation, skips stopping jobs, and reports partial failures', async () => {
    const test = await harness()
    const alreadyStopping = producer('watch tests')
    const cancellable = producer('sleep 60')
    const failing = producer('stubborn server', new Error('cancel hook failed'))
    const stoppingId = test.ctx.jobs.start(alreadyStopping.spec)
    test.ctx.jobs.start(cancellable.spec)
    test.ctx.jobs.start(failing.spec)
    test.ctx.jobs.kill(stoppingId, test.owner, 'already stopping')

    expect(await run(test.ctx, test.owner, '/stop')).toEqual({
      kind: 'error',
      text: 'Requested cancellation for 1 background job.\nFailed to stop 1: bash-3: cancel hook failed',
    })
    expect(alreadyStopping.cancels).toEqual(['already stopping'])
    expect(cancellable.cancels).toEqual(['Stopped by /stop.'])
    expect(failing.cancels).toEqual(['Stopped by /stop.'])
    expect(test.ctx.jobs.get('bash-2' as never, test.owner).status).toBe('stopping')
    expect(test.ctx.jobs.get('bash-3' as never, test.owner).status).toBe('running')
    expect(await run(test.ctx, test.owner, '/stop later')).toEqual({
      kind: 'error',
      text: 'Usage: /stop (no arguments)',
    })

    alreadyStopping.settle({ status: 'killed' })
    cancellable.settle({ status: 'killed' })
    failing.settle({ status: 'failed', detail: 'cancel hook failed' })
    await tick()
    await test.ctx.fiber.dispose()
  })

  it('reports zero running jobs without changing stopping work', async () => {
    const test = await harness()
    const stopping = producer('watch tests')
    const id = test.ctx.jobs.start(stopping.spec)
    test.ctx.jobs.kill(id, test.owner)
    expect(await run(test.ctx, test.owner, '/stop')).toEqual({
      kind: 'success',
      text: 'No running background jobs to stop.',
    })
    expect(stopping.cancels).toEqual([undefined])
    stopping.settle({ status: 'killed' })
    await tick()
    await test.ctx.fiber.dispose()
  })

  it('contains non-Error cancellation failures and uses plural zero accounting', async () => {
    const test = await harness()
    const stringFailure = producer('string failure', 'string cancel failed')
    const opaqueFailure = producer('opaque failure', { code: 'cancel-failed' })
    test.ctx.jobs.start(stringFailure.spec)
    test.ctx.jobs.start(opaqueFailure.spec)

    expect(await run(test.ctx, test.owner, '/stop')).toEqual({
      kind: 'error',
      text: 'Requested cancellation for 0 background jobs.\nFailed to stop 2: bash-1: string cancel failed; bash-2: unknown cancellation failure',
    })
    stringFailure.settle({ status: 'failed' })
    opaqueFailure.settle({ status: 'failed' })
    await tick()
    await test.ctx.fiber.dispose()
  })
})
