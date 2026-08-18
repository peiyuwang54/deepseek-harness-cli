/** Persistent OAuth 2.1 client state for Streamable HTTP MCP servers. */

import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

/** Loopback callback used by the boot-free `deepseek mcp auth` command. */
export const DEFAULT_OAUTH_REDIRECT_URL = 'http://127.0.0.1:19876/oauth/callback'

const STATE_VERSION = 0

interface StoredOAuthState {
  readonly version: 0
  readonly redirectUrl: string
  readonly clientInformation?: OAuthClientInformationMixed
  readonly tokens?: OAuthTokens
  readonly codeVerifier?: string
  readonly state?: string
  readonly discoveryState?: OAuthDiscoveryState
}

/** Options for {@link PersistentOAuthClientProvider}. */
export interface PersistentOAuthClientProviderOptions {
  /** File that stores client registration, PKCE, discovery, and token state. */
  readonly statePath: string
  /** Loopback or registered callback URL. */
  readonly redirectUrl?: string
  /** Called when the provider starts an interactive authorization flow. */
  readonly onAuthorizationUrl?: (url: URL) => void | Promise<void>
  /** Human-readable client name sent during dynamic registration. */
  readonly clientName?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`MCP OAuth ${label} must be a non-empty string`)
  return value
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`MCP OAuth ${label} must be an object`)
  return value
}

function parseClientInformation(value: unknown): OAuthClientInformationMixed | undefined {
  const object = optionalRecord(value, 'clientInformation')
  if (object === undefined) return undefined
  requiredString(object.client_id, 'clientInformation.client_id')
  if (object.client_secret !== undefined) requiredString(object.client_secret, 'clientInformation.client_secret')
  return object as OAuthClientInformationMixed
}

function parseTokens(value: unknown): OAuthTokens | undefined {
  const object = optionalRecord(value, 'tokens')
  if (object === undefined) return undefined
  requiredString(object.access_token, 'tokens.access_token')
  requiredString(object.token_type, 'tokens.token_type')
  if (object.id_token !== undefined) requiredString(object.id_token, 'tokens.id_token')
  if (object.refresh_token !== undefined) requiredString(object.refresh_token, 'tokens.refresh_token')
  if (object.scope !== undefined) requiredString(object.scope, 'tokens.scope')
  if (object.expires_in !== undefined && typeof object.expires_in !== 'number') {
    throw new Error('MCP OAuth tokens.expires_in must be a number')
  }
  return object as OAuthTokens
}

function parseDiscoveryState(value: unknown): OAuthDiscoveryState | undefined {
  const object = optionalRecord(value, 'discoveryState')
  if (object === undefined) return undefined
  requiredString(object.authorizationServerUrl, 'discoveryState.authorizationServerUrl')
  if (object.resourceMetadataUrl !== undefined) requiredString(object.resourceMetadataUrl, 'discoveryState.resourceMetadataUrl')
  return object as unknown as OAuthDiscoveryState
}

function emptyState(redirectUrl: string): StoredOAuthState {
  return { version: STATE_VERSION, redirectUrl }
}

function readState(path: string, redirectUrl: string): StoredOAuthState {
  if (!existsSync(path)) return emptyState(redirectUrl)
  let decoded: unknown
  try {
    decoded = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`MCP OAuth state ${path} is not valid JSON`, { cause: error })
  }
  if (!isRecord(decoded)) throw new Error(`MCP OAuth state ${path} must contain an object`)
  if (decoded.version !== STATE_VERSION) throw new Error(`MCP OAuth state ${path} has unsupported version ${JSON.stringify(decoded.version)}`)
  const storedRedirectUrl = requiredString(decoded.redirectUrl, 'redirectUrl')
  if (storedRedirectUrl !== redirectUrl) {
    throw new Error(`MCP OAuth state ${path} uses redirect URL ${JSON.stringify(storedRedirectUrl)}; expected ${JSON.stringify(redirectUrl)}`)
  }
  if (decoded.codeVerifier !== undefined) requiredString(decoded.codeVerifier, 'codeVerifier')
  if (decoded.state !== undefined) requiredString(decoded.state, 'state')
  const clientInformation = parseClientInformation(decoded.clientInformation)
  const tokens = parseTokens(decoded.tokens)
  const discoveryState = parseDiscoveryState(decoded.discoveryState)
  return {
    version: STATE_VERSION,
    redirectUrl,
    ...(clientInformation === undefined ? {} : { clientInformation }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(decoded.codeVerifier === undefined ? {} : { codeVerifier: requiredString(decoded.codeVerifier, 'codeVerifier') }),
    ...(decoded.state === undefined ? {} : { state: requiredString(decoded.state, 'state') }),
    ...(discoveryState === undefined ? {} : { discoveryState }),
  }
}

function writeState(path: string, state: StoredOAuthState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* the failed write may not have created a temp file */ }
    throw error
  }
}

function validateRedirectUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch (error) {
    throw new Error(`MCP OAuth redirect URL ${JSON.stringify(raw)} is invalid`, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('MCP OAuth redirect URL must use http or https')
  return url.toString()
}

/**
 * File-backed implementation of the MCP SDK's OAuth provider contract.
 * Tokens and registration data never enter the managed MCP catalog or logs.
 */
export class PersistentOAuthClientProvider implements OAuthClientProvider {
  readonly clientMetadata: OAuthClientMetadata
  private readonly statePath: string
  private readonly redirectUrlValue: string
  private readonly onAuthorizationUrl: ((url: URL) => void | Promise<void>) | undefined
  private stateData: StoredOAuthState

  constructor(options: PersistentOAuthClientProviderOptions) {
    if (options.statePath.length === 0) throw new Error('MCP OAuth statePath must be a non-empty string')
    this.statePath = options.statePath
    this.redirectUrlValue = validateRedirectUrl(options.redirectUrl ?? DEFAULT_OAUTH_REDIRECT_URL)
    this.onAuthorizationUrl = options.onAuthorizationUrl
    this.stateData = readState(this.statePath, this.redirectUrlValue)
    this.clientMetadata = {
      redirect_uris: [this.redirectUrlValue],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      client_name: options.clientName ?? 'DeepSeek Harness CLI',
      software_id: 'deepseek-harness-cli',
      software_version: '0.1.0',
    }
  }

  /** Callback URL used in the authorization request. */
  get redirectUrl(): string { return this.redirectUrlValue }

  /** Read the registered client, if one has already been persisted. */
  clientInformation(): OAuthClientInformationMixed | undefined { return this.stateData.clientInformation }

  /** Persist dynamic client registration information. */
  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.update({ clientInformation })
  }

  /** Read access and refresh tokens without exposing them to callers that do not need them. */
  tokens(): OAuthTokens | undefined { return this.stateData.tokens }

  /** Persist newly issued tokens and discard one-time PKCE state. */
  saveTokens(tokens: OAuthTokens): void {
    this.update({ tokens, codeVerifier: undefined, state: undefined })
  }

  /** Deliver the authorization URL to the CLI or another interactive consumer. */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.onAuthorizationUrl?.(authorizationUrl)
  }

  /** Persist the PKCE verifier generated by the SDK. */
  saveCodeVerifier(codeVerifier: string): void {
    this.update({ codeVerifier })
  }

  /** Read the PKCE verifier for the authorization-code exchange. */
  codeVerifier(): string {
    const verifier = this.stateData.codeVerifier
    if (verifier === undefined) throw new Error('MCP OAuth code verifier is not available; start authorization again')
    return verifier
  }

  /** Persist a state value so a loopback callback can reject a mismatched response. */
  state(): string {
    const state = this.stateData.state ?? randomBytes(24).toString('base64url')
    if (state !== this.stateData.state) this.update({ state })
    return state
  }

  /**
   * Persist RFC 9728/RFC 8414 discovery results for later connections.
   * @param discoveryState - Discovery metadata returned by the MCP SDK.
   */
  saveDiscoveryState(discoveryState: OAuthDiscoveryState): void {
    this.update({ discoveryState })
  }

  /** Reuse discovery results between CLI auth and normal profile startup. */
  discoveryState(): OAuthDiscoveryState | undefined { return this.stateData.discoveryState }

  /** Remove selected durable credentials after an OAuth error or explicit recovery. */
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') {
      this.stateData = emptyState(this.redirectUrlValue)
    } else if (scope === 'client') {
      this.update({ clientInformation: undefined })
      return
    } else if (scope === 'tokens') {
      this.update({ tokens: undefined })
      return
    } else if (scope === 'verifier') {
      this.update({ codeVerifier: undefined, state: undefined })
      return
    } else {
      this.update({ discoveryState: undefined })
      return
    }
    writeState(this.statePath, this.stateData)
  }

  private update(patch: OAuthStatePatch): void {
    const next = { ...this.stateData }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) Reflect.deleteProperty(next, key)
      else Reflect.set(next, key, value)
    }
    this.stateData = next
    writeState(this.statePath, next)
  }
}

type OAuthStatePatch = {
  -readonly [Key in Exclude<keyof StoredOAuthState, 'version' | 'redirectUrl'>]?: StoredOAuthState[Key] | undefined
}

/**
 * Create a persistent provider for a Streamable HTTP MCP connection.
 * @param options - State-file and callback settings.
 * @returns A file-backed OAuth provider.
 */
export function createPersistentOAuthClientProvider(
  options: PersistentOAuthClientProviderOptions,
): PersistentOAuthClientProvider {
  return new PersistentOAuthClientProvider(options)
}
