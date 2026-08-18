/** Shared HTTP bridge used by `/ide` in VS Code-compatible terminals. */

const MAX_RESPONSE_BYTES = 1_048_576
const DEFAULT_TIMEOUT_MS = 5_000

/** One zero-based editor position. */
export interface IdePosition {
  readonly line: number
  readonly column: number
}

/** The current editor selection, including a collapsed caret. */
interface IdeSelection {
  readonly start: IdePosition
  readonly end: IdePosition
}

/** One diagnostic reported by the editor bridge. */
interface IdeDiagnostic {
  readonly severity: 'error' | 'warning' | 'info' | 'hint'
  readonly message: string
  readonly path?: string
  readonly line?: number
  readonly column?: number
  readonly source?: string
}

/** Current editor state returned by the bridge. */
export interface IdeContext {
  readonly workspace?: string
  readonly file?: string
  readonly selection?: IdeSelection
  readonly diagnostics: readonly IdeDiagnostic[]
}

/** Receipt returned after an editor accepts a displayed diff. */
interface IdeDiffReceipt {
  readonly id: string
  readonly accepted?: boolean
}

/** The operations a configured bridge exposes to the terminal. */
export interface IdeBridgeClient {
  /** Base URL used for bridge requests. */
  readonly endpoint: string
  /** Read the active file, selection, workspace, and diagnostics. */
  context(signal?: AbortSignal): Promise<IdeContext>
  /** Ask the editor to open a file at an optional zero-based position. */
  open(path: string, position?: IdePosition, signal?: AbortSignal): Promise<void>
  /** Show a unified diff in the editor and return its bridge-owned id. */
  showDiff(patch: string, signal?: AbortSignal): Promise<IdeDiffReceipt>
  /** Accept a previously displayed diff by id. */
  acceptDiff(id: string, signal?: AbortSignal): Promise<void>
}

/** Create a bridge client from `DSH_IDE_BRIDGE_URL`; absent configuration returns `undefined`. */
export function createIdeBridge(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): IdeBridgeClient | undefined {
  const raw = environment.DSH_IDE_BRIDGE_URL?.trim()
  if (raw === undefined || raw === '') return undefined
  const endpoint = parseEndpoint(raw)
  const token = environment.DSH_IDE_BRIDGE_TOKEN?.trim()
  return new HttpIdeBridge(endpoint, token === undefined || token === '' ? undefined : token)
}

/** Error raised for malformed bridge configuration or a rejected bridge response. */
export class IdeBridgeError extends Error {
  /** @param message - Human-readable bridge failure. */
  constructor(message: string) {
    super(message)
    this.name = 'IdeBridgeError'
  }
}

function parseEndpoint(raw: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(raw)
  } catch (error) {
    throw new IdeBridgeError(`DSH_IDE_BRIDGE_URL is not a valid URL: ${String(error)}`)
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new IdeBridgeError('DSH_IDE_BRIDGE_URL must use http or https')
  }
  if (!endpoint.pathname.endsWith('/')) endpoint.pathname += '/'
  endpoint.hash = ''
  endpoint.search = ''
  return endpoint.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new IdeBridgeError(`IDE bridge returned a non-string ${field}`)
  return value
}

function position(value: unknown, field: string): IdePosition {
  const line = isRecord(value) ? value.line : undefined
  const column = isRecord(value) ? value.column : undefined
  if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 0
    || typeof column !== 'number' || !Number.isSafeInteger(column) || column < 0) {
    throw new IdeBridgeError(`IDE bridge returned an invalid ${field}`)
  }
  return { line, column }
}

function parseSelection(value: unknown): IdeSelection | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new IdeBridgeError('IDE bridge returned an invalid selection')
  return {
    start: position(value.start, 'selection.start'),
    end: position(value.end, 'selection.end'),
  }
}

function parseDiagnostic(value: unknown, index: number): IdeDiagnostic {
  if (!isRecord(value) || typeof value.message !== 'string') {
    throw new IdeBridgeError(`IDE bridge returned an invalid diagnostic at index ${String(index)}`)
  }
  const severity = value.severity === undefined ? 'info' : value.severity
  if (severity !== 'error' && severity !== 'warning' && severity !== 'info' && severity !== 'hint') {
    throw new IdeBridgeError(`IDE bridge returned an invalid diagnostic severity at index ${String(index)}`)
  }
  const lineValue = value.line
  const columnValue = value.column
  const line = lineValue === undefined ? undefined : typeof lineValue === 'number' && Number.isSafeInteger(lineValue) && lineValue >= 0 ? lineValue : null
  const column = columnValue === undefined ? undefined : typeof columnValue === 'number' && Number.isSafeInteger(columnValue) && columnValue >= 0 ? columnValue : null
  if (line === null || column === null) {
    throw new IdeBridgeError(`IDE bridge returned an invalid diagnostic position at index ${String(index)}`)
  }
  const path = optionalString(value.path, `diagnostics[${String(index)}].path`)
  const source = optionalString(value.source, `diagnostics[${String(index)}].source`)
  return {
    severity,
    message: value.message,
    ...path === undefined ? {} : { path },
    ...line === undefined ? {} : { line },
    ...column === undefined ? {} : { column },
    ...source === undefined ? {} : { source },
  }
}

function parseContext(value: unknown): IdeContext {
  if (!isRecord(value)) throw new IdeBridgeError('IDE bridge returned a non-object context')
  if (value.diagnostics !== undefined && (!Array.isArray(value.diagnostics))) {
    throw new IdeBridgeError('IDE bridge returned a non-array diagnostics field')
  }
  const diagnostics = (value.diagnostics ?? []).map((item, index) => parseDiagnostic(item, index))
  const workspace = optionalString(value.workspace, 'workspace')
  const file = optionalString(value.file, 'file')
  const selection = parseSelection(value.selection)
  return {
    ...workspace === undefined ? {} : { workspace },
    ...file === undefined ? {} : { file },
    ...selection === undefined ? {} : { selection },
    diagnostics,
  }
}

function parseReceipt(value: unknown): IdeDiffReceipt {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim() === '') {
    throw new IdeBridgeError('IDE bridge returned an invalid diff receipt')
  }
  if (value.accepted !== undefined && typeof value.accepted !== 'boolean') {
    throw new IdeBridgeError('IDE bridge returned a non-boolean diff receipt')
  }
  return { id: value.id, ...value.accepted === undefined ? {} : { accepted: value.accepted } }
}

class HttpIdeBridge implements IdeBridgeClient {
  constructor(readonly endpoint: string, private readonly token: string | undefined) {}

  async context(signal?: AbortSignal): Promise<IdeContext> {
    return parseContext(await this.request('context', undefined, signal))
  }

  async open(path: string, position_: IdePosition | undefined, signal?: AbortSignal): Promise<void> {
    await this.request('open', { path, ...position_ === undefined ? {} : position_ }, signal)
  }

  async showDiff(patch: string, signal?: AbortSignal): Promise<IdeDiffReceipt> {
    return parseReceipt(await this.request('diff', { patch }, signal))
  }

  async acceptDiff(id: string, signal?: AbortSignal): Promise<void> {
    await this.request(`diff/${encodeURIComponent(id)}/accept`, {}, signal)
  }

  private async request(path: string, body: Record<string, unknown> | undefined, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(new Error(`IDE bridge request timed out after ${String(DEFAULT_TIMEOUT_MS)} ms`)) }, DEFAULT_TIMEOUT_MS)
    const forwardAbort = (): void => { controller.abort(signal?.reason) }
    signal?.addEventListener('abort', forwardAbort, { once: true })
    try {
      const response = await fetch(new URL(path, this.endpoint), {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          accept: 'application/json',
          ...body === undefined ? {} : { 'content-type': 'application/json' },
          ...this.token === undefined ? {} : { authorization: `Bearer ${this.token}` },
        },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        signal: controller.signal,
      })
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new IdeBridgeError(`IDE bridge response exceeds ${String(MAX_RESPONSE_BYTES)} bytes`)
      }
      if (!response.ok) throw new IdeBridgeError(`IDE bridge ${path} failed with HTTP ${String(response.status)}: ${text.slice(0, 400)}`)
      if (text.trim() === '') return {}
      try {
        return JSON.parse(text) as unknown
      } catch (error) {
        throw new IdeBridgeError(`IDE bridge ${path} returned invalid JSON: ${String(error)}`)
      }
    } catch (error) {
      if (error instanceof IdeBridgeError) throw error
      throw new IdeBridgeError(`IDE bridge ${path} failed: ${String(error)}`)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }
}
