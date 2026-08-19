import { describe, expect, it, vi } from 'vitest'

const clientConstructor = vi.hoisted(() => vi.fn())

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: clientConstructor,
}))

import { probeMcpConnection } from '@deepseek-ai/dsh-mcp-client/src/probe.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const config: Config = {
  transport: 'stdio',
  serverName: 'probe',
  command: process.execPath,
  args: [],
  env: {},
  cwd: '',
  toolCallTimeoutMs: 60_000,
  failOnStartupError: false,
}

describe('probeMcpConnection', () => {
  it('accepts a server without Tools and closes it', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      getServerCapabilities: vi.fn(() => undefined),
      listTools: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    clientConstructor.mockImplementationOnce(class {
      readonly connect = client.connect
      readonly getServerCapabilities = client.getServerCapabilities
      readonly listTools = client.listTools
      readonly close = client.close
    } as unknown as () => typeof client)

    await expect(probeMcpConnection(config, 1234)).resolves.toEqual({ toolCount: 0 })

    expect(client.connect).toHaveBeenCalledWith(expect.anything(), { timeout: 1234 })
    expect(client.listTools).not.toHaveBeenCalled()
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('drains every advertised Tools page and tolerates an already-closed client', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      getServerCapabilities: vi.fn(() => ({ tools: {} })),
      listTools: vi.fn()
        .mockResolvedValueOnce({ tools: [{ name: 'first' }], nextCursor: 'page-2' })
        .mockResolvedValueOnce({ tools: [{ name: 'second' }, { name: 'third' }] }),
      close: vi.fn().mockRejectedValue(new Error('already closed')),
    }
    clientConstructor.mockImplementationOnce(class {
      readonly connect = client.connect
      readonly getServerCapabilities = client.getServerCapabilities
      readonly listTools = client.listTools
      readonly close = client.close
    } as unknown as () => typeof client)

    await expect(probeMcpConnection(config, 4321)).resolves.toEqual({ toolCount: 3 })

    expect(client.listTools).toHaveBeenNthCalledWith(1, undefined, { timeout: 4321 })
    expect(client.listTools).toHaveBeenNthCalledWith(2, { cursor: 'page-2' }, { timeout: 4321 })
    expect(client.close).toHaveBeenCalledOnce()
  })
})
