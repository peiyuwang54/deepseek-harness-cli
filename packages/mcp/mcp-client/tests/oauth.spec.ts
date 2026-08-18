import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_OAUTH_REDIRECT_URL,
  PersistentOAuthClientProvider,
} from '@deepseek-ai/dsh-mcp-client/src/oauth.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('persistent MCP OAuth provider', () => {
  it('persists registration, PKCE, discovery, and tokens with private permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-oauth-'))
    roots.push(root)
    const statePath = join(root, 'auth', 'server.json')
    const provider = new PersistentOAuthClientProvider({ statePath })
    const state = provider.state()
    expect(provider.state()).toBe(state)
    provider.saveClientInformation({ client_id: 'client-1', client_secret: 'secret-1' })
    provider.saveCodeVerifier('verifier-1')
    expect(provider.codeVerifier()).toBe('verifier-1')
    const inProgress = new PersistentOAuthClientProvider({ statePath })
    expect(inProgress.codeVerifier()).toBe('verifier-1')
    expect(inProgress.state()).toBe(state)
    provider.saveDiscoveryState({ authorizationServerUrl: 'https://auth.example.test', resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource' })
    provider.saveTokens({
      access_token: 'access-1', token_type: 'Bearer', refresh_token: 'refresh-1', id_token: 'id-1', scope: 'read', expires_in: 3600,
    })

    const stored = await readFile(statePath, 'utf8')
    expect(stored).toContain('client-1')
    expect(stored).not.toContain('verifier-1')
    expect(stored).toContain('access-1')
    if (process.platform !== 'win32') expect((await stat(statePath)).mode & 0o777).toBe(0o600)

    const restored = new PersistentOAuthClientProvider({ statePath })
    expect(restored.redirectUrl).toBe(DEFAULT_OAUTH_REDIRECT_URL)
    expect(restored.state()).not.toBe(state)
    expect(restored.clientInformation()).toEqual({ client_id: 'client-1', client_secret: 'secret-1' })
    expect(restored.tokens()).toEqual({
      access_token: 'access-1', token_type: 'Bearer', refresh_token: 'refresh-1', id_token: 'id-1', scope: 'read', expires_in: 3600,
    })
    expect(restored.discoveryState()).toEqual({ authorizationServerUrl: 'https://auth.example.test', resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource' })
  })

  it('delivers authorization URLs and invalidates only the requested credential set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-oauth-'))
    roots.push(root)
    const statePath = join(root, 'state.json')
    const urls: URL[] = []
    const provider = new PersistentOAuthClientProvider({
      statePath,
      redirectUrl: 'https://client.example.test/oauth/callback',
      clientName: 'Test client',
      onAuthorizationUrl: (url) => { urls.push(url) },
    })
    await provider.redirectToAuthorization(new URL('https://auth.example.test/authorize?code_challenge=x'))
    provider.saveTokens({ access_token: 'access-1', token_type: 'Bearer' })
    expect(urls.map(url => url.toString())).toEqual(['https://auth.example.test/authorize?code_challenge=x'])
    expect(provider.tokens()).toEqual({ access_token: 'access-1', token_type: 'Bearer' })
    provider.invalidateCredentials('tokens')
    expect(provider.tokens()).toBeUndefined()
    expect(provider.clientMetadata).toMatchObject({
      redirect_uris: ['https://client.example.test/oauth/callback'],
      client_name: 'Test client',
    })
    await new PersistentOAuthClientProvider({ statePath: join(root, 'no-callback') }).redirectToAuthorization(new URL('https://auth.example.test/authorize'))
  })

  it('rejects malformed or mismatched state files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-oauth-'))
    roots.push(root)
    const statePath = join(root, 'state.json')
    await writeFile(statePath, JSON.stringify({ version: 1, redirectUrl: DEFAULT_OAUTH_REDIRECT_URL }))
    expect(() => new PersistentOAuthClientProvider({ statePath })).toThrow(/unsupported version/u)
    await writeFile(statePath, JSON.stringify({ version: 0, redirectUrl: 'http://127.0.0.1:1/callback' }))
    expect(() => new PersistentOAuthClientProvider({ statePath })).toThrow(/uses redirect URL/u)
  })

  it('rejects malformed OAuth fields and invalid redirect settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-oauth-'))
    roots.push(root)
    const statePath = join(root, 'state.json')
    const writeState = async (value: unknown): Promise<void> => {
      await writeFile(statePath, JSON.stringify(value))
    }
    await writeFile(statePath, '{')
    expect(() => new PersistentOAuthClientProvider({ statePath })).toThrow(/not valid JSON/u)
    for (const value of [null, [], 'text']) {
      await writeState(value)
      expect(() => new PersistentOAuthClientProvider({ statePath })).toThrow(/must contain an object/u)
    }
    expect(() => new PersistentOAuthClientProvider({ statePath: '' })).toThrow(/statePath/u)
    expect(() => new PersistentOAuthClientProvider({ statePath: join(root, 'bad'), redirectUrl: 'not-a-url' })).toThrow(/redirect URL/u)
    expect(() => new PersistentOAuthClientProvider({ statePath: join(root, 'bad'), redirectUrl: 'ftp://example.test/callback' })).toThrow(/http or https/u)

    const validBase = { version: 0, redirectUrl: DEFAULT_OAUTH_REDIRECT_URL }
    const malformed: readonly [unknown, RegExp][] = [
      [{ ...validBase, redirectUrl: '' }, /redirectUrl/u],
      [{ ...validBase, codeVerifier: '' }, /codeVerifier/u],
      [{ ...validBase, state: 1 }, /state/u],
      [{ ...validBase, clientInformation: null }, /clientInformation must be an object/u],
      [{ ...validBase, clientInformation: {} }, /clientInformation\.client_id/u],
      [{ ...validBase, clientInformation: { client_id: 'client', client_secret: '' } }, /client_secret/u],
      [{ ...validBase, tokens: null }, /tokens must be an object/u],
      [{ ...validBase, tokens: { access_token: '' } }, /tokens\.access_token/u],
      [{ ...validBase, tokens: { access_token: 'access' } }, /tokens\.token_type/u],
      [{ ...validBase, tokens: { access_token: 'access', token_type: 'Bearer', id_token: '' } }, /tokens\.id_token/u],
      [{ ...validBase, tokens: { access_token: 'access', token_type: 'Bearer', refresh_token: 1 } }, /tokens\.refresh_token/u],
      [{ ...validBase, tokens: { access_token: 'access', token_type: 'Bearer', scope: '' } }, /tokens\.scope/u],
      [{ ...validBase, tokens: { access_token: 'access', token_type: 'Bearer', expires_in: '3600' } }, /expires_in/u],
      [{ ...validBase, discoveryState: null }, /discoveryState must be an object/u],
      [{ ...validBase, discoveryState: {} }, /authorizationServerUrl/u],
      [{ ...validBase, discoveryState: { authorizationServerUrl: 'https://auth.example.test', resourceMetadataUrl: 1 } }, /resourceMetadataUrl/u],
    ]
    for (const [value, pattern] of malformed) {
      await writeState(value)
      expect(() => new PersistentOAuthClientProvider({ statePath })).toThrow(pattern)
    }
  })

  it('invalidates each durable credential scope and exposes the factory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-oauth-'))
    roots.push(root)
    const statePath = join(root, 'state.json')
    const provider = new PersistentOAuthClientProvider({ statePath })
    provider.saveClientInformation({ client_id: 'client' })
    provider.saveCodeVerifier('verifier')
    provider.state()
    provider.saveDiscoveryState({ authorizationServerUrl: 'https://auth.example.test' })
    provider.saveTokens({ access_token: 'access', token_type: 'Bearer' })
    provider.invalidateCredentials('client')
    expect(provider.clientInformation()).toBeUndefined()
    provider.invalidateCredentials('tokens')
    expect(provider.tokens()).toBeUndefined()
    provider.saveCodeVerifier('verifier')
    provider.state()
    provider.invalidateCredentials('verifier')
    expect(() => provider.codeVerifier()).toThrow(/code verifier/u)
    provider.invalidateCredentials('discovery')
    expect(provider.discoveryState()).toBeUndefined()
    provider.saveClientInformation({ client_id: 'client' })
    provider.invalidateCredentials('all')
    expect(provider.clientInformation()).toBeUndefined()
    expect(provider.discoveryState()).toBeUndefined()
    expect(provider.tokens()).toBeUndefined()
    const restored = new PersistentOAuthClientProvider({ statePath })
    expect(restored.state()).not.toBe('')
    const factory = (await import('@deepseek-ai/dsh-mcp-client/src/oauth.ts')).createPersistentOAuthClientProvider
    expect(factory({ statePath: join(root, 'factory.json') })).toBeInstanceOf(PersistentOAuthClientProvider)
  })

  it('cleans up failed atomic writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-oauth-'))
    roots.push(root)
    const directoryTarget = join(root, 'directory-target')
    const provider = new PersistentOAuthClientProvider({ statePath: directoryTarget })
    await mkdir(directoryTarget)
    expect(() => provider.state()).toThrow()
    const invalidPath = `${root}/invalid\u0000path`
    const invalidProvider = new PersistentOAuthClientProvider({ statePath: invalidPath })
    expect(() => invalidProvider.state()).toThrow()
  })
})
