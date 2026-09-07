import type { OnModuleDestroy, OnServerStart } from '../core/types.js';
import { createNodeWebSocketAdapter } from './node-adapter.js';
import type { WebSocketClient, WebSocketGatewayOptions, WebSocketMessage } from './types.js';

/**
 * Central gateway for managing active WebSocket connections and broadcasting typed events.
 *
 * Can be registered directly into the Glasswork Awilix DI container as a singleton service
 * and injected into any service/controller to push real-time updates.
 *
 * Automatically attaches to the HTTP server via the `OnServerStart` lifecycle hook when
 * `serveNodeApp` or `attachServer` is used.
 *
 * @example
 * ```typescript
 * export class NotificationService {
 *   constructor(private wsGateway: WebSocketGateway) {}
 *
 *   notifyPhotoProcessed(photoId: string) {
 *     this.wsGateway.broadcast('photo:processed', { photoId });
 *   }
 * }
 * ```
 */
export class WebSocketGateway implements OnModuleDestroy, OnServerStart {
  private clients = new Map<string, WebSocketClient>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs: number;
  private wsPath: string;
  private adapter: ReturnType<typeof createNodeWebSocketAdapter> | null = null;

  constructor(options?: WebSocketGatewayOptions & { path?: string }) {
    let interval = 30000;
    let path = '/ws';
    if (options && typeof options === 'object') {
      if (Object.hasOwn(options, 'heartbeatIntervalMs')) {
        interval = options.heartbeatIntervalMs ?? 30000;
      }
      if (Object.hasOwn(options, 'path')) {
        path = options.path ?? '/ws';
      }
    }
    this.heartbeatIntervalMs = interval;
    this.wsPath = path;
    this.startHeartbeat();
  }

  /**
   * Lifecycle hook called when the HTTP server starts listening.
   * Automatically attaches the WebSocket adapter to the server.
   */
  async onServerStart(server: unknown): Promise<void> {
    if (server && typeof server === 'object') {
      this.attachToServer(
        server as import('node:http').Server | import('node:events').EventEmitter,
        { path: this.wsPath }
      );
    }
  }

  /**
   * Attaches this gateway to a Node.js HTTP server instance.
   * Idempotent — calling multiple times returns the existing adapter.
   */
  attachToServer(
    server: import('node:http').Server | import('node:events').EventEmitter,
    options?: { path?: string }
  ) {
    if (this.adapter) {
      return this.adapter;
    }
    this.adapter = createNodeWebSocketAdapter({
      server,
      gateway: this,
      path: options?.path ?? this.wsPath,
    });
    return this.adapter;
  }

  /**
   * Registers an active client connection with the gateway.
   */
  registerClient(client: WebSocketClient): void {
    this.clients.set(client.id, client);
  }

  /**
   * Unregisters a disconnected client from the gateway.
   */
  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  /**
   * Returns a connected client by ID, or undefined if not found.
   */
  getClient(clientId: string): WebSocketClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Returns all currently connected clients.
   */
  getClients(): WebSocketClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * The total count of active WebSocket connections.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Broadcasts a typed event payload to all connected clients.
   *
   * @param event The event name identifier (e.g. 'thumbnails:status')
   * @param payload The serializable data payload
   */
  broadcast<T = unknown>(event: string, payload: T): void {
    const message: WebSocketMessage<T> = {
      type: event,
      payload,
      timestamp: Date.now(),
    };

    const serialized = JSON.stringify(message);

    for (const client of this.clients.values()) {
      if (client.readyState === 1 /* OPEN */) {
        try {
          client.rawSocket.send(serialized);
        } catch {
          // If sending fails, the socket close handler will clean it up
        }
      }
    }
  }

  /**
   * Sends a typed event payload to a specific connected client.
   *
   * @param clientId Target client ID
   * @param event The event name identifier
   * @param payload The serializable data payload
   */
  sendTo<T = unknown>(clientId: string, event: string, payload: T): boolean {
    const client = this.clients.get(clientId);
    if (client?.readyState !== 1 /* OPEN */) {
      return false;
    }

    try {
      client.send(event, payload);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Closes all connected client sockets and cleans up resources.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopHeartbeat();

    if (this.adapter) {
      await this.adapter.close().catch(() => {});
      this.adapter = null;
    }

    for (const client of this.clients.values()) {
      try {
        client.close(1001, 'Server shutting down');
      } catch {
        // ignore errors during shutdown
      }
    }
    this.clients.clear();
  }

  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients.values()) {
        if (client.readyState === 1 /* OPEN */) {
          try {
            client.rawSocket.ping();
          } catch {
            this.clients.delete(client.id);
          }
        } else if (client.readyState !== 0 /* CONNECTING */) {
          this.clients.delete(client.id);
        }
      }
    }, this.heartbeatIntervalMs);

    // Prevent heartbeat from holding Node.js process alive if everything else exits
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
