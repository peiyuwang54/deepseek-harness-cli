/** Bounded MCP connectivity probe shared by boot-free diagnostics. */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createTransport } from './transport.ts'
import type { Config } from './index.ts'

/** Successful connectivity evidence returned by {@link probeMcpConnection}. */
export interface McpProbeResult {
  /** Number of tools advertised across every `tools/list` page. */
  readonly toolCount: number
}

/**
 * Connect to one MCP server, complete tool discovery when advertised, and close it.
 * @param config - Fully resolved MCP client transport configuration.
 * @param timeoutMs - Maximum time for each initialize or list request.
 * @returns Connectivity evidence without retaining a client or transport.
 */
export async function probeMcpConnection(config: Config, timeoutMs: number): Promise<McpProbeResult> {
  const client = new Client(
    { name: 'dsh-doctor', version: '0.0.1' },
    { capabilities: {} },
  )
  try {
    await client.connect(createTransport(config), { timeout: timeoutMs })
    if (client.getServerCapabilities()?.tools === undefined) return { toolCount: 0 }
    let cursor: string | undefined
    let toolCount = 0
    do {
      const response = await client.listTools(
        cursor === undefined ? undefined : { cursor },
        { timeout: timeoutMs },
      )
      toolCount += response.tools.length
      cursor = response.nextCursor
    } while (cursor !== undefined)
    return { toolCount }
  } finally {
    try {
      await client.close()
    } catch {
      // A failed initialize may leave the SDK client already closed.
    }
  }
}
