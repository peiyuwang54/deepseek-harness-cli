/** Agent ownership and renderer-before-publication ordering for the TUI app bundle. */

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply as mountProcessTui, TuiConfigSchema } from '@deepseek-ai/dsh-tui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  Config,
  internals,
} from '../src/index.ts'
import type { TuiStartupValues } from '../src/startup.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  internals.mount = mountProcessTui
  internals.stderr = process.stderr
})

/** Let the runner's Loader-settlement continuation reach the fake registry. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Minimal manually provided host plane for focused runner ownership tests. */
function bench(identity: TuiStartupValues['identity']) {
  const ctx = new Context()
  contexts.push(ctx)
  const order: string[] = []
  const exits: number[] = []
  const create = vi.fn(async (options: { setup?(ctx: Context): unknown }) => {
    order.push('create')
    await options.setup?.(new Context())
    return { agent: {}, dispose: async () => {} }
  })
  const resume = vi.fn(async (options: { setup?(ctx: Context): unknown }) => {
    order.push('resume')
    await options.setup?.(new Context())
    return { agent: {}, dispose: async () => {} }
  })
  ctx.provide('appExit', code => void exits.push(code))
  ctx.provide('tuiStartup', { identity })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'provider-a', model: 'model-a' }),
  } as never)
  ctx.provide('agents', { create, resume } as never)
  internals.mount = (_ctx, config) => { order.push(`mount:${config.sessionId}`) }
  return { ctx, order, exits, create, resume }
}

describe('tui runner', () => {
  it('creates the exact fresh root through AgentRegistry, then mounts it', async () => {
    const test = bench({ id: SessionId('fresh-main'), resume: false })
    apply(test.ctx, { showReasoning: false })
    await tick()
    expect(test.order).toEqual(['create', 'mount:fresh-main'])
    expect(test.resume).not.toHaveBeenCalled()
    expect(test.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'fresh-main',
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'provider-a', model: 'model-a' },
    }))
    expect(typeof test.create.mock.calls[0]?.[0].setup).toBe('function')
    expect(test.exits).toEqual([])
  })

  it('resumes the exact persisted root through AgentRegistry, then mounts it', async () => {
    const test = bench({ id: SessionId('persisted-main'), resume: true })
    apply(test.ctx, {})
    await tick()
    expect(test.order).toEqual(['resume', 'mount:persisted-main'])
    expect(test.create).not.toHaveBeenCalled()
    expect(test.resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: 'persisted-main',
      agentOptions: { provider: 'provider-a', model: 'model-a' },
    }))
    expect(typeof test.resume.mock.calls[0]?.[0].setup).toBe('function')
    expect(test.exits).toEqual([])
  })

  it('reports registry startup failure through the bounded launcher exit', async () => {
    const test = bench({ id: SessionId('broken-main'), resume: false })
    let stderr = ''
    internals.stderr = { write: (chunk) => { stderr += chunk; return true } }
    test.create.mockRejectedValueOnce(new Error('factory exploded'))
    apply(test.ctx, {})
    await tick()
    expect(stderr).toBe('dsh tui: factory exploded\n')
    expect(test.exits).toEqual([1])
  })

  it('fails loud without the launcher-owned exit hook', () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('tuiStartup', { identity: { id: SessionId('main'), resume: false } })
    expect(() => { apply(ctx, {}) }).toThrow('must provide ctx.appExit')
  })

  it('keeps the statically catalogued bundle schema aligned with renderer defaults', () => {
    expect(new Config({})).toEqual(new TuiConfigSchema({}))
    expect(new Config({ showReasoning: false, maxToolOutputLines: 9 })).toMatchObject({
      showReasoning: false,
      maxToolOutputLines: 9,
    })
    expect(() => new Config({ maxToolOutputLines: 0 })).toThrow()
  })
})
