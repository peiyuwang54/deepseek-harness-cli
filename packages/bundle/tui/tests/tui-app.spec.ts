/** Agent ownership and renderer-before-publication ordering for the TUI app bundle. */

import { Context } from '@deepseek-ai/cordis'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
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
function bench(
  identity: TuiStartupValues['identity'],
  resumed: { agentPreset?: string; events?: readonly SessionEvent[] } = {},
  permissionMode: TuiStartupValues['permissionMode'] = 'default',
  fullAccessPreset: string | null = 'danger-full-access',
  fullAutoPreset: string | null = 'full-auto',
) {
  const ctx = new Context()
  contexts.push(ctx)
  const order: string[] = []
  const exits: number[] = []
  const mounted: Array<string | undefined> = []
  const resolved: Array<string | undefined> = []
  const create = vi.fn(async (options: { setup?(ctx: Context): unknown }) => {
    order.push('create')
    const session = Session.create(
      SessionId(String(identity.id)),
      undefined,
      {
        version: SESSION_FORMAT_VERSION,
        id: SessionId(String(identity.id)),
        createdAt: 1,
      },
    )
    const agentCtx = new Context()
    agentCtx.provide('agent', { session })
    await options.setup?.(agentCtx)
    return { agent: {}, dispose: async () => {} }
  })
  const resume = vi.fn(async (options: { setup?(ctx: Context): unknown }) => {
    order.push('resume')
    const session = Session.create(
      SessionId(String(identity.id)),
      resumed.events,
      {
        version: SESSION_FORMAT_VERSION,
        id: SessionId(String(identity.id)),
        createdAt: 1,
        ...resumed.agentPreset === undefined ? {} : { agentPreset: resumed.agentPreset },
      },
    )
    const agentCtx = new Context()
    agentCtx.provide('agent', { session })
    await options.setup?.(agentCtx)
    return { agent: {}, dispose: async () => {} }
  })
  ctx.provide('appExit', code => void exits.push(code))
  ctx.provide('tuiStartup', { identity, permissionMode })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'provider-a', model: 'model-a' }),
  } as never)
  ctx.provide('agentPresets', {
    resolve: vi.fn(async (id?: string) => {
      resolved.push(id)
      return { id: id ?? 'standard' }
    }),
    mount: vi.fn(async (_agentCtx: Context, id?: string) => {
      mounted.push(id)
      order.push(`preset:${id}`)
    }),
  } as never)
  const setPermission = vi.fn((_session: Session, name: string) => {
    order.push(`permission:${name}`)
  })
  ctx.provide('permissionPresets', {
    fullAccessPreset: fullAccessPreset ?? undefined,
    fullAutoPreset: fullAutoPreset ?? undefined,
    set: setPermission,
  } as never)
  ctx.provide('agents', { create, resume } as never)
  internals.mount = (_ctx, config) => { order.push(`mount:${config.sessionId}`) }
  return { ctx, order, exits, create, resume, mounted, resolved, setPermission }
}

describe('tui runner', () => {
  it('creates the exact fresh root through AgentRegistry, then mounts it', async () => {
    const test = bench({ id: SessionId('fresh-main'), resume: false })
    apply(test.ctx, { showReasoning: false })
    await tick()
    expect(test.order).toEqual(['create', 'preset:standard', 'mount:fresh-main'])
    expect(test.resume).not.toHaveBeenCalled()
    expect(test.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'fresh-main',
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
      agentOptions: { provider: 'provider-a', model: 'model-a' },
    }))
    expect(test.resolved).toEqual([undefined])
    expect(test.mounted).toEqual(['standard'])
    expect(typeof test.create.mock.calls[0]?.[0].setup).toBe('function')
    expect(test.exits).toEqual([])
  })

  it('resumes the exact persisted root through AgentRegistry, then mounts it', async () => {
    const test = bench(
      { id: SessionId('persisted-main'), resume: true },
      {
        agentPreset: 'standard',
        events: [{
          type: 'agent-preset/selected',
          seq: 0,
          time: 1,
          data: { agentPreset: 'minimal' },
        }],
      },
    )
    apply(test.ctx, {})
    await tick()
    expect(test.order).toEqual(['resume', 'preset:minimal', 'mount:persisted-main'])
    expect(test.create).not.toHaveBeenCalled()
    expect(test.resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: 'persisted-main',
      agentOptions: { provider: 'provider-a', model: 'model-a' },
    }))
    expect(typeof test.resume.mock.calls[0]?.[0].setup).toBe('function')
    expect(test.resolved).toEqual([])
    expect(test.mounted).toEqual(['minimal'])
    expect(test.exits).toEqual([])
  })

  it('pins unrestricted permission before publishing a yolo session', async () => {
    const test = bench({ id: SessionId('yolo-main'), resume: false }, {}, 'yolo')
    apply(test.ctx, {})
    await tick()
    expect(test.setPermission).toHaveBeenCalledWith(expect.any(Session), 'danger-full-access')
    expect(test.order).toEqual([
      'create',
      'permission:danger-full-access',
      'preset:standard',
      'mount:yolo-main',
    ])
    expect(test.exits).toEqual([])
  })

  it('fails before publication when yolo is unavailable', async () => {
    const test = bench({ id: SessionId('safe-only'), resume: false }, {}, 'yolo', null)
    let stderr = ''
    internals.stderr = { write: (chunk) => { stderr += chunk; return true } }
    apply(test.ctx, {})
    await tick()
    expect(test.order).toEqual(['create'])
    expect(stderr).toContain('--yolo is unavailable')
    expect(test.exits).toEqual([1])
  })

  it('pins workspace-only unattended permission before publishing a full-auto session', async () => {
    const test = bench({ id: SessionId('full-auto-main'), resume: false }, {}, 'full-auto')
    apply(test.ctx, {})
    await tick()
    expect(test.setPermission).toHaveBeenCalledWith(expect.any(Session), 'full-auto')
    expect(test.order).toEqual([
      'create',
      'permission:full-auto',
      'preset:standard',
      'mount:full-auto-main',
    ])
    expect(test.exits).toEqual([])
  })

  it('fails before publication when full-auto is unavailable', async () => {
    const test = bench({ id: SessionId('prompted-only'), resume: false }, {}, 'full-auto', 'danger-full-access', null)
    let stderr = ''
    internals.stderr = { write: (chunk) => { stderr += chunk; return true } }
    apply(test.ctx, {})
    await tick()
    expect(test.order).toEqual(['create'])
    expect(stderr).toContain('--full-auto is unavailable')
    expect(test.exits).toEqual([1])
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
    ctx.provide('tuiStartup', {
      identity: { id: SessionId('main'), resume: false },
      permissionMode: 'default',
    })
    expect(() => { apply(ctx, {}) }).toThrow('must provide ctx.appExit')
  })

  it('keeps the statically catalogued bundle schema aligned with renderer defaults', () => {
    expect(new Config({})).toEqual(new TuiConfigSchema({}))
    expect(new Config({})).toMatchObject({ showHardwareCursor: true })
    expect(new Config({ showReasoning: false, maxToolOutputLines: 9 })).toMatchObject({
      showReasoning: false,
      maxToolOutputLines: 9,
    })
    expect(() => new Config({ maxToolOutputLines: 0 })).toThrow()
  })
})
