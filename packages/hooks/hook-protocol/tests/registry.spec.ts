import { Context } from '@deepseek-ai/cordis'
import HookRegistry, { hookCatalogPoints } from '@deepseek-ai/dsh-hook-protocol'
import { describe, expect, it } from 'vitest'

describe('hook registry', () => {
  it('projects parsed matcher groups without empty events', () => {
    expect(hookCatalogPoints({
      SessionStart: [{ hooks: [{ command: 'node start.mjs' }] }],
      PreToolUse: [{ matcher: 'bash|read', hooks: [{ command: 'node guard.mjs', timeoutSec: 30 }] }],
      Stop: [{ hooks: [] }],
    })).toEqual([
      {
        point: 'SessionStart',
        groups: [{ handlers: [{ command: 'node start.mjs' }] }],
      },
      {
        point: 'PreToolUse',
        groups: [{ matcher: 'bash|read', handlers: [{ command: 'node guard.mjs', timeoutSec: 30 }] }],
      },
    ])
  })

  it('lists active bridge contributions and removes them with the caller', async () => {
    const ctx = new Context()
    await ctx.plugin(HookRegistry)
    const provider = ctx.inject(['hooks'], (providerCtx) => {
      providerCtx.hooks.register({
        dialect: 'codex',
        configPath: '/workspace/.codex/hooks.json',
        points: [{
          point: 'PreToolUse',
          groups: [{ handlers: [{ command: 'node guard.mjs' }] }],
        }],
        skipped: [{ point: 'Stop', reason: 'async hook' }],
      })
    })
    await provider

    expect(ctx.hooks.list()).toEqual([{
      dialect: 'codex',
      configPath: '/workspace/.codex/hooks.json',
      handlerCount: 1,
      points: [{
        point: 'PreToolUse',
        groups: [{ handlers: [{ command: 'node guard.mjs' }] }],
      }],
      skipped: [{ point: 'Stop', reason: 'async hook' }],
    }])

    await provider.dispose()
    expect(ctx.hooks.list()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('retains multiple bridge instances of the same dialect', async () => {
    const ctx = new Context()
    await ctx.plugin(HookRegistry)
    const first = ctx.hooks.register({
      dialect: 'claude-code',
      configPath: '/one/hooks.json',
      points: [],
      skipped: [],
    })
    const second = ctx.hooks.register({
      dialect: 'claude-code',
      configPath: '/two/hooks.json',
      points: [],
      skipped: [],
    })

    expect(ctx.hooks.list().map(source => source.configPath)).toEqual([
      '/one/hooks.json',
      '/two/hooks.json',
    ])
    first()
    expect(ctx.hooks.list().map(source => source.configPath)).toEqual(['/two/hooks.json'])
    second()
    await ctx.fiber.dispose()
  })
})
