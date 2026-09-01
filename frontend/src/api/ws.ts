/**
 * WebSocket client for live backend updates.
 *
 * Connects to the FastAPI /ws endpoint (same-origin; proxied by Vite in dev).
 * The server first sends a full latest-values snapshot and then streams update
 * events shaped exactly like the legacy spin-hmi `spinupdate` event detail:
 * { key, unit, state, state_str, value }.
 *
 * The client auto-reconnects with capped exponential backoff and fans events
 * out to registered handlers (store, plots, valve icons, ...).
 */

import type { LatestValues, UpdateEvent, WsServerMessage } from './types'

export type UpdateHandler = (update: UpdateEvent) => void
export type SnapshotHandler = (values: LatestValues) => void
export type ConnectionHandler = (connected: boolean) => void

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000

class LiveClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectDelay = RECONNECT_BASE_MS
  private started = false

  private updateHandlers = new Set<UpdateHandler>()
  private snapshotHandlers = new Set<SnapshotHandler>()
  private connectionHandlers = new Set<ConnectionHandler>()

  /** Start the connection if it is not running yet. Idempotent. */
  start(): void {
    if (this.started) return
    this.started = true
    this.connect()
  }

  stop(): void {
    this.started = false
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      this.socket.onclose = null
      this.socket.close()
      this.socket = null
    }
  }

  onUpdate(handler: UpdateHandler): () => void {
    this.updateHandlers.add(handler)
    return () => this.updateHandlers.delete(handler)
  }

  onSnapshot(handler: SnapshotHandler): () => void {
    this.snapshotHandlers.add(handler)
    return () => this.snapshotHandlers.delete(handler)
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler)
    return () => this.connectionHandlers.delete(handler)
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  private connect(): void {
    if (this.socket) {
      this.socket.onclose = null
      this.socket.close()
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`)
    this.socket = socket

    socket.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS
      this.emitConnection(true)
    }

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: WsServerMessage
      try {
        message = JSON.parse(event.data) as WsServerMessage
      } catch {
        return
      }
      if (message.type === 'snapshot') {
        this.snapshotHandlers.forEach((handler) => handler(message.values))
      } else if (message.type === 'update') {
        this.updateHandlers.forEach((handler) => handler(message.data))
      }
    }

    socket.onclose = () => {
      this.socket = null
      this.emitConnection(false)
      if (this.started) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelay)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
      }
    }

    socket.onerror = () => {
      // onclose follows and handles reconnection.
    }
  }

  private emitConnection(connected: boolean): void {
    this.connectionHandlers.forEach((handler) => handler(connected))
  }
}

/** Singleton live-update client shared by the whole application. */
export const liveClient = new LiveClient()
