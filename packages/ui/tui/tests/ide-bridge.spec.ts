import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdeBridge, IdeBridgeError } from '../src/chat/ide-bridge.ts'

function requestUrl(url: RequestInfo | URL): string {
  if (typeof url === 'string') return url
  if (url instanceof URL) return url.toString()
  return url.url
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('IDE bridge client', () => {
  it('is absent without an endpoint and rejects non-http schemes', () => {
    expect(createIdeBridge({})).toBeUndefined()
    expect(() => createIdeBridge({ DSH_IDE_BRIDGE_URL: 'file:///tmp/bridge' })).toThrow(IdeBridgeError)
  })

  it('reads context and validates diagnostics and selections', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
      workspace: '/workspace/project',
      file: '/workspace/project/src/main.ts',
      selection: { start: { line: 2, column: 1 }, end: { line: 2, column: 8 } },
      diagnostics: [{ severity: 'error', message: 'type mismatch', path: 'src/main.ts', line: 2, column: 1, source: 'ts' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const bridge = createIdeBridge({ DSH_IDE_BRIDGE_URL: 'http://127.0.0.1:4567/bridge', DSH_IDE_BRIDGE_TOKEN: 'secret' })
    await expect(bridge?.context()).resolves.toEqual({
      workspace: '/workspace/project',
      file: '/workspace/project/src/main.ts',
      selection: { start: { line: 2, column: 1 }, end: { line: 2, column: 8 } },
      diagnostics: [{ severity: 'error', message: 'type mismatch', path: 'src/main.ts', line: 2, column: 1, source: 'ts' }],
    })
    const [input, init] = fetch.mock.calls[0] ?? []
    if (input === undefined) throw new Error('fetch was not called')
    expect(requestUrl(input)).toBe('http://127.0.0.1:4567/bridge/context')
    expect(init).toMatchObject({
      method: 'GET',
      headers: { authorization: 'Bearer secret' },
    })
  })

  it('opens files, displays diffs, and accepts a displayed diff', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'diff-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const bridge = createIdeBridge({ DSH_IDE_BRIDGE_URL: 'http://127.0.0.1:4567/' })
    if (bridge === undefined) throw new Error('bridge was not created')
    await bridge.open('src/main.ts', { line: 2, column: 4 })
    await expect(bridge.showDiff('@@ -1 +1 @@\n-old\n+new\n')).resolves.toEqual({ id: 'diff-1' })
    await bridge.acceptDiff('diff-1')
    const requests = fetch.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>
    expect(requests.map(([url, init]) => [requestUrl(url), init])).toEqual([
      ['http://127.0.0.1:4567/open', expect.objectContaining({ method: 'POST', body: JSON.stringify({ path: 'src/main.ts', line: 2, column: 4 }) })],
      ['http://127.0.0.1:4567/diff', expect.objectContaining({ method: 'POST', body: JSON.stringify({ patch: '@@ -1 +1 @@\n-old\n+new\n' }) })],
      ['http://127.0.0.1:4567/diff/diff-1/accept', expect.objectContaining({ method: 'POST' })],
    ])
  })

  it('fails loudly for malformed bridge responses and non-success status', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('{bad', { status: 200 }))
      .mockResolvedValueOnce(new Response('denied', { status: 403 }))
    vi.stubGlobal('fetch', fetch)
    const bridge = createIdeBridge({ DSH_IDE_BRIDGE_URL: 'http://127.0.0.1:4567' })
    if (bridge === undefined) throw new Error('bridge was not created')
    await expect(bridge.context()).rejects.toThrow('returned invalid JSON')
    await expect(bridge.context()).rejects.toThrow('HTTP 403')
  })
})
