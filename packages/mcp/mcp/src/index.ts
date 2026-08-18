/**
 * Runtime registry for MCP server status and lifecycle controls.
 *
 * MCP transports are Service Providers. Human-facing diagnostics are
 * Consumers. The registry keeps those roles independent of the concrete MCP
 * client and gives each provider registration the owning Cordis fiber's
 * lifetime.
 *
 * @module @deepseek-ai/dsh-mcp
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** Transport families supported by the shipped MCP client. */
export type McpTransport = 'stdio' | 'streamable-http'

/** Observable state of one configured MCP server connection. */
export type McpConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed'

/** Provider-owned connection data detached for diagnostics consumers. */
export interface McpConnectionStatus {
  /** Current connection lifecycle state. */
  readonly state: McpConnectionState
  /** Number of tools in the last registry generation owned by this server. */
  readonly toolCount: number
  /** Consecutive reconnect attempts spent in the current outage. */
  readonly reconnectAttempt: number
  /** Maximum reconnect attempts configured for one outage. */
  readonly maxReconnectAttempts: number
}

/** Immutable server snapshot returned by {@link McpRegistry.list}. */
export interface McpServerStatus extends McpConnectionStatus {
  /** Stable server namespace. */
  readonly name: string
  /** Configured transport family. */
  readonly transport: McpTransport
}

/** Runtime contribution from one concrete MCP client instance. */
export interface McpServerRuntime {
  /** Stable server namespace, unique across active registrations. */
  readonly name: string
  /** Configured transport family. */
  readonly transport: McpTransport
  /** Read the current provider-owned connection state. */
  readonly status: () => McpConnectionStatus
  /** Close any current generation and make one immediate connection attempt. */
  readonly reload: () => Promise<boolean>
}

/** Result of one server selected by {@link McpRegistry.reload}. */
export interface McpReloadResult {
  /** Stable server namespace. */
  readonly name: string
  /** Whether the immediate replacement connection and tool sync succeeded. */
  readonly reloaded: boolean
  /** State observed after the immediate attempt settled. */
  readonly status: McpServerStatus
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Active MCP server connections and their lifecycle controls. */
    mcp: McpRegistry
  }
}

/** Effect-scoped registry of active MCP server runtimes. */
export class McpRegistry extends Service {
  private readonly servers = new Map<string, McpServerRuntime>()

  constructor(ctx: Context) {
    super(ctx, 'mcp')
  }

  /**
   * Register one concrete MCP server runtime for the calling plugin's lifetime.
   * @param server - Borrowed runtime status and reload controls.
   * @returns The exact effect disposer that removes this server.
   */
  register(server: McpServerRuntime): () => void {
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return this.ctx.effect(() => {
      if (this.servers.has(server.name)) {
        throw new Error(`mcp: server "${server.name}" is already registered`)
      }
      this.servers.set(server.name, server)
      return () => {
        if (this.servers.get(server.name) === server) this.servers.delete(server.name)
      }
    }, 'mcp.register()')
  }

  /**
   * Snapshot every active server in stable name order.
   * @returns Fresh status objects detached from provider state.
   */
  list(): McpServerStatus[] {
    return [...this.servers.values()]
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(server => this.snapshot(server))
  }

  /**
   * Immediately reconnect one server or every active server. Distinct servers
   * reload concurrently; each provider serializes its own generations.
   * @param name - Exact server namespace, or omission to select every server.
   * @returns Stable-name results after all immediate attempts settle.
   */
  async reload(name?: string): Promise<McpReloadResult[]> {
    const selected = name === undefined
      ? [...this.servers.values()]
      : [this.require(name)]
    const results = await Promise.all(selected.map(async (server): Promise<McpReloadResult> => {
      let reloaded = false
      try {
        reloaded = await server.reload()
      } catch (error) {
        this.ctx.logger.error(`mcp(${server.name}): manual reload failed: ${String(error)}`)
      }
      return { name: server.name, reloaded, status: this.snapshot(server) }
    }))
    return results.toSorted((left, right) => left.name.localeCompare(right.name))
  }

  /** Return one active server or fail the human-addressed operation loudly. */
  private require(name: string): McpServerRuntime {
    const server = this.servers.get(name)
    if (server === undefined) throw new Error(`mcp: unknown server "${name}"`)
    return server
  }

  /** Copy a provider status while pinning registry-owned identity fields. */
  private snapshot(server: McpServerRuntime): McpServerStatus {
    return { name: server.name, transport: server.transport, ...server.status() }
  }
}

export default McpRegistry
