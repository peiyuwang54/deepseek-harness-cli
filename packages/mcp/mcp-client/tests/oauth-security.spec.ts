import { describe, expect, it, vi } from 'vitest'
import {
  createMcpOAuthFetch,
  McpOAuthSecurityError,
} from '@deepseek-ai/dsh-mcp-client/src/oauth-security.ts'

const publicLookup = vi.fn(async () => ['8.8.8.8'] as const)
type TestFetch = (url: string | URL, init?: RequestInit) => Promise<Response>

function response(status = 200, headers?: HeadersInit): Response {
  return new Response(null, { status, ...(headers === undefined ? {} : { headers }) })
}

describe('MCP OAuth network security', () => {
  it('rejects malformed, credentialed, non-HTTP, and insecure remote server URLs', () => {
    for (const url of ['not-a-url', 'ftp://mcp.example.test/mcp', 'https://user:secret@mcp.example.test/mcp']) {
      expect(() => createMcpOAuthFetch(url)).toThrow(McpOAuthSecurityError)
    }
    expect(() => createMcpOAuthFetch('http://mcp.example.test/mcp')).toThrow(/must use HTTPS/u)
  })

  it('allows the exact configured resource request and loopback development flow', async () => {
    const baseFetch = vi.fn(async () => response())
    const lookupAddresses = vi.fn(async () => ['127.0.0.1'])
    const secureFetch = createMcpOAuthFetch('http://127.0.0.2:3000/mcp', { fetch: baseFetch, lookupAddresses })

    await expect(secureFetch('http://127.0.0.2:3000/mcp')).resolves.toHaveProperty('status', 200)
    await expect(secureFetch('http://localhost:3001/token')).resolves.toHaveProperty('status', 200)
    expect(lookupAddresses).not.toHaveBeenCalled()
    expect(baseFetch).toHaveBeenCalledTimes(2)
  })

  it('uses public DNS results and fails closed for empty, private, and failed lookups', async () => {
    const baseFetch = vi.fn(async () => response())
    const target = 'https://auth.example.test/token'
    const secureFetch = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: baseFetch,
      lookupAddresses: publicLookup,
    })
    await expect(secureFetch(target)).resolves.toHaveProperty('status', 200)
    expect(publicLookup).toHaveBeenCalledWith('auth.example.test')

    for (const lookupAddresses of [
      vi.fn(async () => [] as string[]),
      vi.fn(async () => ['8.8.8.8', '10.0.0.1']),
      vi.fn(async () => { throw new Error('resolver down') }),
    ]) {
      const fetchWithLookup = createMcpOAuthFetch('https://mcp.example.test/mcp', {
        fetch: baseFetch,
        lookupAddresses,
      })
      await expect(fetchWithLookup(target)).rejects.toBeInstanceOf(McpOAuthSecurityError)
    }
  })

  it.each([
    'http://auth.example.test/token',
    'https://127.0.0.1/token',
    'https://10.0.0.1/token',
    'https://169.254.169.254/latest/meta-data',
    'https://198.18.0.1/token',
    'https://[::ffff:10.0.0.1]/token',
    'https://[ff02::1]/token',
  ])('rejects remote OAuth target %s', async (target) => {
    const baseFetch = vi.fn(async () => response())
    const secureFetch = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: baseFetch,
      lookupAddresses: publicLookup,
    })

    await expect(secureFetch(target)).rejects.toBeInstanceOf(McpOAuthSecurityError)
    expect(baseFetch).not.toHaveBeenCalled()
  })

  it('rejects invalid request URLs and URL credentials before fetch', async () => {
    const baseFetch = vi.fn(async () => response())
    const secureFetch = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: baseFetch,
      lookupAddresses: publicLookup,
    })
    for (const target of ['%', 'file:///tmp/token', 'https://user:secret@auth.example.test/token']) {
      await expect(secureFetch(target)).rejects.toBeInstanceOf(McpOAuthSecurityError)
    }
    expect(baseFetch).not.toHaveBeenCalled()
  })

  it('requires resource_metadata challenges to remain on the MCP origin', async () => {
    const differentOrigin = vi.fn(async () => response(401, {
      'WWW-Authenticate': 'Bearer resource_metadata="https://metadata.example.test/protected"',
    }))
    const rejected = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: differentOrigin,
      lookupAddresses: publicLookup,
    })
    await expect(rejected('https://mcp.example.test/mcp')).rejects.toThrow(/does not match MCP server origin/u)

    const relative = vi.fn(async () => response(401, {
      'WWW-Authenticate': 'Bearer scope="tools", resource_metadata=/.well-known/oauth-protected-resource',
    }))
    const accepted = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: relative,
      lookupAddresses: publicLookup,
    })
    await expect(accepted('https://mcp.example.test/mcp')).resolves.toHaveProperty('status', 401)
    expect(publicLookup).toHaveBeenCalledWith('mcp.example.test')
  })

  it('rejects malformed resource metadata challenge URLs', async () => {
    const baseFetch = vi.fn(async () => response(401, {
      'WWW-Authenticate': 'Bearer resource_metadata="http://["',
    }))
    const secureFetch = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: baseFetch,
      lookupAddresses: publicLookup,
    })
    await expect(secureFetch('https://mcp.example.test/mcp')).rejects.toThrow(/not a valid URL/u)
  })

  it('validates redirects, strips cross-origin secrets, and applies POST redirect semantics', async () => {
    const baseFetch = vi.fn<TestFetch>()
      .mockResolvedValueOnce(response(302, { Location: 'https://auth.example.test/token' }))
      .mockResolvedValueOnce(response())
    const secureFetch = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: baseFetch,
      lookupAddresses: publicLookup,
    })

    await secureFetch('https://mcp.example.test/mcp', {
      method: 'POST',
      body: 'secret body',
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
        'Proxy-Authorization': 'Basic secret',
        'Content-Type': 'application/json',
        'X-Public': 'kept',
      },
    })

    const redirected = baseFetch.mock.calls[1]!
    expect(String(redirected[0])).toBe('https://auth.example.test/token')
    expect(redirected[1]).toMatchObject({ method: 'GET', redirect: 'manual' })
    expect(redirected[1]?.body).toBeUndefined()
    const headers = new Headers(redirected[1]?.headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('proxy-authorization')).toBeNull()
    expect(headers.get('content-type')).toBeNull()
    expect(headers.get('x-public')).toBe('kept')
  })

  it('preserves same-origin redirect requests and returns redirects without a location', async () => {
    const baseFetch = vi.fn<TestFetch>()
      .mockResolvedValueOnce(response(307, { Location: '/mcp-v2' }))
      .mockResolvedValueOnce(response())
    const secureFetch = createMcpOAuthFetch('http://localhost:3000/mcp', { fetch: baseFetch })
    await secureFetch('http://localhost:3000/mcp', {
      method: 'POST',
      body: 'body',
      headers: { Authorization: 'Bearer local' },
    })
    expect(baseFetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: 'body' })
    expect(new Headers(baseFetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer local')

    const sameOriginGetFetch = vi.fn<TestFetch>()
      .mockResolvedValueOnce(response(303, { Location: '/mcp-v3' }))
      .mockResolvedValueOnce(response())
    const sameOriginGet = createMcpOAuthFetch('http://localhost:3000/mcp', { fetch: sameOriginGetFetch })
    await sameOriginGet('http://localhost:3000/mcp', {
      method: 'POST',
      body: 'body',
      headers: { Authorization: 'Bearer local', 'Content-Type': 'application/json' },
    })
    const sameOriginHeaders = new Headers(sameOriginGetFetch.mock.calls[1]?.[1]?.headers)
    expect(sameOriginGetFetch.mock.calls[1]?.[1]).toMatchObject({ method: 'GET' })
    expect(sameOriginHeaders.get('authorization')).toBe('Bearer local')
    expect(sameOriginHeaders.get('content-type')).toBeNull()

    const noLocationFetch = vi.fn(async () => response(302))
    const noLocation = createMcpOAuthFetch('http://localhost:3000/mcp', { fetch: noLocationFetch })
    await expect(noLocation('http://localhost:3000/mcp')).resolves.toHaveProperty('status', 302)
  })

  it('rejects malformed, private, and excessive redirect chains', async () => {
    const invalidLocation = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: vi.fn(async () => response(302, { Location: 'http://[' })),
      lookupAddresses: publicLookup,
    })
    await expect(invalidLocation('https://mcp.example.test/mcp')).rejects.toThrow(/redirect location/u)

    const privateLocation = createMcpOAuthFetch('https://mcp.example.test/mcp', {
      fetch: vi.fn(async () => response(302, { Location: 'http://169.254.169.254/latest' })),
      lookupAddresses: publicLookup,
    })
    await expect(privateLocation('https://mcp.example.test/mcp')).rejects.toBeInstanceOf(McpOAuthSecurityError)

    const cyclingFetch = vi.fn(async () => response(302, { Location: 'https://8.8.8.8/again' }))
    const cycling = createMcpOAuthFetch('https://mcp.example.test/mcp', { fetch: cyclingFetch })
    await expect(cycling('https://mcp.example.test/mcp')).rejects.toThrow(/exceeded 20 redirects/u)
    expect(cyclingFetch).toHaveBeenCalledTimes(21)
  })

  it('uses the production fetch default without performing work at construction', () => {
    expect(createMcpOAuthFetch('https://mcp.example.test/mcp')).toBeTypeOf('function')
  })
})
