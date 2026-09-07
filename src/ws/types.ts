import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';

/**
 * Structured WebSocket message envelope sent over the wire.
 */
export interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
}

/**
 * Representation of a connected WebSocket client in Glasswork.
 */
export interface WebSocketClient {
  id: string;
  readyState: number;
  rawSocket: WebSocket;
  request?: IncomingMessage;
  send<T = unknown>(event: string, payload: T): void;
  close(code?: number, reason?: string): void;
  data: Record<string, unknown>;
}

/**
 * Options for configuring the WebSocketGateway.
 */
export interface WebSocketGatewayOptions {
  /**
   * Heartbeat ping interval in milliseconds.
   * Defaults to 30000 (30 seconds). Set to 0 to disable.
   */
  heartbeatIntervalMs?: number;
}

/**
 * Options for attaching a Node.js WebSocket server to an existing HTTP server.
 *
 * NOTE: This adapter is designed for long-running Node.js process environments
 * (e.g. Node/Express/Hono standalone servers, Docker containers, VPS) and is
 * not intended for stateless AWS Lambda function deployments.
 */
export interface NodeWebSocketAdapterOptions {
  /**
   * The Node.js http.Server (or https.Server) instance to bind WebSocket upgrades to.
   */
  // biome-ignore lint/suspicious/noExplicitAny: standard Node HTTP Server
  server: any;

  /**
   * The WebSocketGateway instance that will manage connections and broadcasts.
   */
  gateway: import('./websocket-gateway.js').WebSocketGateway;

  /**
   * Path on which WebSocket connections are accepted.
   * Defaults to '/ws'.
   */
  path?: string;
}
