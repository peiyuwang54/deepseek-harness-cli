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

/** MCP resource advertised by one connected server. */
export interface McpResource {
  readonly uri: string
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mimeType?: string
  readonly size?: number
}

/** URI template advertised by one connected server. */
export interface McpResourceTemplate {
  readonly uriTemplate: string
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mimeType?: string
}

/** Prompt definition advertised by one connected server. */
export interface McpPrompt {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly arguments?: readonly McpPromptArgument[]
}

/** One optional argument accepted by an MCP prompt. */
export interface McpPromptArgument {
  readonly name: string
  readonly description?: string
  readonly required?: boolean
}

/** Resource and URI-template discovery result for one server. */
export interface McpResourceCatalog {
  readonly resources: readonly McpResource[]
  readonly templates: readonly McpResourceTemplate[]
}

/** Prompt discovery result for one server. */
export interface McpPromptCatalog {
  readonly prompts: readonly McpPrompt[]
}

/** Content returned by an MCP `resources/read` request. */
export interface McpResourceContent {
  readonly uri: string
  readonly mimeType?: string
  readonly text?: string
  readonly blob?: string
}

/** Prompt message returned by an MCP `prompts/get` request. */
export interface McpPromptMessage {
  readonly role: 'user' | 'assistant'
  readonly content: unknown
}

/** Result returned by an MCP `prompts/get` request. */
export interface McpPromptExpansion {
  readonly description?: string
  readonly messages: readonly McpPromptMessage[]
}

/** Discovery result tagged with the server that produced it. */
export interface McpServerResourceCatalog extends McpResourceCatalog {
  readonly name: string
}

/** Prompt discovery result tagged with the server that produced it. */
export interface McpServerPromptCatalog extends McpPromptCatalog {
  readonly name: string
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
  /** Discover resources and URI templates, if this server advertises them. */
  readonly resources?: () => Promise<McpResourceCatalog>
  /** Discover prompts, if this server advertises them. */
  readonly prompts?: () => Promise<McpPromptCatalog>
  /** Read one concrete resource URI. */
  readonly readResource?: (uri: string) => Promise<readonly McpResourceContent[]>
  /** Expand one named prompt with optional string arguments. */
  readonly getPrompt?: (name: string, arguments_?: Readonly<Record<string, string>>) => Promise<McpPromptExpansion>
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
    const dispose = this.ctx.effect(() => {
      if (this.servers.has(server.name)) {
        throw new Error(`mcp: server "${server.name}" is already registered`)
      }
      this.servers.set(server.name, server)
      return () => {
        if (this.servers.get(server.name) === server) this.servers.delete(server.name)
      }
    }, 'mcp.register()')
    return () => { void dispose() }
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

  /**
   * Discover resources and URI templates for one server or every active server.
   * @param name - Exact server namespace, or omission to select every server.
   * @returns Stable-name catalogs containing resources and URI templates.
   */
  async resources(name?: string): Promise<McpServerResourceCatalog[]> {
    const selected = this.select(name)
    const results = await Promise.all(selected.map(async (server) => {
      if (server.resources === undefined) throw new Error(`mcp: server "${server.name}" does not expose resources`)
      const catalog = await server.resources()
      return { name: server.name, resources: catalog.resources, templates: catalog.templates }
    }))
    return results.toSorted((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Discover prompts for one server or every active server.
   * @param name - Exact server namespace, or omission to select every server.
   * @returns Stable-name catalogs containing prompt definitions.
   */
  async prompts(name?: string): Promise<McpServerPromptCatalog[]> {
    const selected = this.select(name)
    const results = await Promise.all(selected.map(async (server) => {
      if (server.prompts === undefined) throw new Error(`mcp: server "${server.name}" does not expose prompts`)
      const catalog = await server.prompts()
      return { name: server.name, prompts: catalog.prompts }
    }))
    return results.toSorted((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Read one resource from a named active server.
   * @param name - Exact server namespace.
   * @param uri - Concrete resource URI to read.
   * @returns Text or base64 content returned by the server.
   */
  async readResource(name: string, uri: string): Promise<readonly McpResourceContent[]> {
    const server = this.require(name)
    if (server.readResource === undefined) throw new Error(`mcp: server "${name}" does not expose resources`)
    return await server.readResource(uri)
  }

  /**
   * Expand one prompt from a named active server.
   * @param name - Exact server namespace.
   * @param prompt - Prompt name advertised by the server.
   * @param arguments_ - String arguments passed to the prompt.
   * @returns Messages and optional description returned by the server.
   */
  async getPrompt(
    name: string,
    prompt: string,
    arguments_: Readonly<Record<string, string>> = {},
  ): Promise<McpPromptExpansion> {
    const server = this.require(name)
    if (server.getPrompt === undefined) throw new Error(`mcp: server "${name}" does not expose prompts`)
    return await server.getPrompt(prompt, arguments_)
  }

  /** Return one active server or fail the human-addressed operation loudly. */
  private require(name: string): McpServerRuntime {
    const server = this.servers.get(name)
    if (server === undefined) throw new Error(`mcp: unknown server "${name}"`)
    return server
  }

  /** Select active runtimes while keeping unknown names loud. */
  private select(name: string | undefined): McpServerRuntime[] {
    return name === undefined ? [...this.servers.values()] : [this.require(name)]
  }

  /** Copy a provider status while pinning registry-owned identity fields. */
  private snapshot(server: McpServerRuntime): McpServerStatus {
    return { name: server.name, transport: server.transport, ...server.status() }
  }
}

export default McpRegistry
