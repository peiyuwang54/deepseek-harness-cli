/** Host-side WebSocket carrier for the two server-to-browser event streams. */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import type {
  ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

type Frame = MuxFrame | HostFrame

/** Default interval between Host WebSocket liveness probes. */
export const DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS = 30_000

/** Default consecutive unanswered probes tolerated before termination. */
export const DEFAULT_WEBSOCKET_MISSED_HEARTBEAT_LIMIT = 2

/** Resolved Host WebSocket liveness policy. */
export interface WebSocketHeartbeatOptions {
  /** Interval between liveness probes. */
  heartbeatIntervalMs: number
  /** Consecutive unanswered probes tolerated before termination. */
  missedHeartbeatLimit: number
}

function serverRequest(frame: RpcRequest<Frame>): ServerRequest {
  return {
    type: 'server-request',
    rpcId: frame.rpcId,
    method: frame.payload.type,
    payload: frame.payload,
  }
}

function send(socket: WebSocket, frame: RpcRequest<Frame>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error('websocket downlink closed before frame delivery'))
      return
    }
    socket.send(JSON.stringify(serverRequest(frame)), (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function failureFrame(error: unknown): RpcRequest<Frame> {
  return {
    rpcId: RpcId(randomUUID()),
    payload: {
      type: 'stream/error',
      error: { code: 'internal', message: String(error), details: {} },
    },
  }
}

/**
 * Owns WebSocket negotiation and frame pumping for the connection plugin's
 * two downlinks. Client messages are a protocol violation: upstream traffic
 * remains on HTTP.
 */
export class WebSocketDownlinks {
  private readonly server = new WebSocketServer({ noServer: true })
  private readonly pumps = new Set<Promise<void>>()
  private readonly missedHeartbeats = new WeakMap<WebSocket, number>()
  private readonly finalHeartbeatChecks = new Set<NodeJS.Immediate>()
  private heartbeatTimer: NodeJS.Timeout | undefined

  /**
   * @param api - host API supplying the typed event streams.
   * @param heartbeat - resolved liveness policy.
   */
  constructor(
    private readonly api: ApiProxy,
    private readonly heartbeat: WebSocketHeartbeatOptions = {
      heartbeatIntervalMs: DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS,
      missedHeartbeatLimit: DEFAULT_WEBSOCKET_MISSED_HEARTBEAT_LIMIT,
    },
  ) {}

  /**
   * Upgrade one socket and pump the mux stream until either side closes.
   * @param req - HTTP upgrade request.
   * @param socket - Raw socket transferred by the HTTP server.
   * @param head - Bytes already read after the upgrade headers.
   */
  handleMux(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.upgrade(req, socket, head, signal => this.api.events.mux({
      rpcId: RpcId(randomUUID()),
      payload: {},
    }, signal))
  }

  /**
   * Upgrade one socket and pump the host stream until either side closes.
   * @param req - HTTP upgrade request.
   * @param socket - Raw socket transferred by the HTTP server.
   * @param head - Bytes already read after the upgrade headers.
   */
  handleHost(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.upgrade(req, socket, head, signal => this.api.events.host({
      rpcId: RpcId(randomUUID()),
      payload: {},
    }, signal))
  }

  /**
   * Terminate owned sockets and await the no-server acceptor plus frame pumps.
   * @returns A promise resolving after every socket and source iterator stops.
   */
  async close(): Promise<void> {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
    for (const check of this.finalHeartbeatChecks) clearImmediate(check)
    this.finalHeartbeatChecks.clear()
    for (const socket of this.server.clients) socket.terminate()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    await Promise.all(this.pumps)
  }

  private upgrade<F extends Frame>(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    open: (signal: AbortSignal) => AsyncIterable<RpcRequest<F>>,
  ): void {
    this.server.handleUpgrade(req, socket, head, (websocket) => {
      const abort = new AbortController()
      this.missedHeartbeats.set(websocket, 0)
      websocket.on('pong', () => { this.missedHeartbeats.set(websocket, 0) })
      this.startHeartbeat()
      websocket.once('close', () => { abort.abort() })
      websocket.once('error', () => { abort.abort() })
      websocket.once('message', () => {
        websocket.close(1008, 'downlink only')
      })
      const pump = this.pump(websocket, open(abort.signal), abort)
      this.pumps.add(pump)
      void pump.then(() => { this.pumps.delete(pump) })
    })
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) return
    this.heartbeatTimer = setInterval(() => {
      for (const socket of this.server.clients) {
        if (socket.readyState !== WebSocket.OPEN) continue
        const missed = this.missedHeartbeats.get(socket) as number
        if (missed >= this.heartbeat.missedHeartbeatLimit) {
          const check = setImmediate(() => {
            this.finalHeartbeatChecks.delete(check)
            if (socket.readyState === WebSocket.OPEN
              && (this.missedHeartbeats.get(socket) as number) >= this.heartbeat.missedHeartbeatLimit) {
              socket.terminate()
            }
          })
          this.finalHeartbeatChecks.add(check)
          continue
        }
        this.missedHeartbeats.set(socket, missed + 1)
        socket.ping()
      }
    }, this.heartbeat.heartbeatIntervalMs)
    this.heartbeatTimer.unref()
  }

  private async pump<F extends Frame>(
    socket: WebSocket,
    frames: AsyncIterable<RpcRequest<F>>,
    abort: AbortController,
  ): Promise<void> {
    try {
      for await (const frame of frames) await send(socket, frame)
    } catch (error) {
      if (!abort.signal.aborted) {
        try {
          await send(socket, failureFrame(error))
        } catch {
          // Socket loss won the race; no downstream remains to receive the failure frame.
        }
      }
    } finally {
      abort.abort()
      if (socket.readyState === WebSocket.OPEN) socket.close()
    }
  }
}

/**
 * Reject an untrusted upgrade before protocol negotiation.
 * @param socket - Raw HTTP socket that remains owned by the caller.
 */
export function rejectWebSocketUpgrade(socket: Duplex): void {
  socket.end([
    'HTTP/1.1 403 Forbidden',
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Length: 9',
    '',
    'forbidden',
  ].join('\r\n'))
}
