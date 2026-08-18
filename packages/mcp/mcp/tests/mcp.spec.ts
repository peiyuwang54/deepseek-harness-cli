import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import McpRegistry, {
  type McpConnectionStatus,
  type McpServerRuntime,
} from '@deepseek-ai/dsh-mcp'

function runtime(
  name: string,
  options: {
    state?: McpConnectionStatus['state']
    reload?: () => Promise<boolean>
    resources?: McpServerRuntime['resources']
    prompts?: McpServerRuntime['prompts']
    readResource?: McpServerRuntime['readResource']
    getPrompt?: McpServerRuntime['getPrompt']
  } = {},
): McpServerRuntime {
  return {
    name,
    transport: 'stdio',
    status: () => ({
      state: options.state ?? 'connected',
      toolCount: 2,
      reconnectAttempt: 0,
      maxReconnectAttempts: 10,
    }),
    reload: options.reload ?? (async () => true),
    ...options.resources === undefined ? {} : { resources: options.resources },
    ...options.prompts === undefined ? {} : { prompts: options.prompts },
    ...options.readResource === undefined ? {} : { readResource: options.readResource },
    ...options.getPrompt === undefined ? {} : { getPrompt: options.getPrompt },
  }
}

describe('McpRegistry', () => {
  it('lists effect-scoped registrations in stable order', async () => {
    const ctx = new Context()
    await ctx.plugin(McpRegistry)
    const zeta = ctx.mcp.register(runtime('zeta'))
    ctx.mcp.register(runtime('alpha', { state: 'reconnecting' }))

    expect(ctx.mcp.list()).toEqual([
      {
        name: 'alpha', transport: 'stdio', state: 'reconnecting', toolCount: 2,
        reconnectAttempt: 0, maxReconnectAttempts: 10,
      },
      {
        name: 'zeta', transport: 'stdio', state: 'connected', toolCount: 2,
        reconnectAttempt: 0, maxReconnectAttempts: 10,
      },
    ])

    zeta()
    expect(ctx.mcp.list().map(server => server.name)).toEqual(['alpha'])
  })

  it('rejects duplicate live names without removing the winner', async () => {
    const ctx = new Context()
    await ctx.plugin(McpRegistry)
    ctx.mcp.register(runtime('same'))

    expect(() => ctx.mcp.register(runtime('same'))).toThrow('server "same" is already registered')
    expect(ctx.mcp.list().map(server => server.name)).toEqual(['same'])
  })

  it('reloads all servers concurrently and reports each immediate outcome', async () => {
    const ctx = new Context()
    await ctx.plugin(McpRegistry)
    const first: PromiseWithResolvers<boolean> = Promise.withResolvers()
    const second: PromiseWithResolvers<boolean> = Promise.withResolvers()
    const firstReload = vi.fn(() => first.promise)
    const secondReload = vi.fn(() => second.promise)
    ctx.mcp.register(runtime('first', { reload: firstReload }))
    ctx.mcp.register(runtime('second', { state: 'failed', reload: secondReload }))

    const reloading = ctx.mcp.reload()
    expect(firstReload).toHaveBeenCalledOnce()
    expect(secondReload).toHaveBeenCalledOnce()
    first.resolve(true)
    second.resolve(false)

    await expect(reloading).resolves.toMatchObject([
      { name: 'first', reloaded: true, status: { state: 'connected' } },
      { name: 'second', reloaded: false, status: { state: 'failed' } },
    ])
  })

  it('selects one server, rejects unknown names, and contains provider throws', async () => {
    const ctx = new Context()
    await ctx.plugin(McpRegistry)
    const reload = vi.fn(async () => { throw new Error('broken') })
    ctx.mcp.register(runtime('only', { state: 'failed', reload }))

    await expect(ctx.mcp.reload('only')).resolves.toMatchObject([
      { name: 'only', reloaded: false, status: { state: 'failed' } },
    ])
    expect(reload).toHaveBeenCalledOnce()
    await expect(ctx.mcp.reload('missing')).rejects.toThrow('unknown server "missing"')
  })

  it('discovers resources and prompts through the owning runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(McpRegistry)
    ctx.mcp.register(runtime('docs', {
      resources: async () => ({ resources: [{ uri: 'file:///README.md', name: 'README' }], templates: [] }),
      prompts: async () => ({ prompts: [{ name: 'summarize' }] }),
      readResource: async () => [{ uri: 'file:///README.md', text: 'hello' }],
      getPrompt: async () => ({ messages: [{ role: 'user', content: 'hello' }] }),
    }))

    await expect(ctx.mcp.resources()).resolves.toEqual([{
      name: 'docs', resources: [{ uri: 'file:///README.md', name: 'README' }], templates: [],
    }])
    await expect(ctx.mcp.prompts('docs')).resolves.toEqual([{ name: 'docs', prompts: [{ name: 'summarize' }] }])
    await expect(ctx.mcp.readResource('docs', 'file:///README.md')).resolves.toEqual([{ uri: 'file:///README.md', text: 'hello' }])
    await expect(ctx.mcp.getPrompt('docs', 'summarize')).resolves.toEqual({ messages: [{ role: 'user', content: 'hello' }] })
    await expect(ctx.mcp.resources('missing')).rejects.toThrow('unknown server "missing"')
  })
})
