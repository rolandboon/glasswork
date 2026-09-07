/**
 * Glasswork WebSocket Subsystem
 *
 * Provides real-time bidirectional communication and event broadcasting
 * for long-running Node.js process deployments.
 *
 * @packageDocumentation
 */

export { createNodeWebSocketAdapter } from './node-adapter.js';
export type {
  NodeWebSocketAdapterOptions,
  WebSocketClient,
  WebSocketGatewayOptions,
  WebSocketMessage,
} from './types.js';
export { WebSocketGateway } from './websocket-gateway.js';
