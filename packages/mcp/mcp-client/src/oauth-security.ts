/** Network-target validation for MCP OAuth HTTP requests. */

import { lookup } from 'node:dns/promises'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import ipaddr from 'ipaddr.js'

const MAX_REDIRECTS = 20
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const BENCHMARK_RANGE = ipaddr.parseCIDR('198.18.0.0/15')
const RESOURCE_METADATA_PATTERN = /(?:^|[\s,])resource_metadata=(?:"([^"]+)"|([^\s,]+))/iu

type LookupAddresses = (hostname: string) => Promise<readonly string[]>

interface McpOAuthFetchDependencies {
  readonly fetch?: FetchLike
  readonly lookupAddresses?: LookupAddresses
}

/** OAuth endpoint rejected before the network request leaves the process. */
export class McpOAuthSecurityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'McpOAuthSecurityError'
  }
}

function normalizedHostname(hostname: string): string {
  const unbracketed = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  return unbracketed.toLowerCase()
}

function parsedAddress(hostname: string): ipaddr.IPv4 | ipaddr.IPv6 | undefined {
  const normalized = normalizedHostname(hostname)
  if (!ipaddr.isValid(normalized)) return undefined
  const address = ipaddr.parse(normalized)
  if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) return address.toIPv4Address()
  return address
}

function isLoopbackHost(hostname: string): boolean {
  if (normalizedHostname(hostname) === 'localhost') return true
  return parsedAddress(hostname)?.range() === 'loopback'
}

function isBlockedAddress(address: string): boolean {
  const parsed = parsedAddress(address)
  if (parsed === undefined) return normalizedHostname(address) === 'localhost'
  if (parsed.kind() === 'ipv4' && parsed.match(BENCHMARK_RANGE)) return true
  return parsed.range() !== 'unicast'
}

async function defaultLookupAddresses(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true })).map(result => result.address)
}

function parseHttpUrl(raw: string | URL, label: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    throw new McpOAuthSecurityError(`${label} is not a valid URL`, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new McpOAuthSecurityError(`${label} must use HTTP or HTTPS`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new McpOAuthSecurityError(`${label} must not contain credentials`)
  }
  return url
}

async function validateOAuthTarget(
  target: URL,
  allowLoopback: boolean,
  lookupAddresses: LookupAddresses,
): Promise<void> {
  const loopback = isLoopbackHost(target.hostname)
  if (target.protocol !== 'https:' && !(allowLoopback && loopback)) {
    throw new McpOAuthSecurityError(
      `MCP OAuth endpoint ${JSON.stringify(target.toString())} must use HTTPS unless the configured MCP server is loopback`,
    )
  }
  if (loopback) {
    if (!allowLoopback) {
      throw new McpOAuthSecurityError(
        `MCP OAuth endpoint ${JSON.stringify(target.toString())} must not target loopback from a remote MCP server`,
      )
    }
    return
  }

  if (isBlockedAddress(target.hostname)) {
    throw new McpOAuthSecurityError(
      `MCP OAuth endpoint ${JSON.stringify(target.toString())} targets a private or reserved address`,
    )
  }

  let addresses: readonly string[]
  try {
    addresses = await lookupAddresses(normalizedHostname(target.hostname))
  } catch (error) {
    throw new McpOAuthSecurityError(
      `MCP OAuth endpoint host ${JSON.stringify(target.hostname)} could not be resolved`,
      { cause: error },
    )
  }
  if (addresses.length === 0) {
    throw new McpOAuthSecurityError(
      `MCP OAuth endpoint host ${JSON.stringify(target.hostname)} resolved to no addresses`,
    )
  }
  const blocked = addresses.find(isBlockedAddress)
  if (blocked !== undefined) {
    throw new McpOAuthSecurityError(
      `MCP OAuth endpoint ${JSON.stringify(target.toString())} resolves to private or reserved address ${JSON.stringify(blocked)}`,
    )
  }
}

function redirectedInit(init: RequestInit | undefined, status: number, crossedOrigin: boolean): RequestInit {
  const next: RequestInit = { ...init, redirect: 'manual' }
  const method = init?.method?.toUpperCase() ?? 'GET'
  if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
    next.method = 'GET'
    delete next.body
  }
  if (crossedOrigin || next.method === 'GET') {
    const headers = new Headers(init?.headers)
    if (crossedOrigin) {
      headers.delete('authorization')
      headers.delete('cookie')
      headers.delete('proxy-authorization')
    }
    if (next.method === 'GET') {
      headers.delete('content-encoding')
      headers.delete('content-language')
      headers.delete('content-length')
      headers.delete('content-location')
      headers.delete('content-type')
    }
    next.headers = headers
  }
  return next
}

async function validateResourceMetadataChallenge(
  response: Response,
  serverUrl: URL,
  allowLoopback: boolean,
  lookupAddresses: LookupAddresses,
): Promise<void> {
  const header = response.headers.get('www-authenticate')
  const match = header?.match(RESOURCE_METADATA_PATTERN)
  const raw = match?.[1] ?? match?.[2]
  if (raw === undefined) return
  let metadataUrl: URL
  try {
    metadataUrl = new URL(raw, serverUrl)
  } catch (error) {
    throw new McpOAuthSecurityError('MCP OAuth resource_metadata challenge is not a valid URL', { cause: error })
  }
  if (metadataUrl.origin !== serverUrl.origin) {
    throw new McpOAuthSecurityError(
      `MCP OAuth resource_metadata origin ${JSON.stringify(metadataUrl.origin)} does not match MCP server origin ${JSON.stringify(serverUrl.origin)}`,
    )
  }
  await validateOAuthTarget(metadataUrl, allowLoopback, lookupAddresses)
}

/**
 * Create the fetch implementation used by one OAuth-enabled MCP transport.
 * The configured resource request remains explicit user input. Every OAuth
 * discovery, registration, token, refresh, and redirect target is validated
 * for scheme, origin where required, literal addresses, and DNS results.
 * @param rawServerUrl - Configured Streamable HTTP MCP resource URL.
 * @param dependencies - Test-only network primitives; production uses global fetch and DNS lookup.
 * @returns A fetch function suitable for `StreamableHTTPClientTransport`.
 */
export function createMcpOAuthFetch(
  rawServerUrl: string | URL,
  dependencies: McpOAuthFetchDependencies = {},
): FetchLike {
  const serverUrl = parseHttpUrl(rawServerUrl, 'MCP OAuth server URL')
  const allowLoopback = isLoopbackHost(serverUrl.hostname)
  if (serverUrl.protocol !== 'https:' && !allowLoopback) {
    throw new McpOAuthSecurityError('An OAuth-enabled remote MCP server must use HTTPS')
  }
  const baseFetch = dependencies.fetch ?? globalThis.fetch
  const lookupAddresses = dependencies.lookupAddresses ?? defaultLookupAddresses

  return async (input, initialInit) => {
    let target = parseHttpUrl(input, 'MCP OAuth request URL')
    let init: RequestInit = { ...initialInit, redirect: 'manual' }
    for (let redirects = 0; ; redirects += 1) {
      const configuredResourceRequest = redirects === 0 && target.toString() === serverUrl.toString()
      if (!configuredResourceRequest) await validateOAuthTarget(target, allowLoopback, lookupAddresses)
      const response = await baseFetch(target, init)
      await validateResourceMetadataChallenge(response, serverUrl, allowLoopback, lookupAddresses)
      if (!REDIRECT_STATUSES.has(response.status)) return response
      if (redirects >= MAX_REDIRECTS) throw new McpOAuthSecurityError(`MCP OAuth request exceeded ${MAX_REDIRECTS} redirects`)
      const location = response.headers.get('location')
      if (location === null) return response
      let redirected: URL
      try {
        redirected = new URL(location, target)
      } catch (error) {
        throw new McpOAuthSecurityError('MCP OAuth redirect location is not a valid URL', { cause: error })
      }
      init = redirectedInit(init, response.status, redirected.origin !== target.origin)
      target = redirected
    }
  }
}
