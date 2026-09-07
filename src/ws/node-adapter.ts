import type { IncomingMessage } from 'node:http';
import { nanoid } from 'nanoid';
import { type WebSocket, WebSocketServer } from 'ws';
import type { NodeWebSocketAdapterOptions, WebSocketClient } from './types.js';

/**
 * Attaches a WebSocket server to a Node.js HTTP server for real-time bidirectional communication.
 *
 * NOTE: This adapter is designed for long-running Node.js process environments
 * (e.g. Node/Express/Hono standalone servers, Docker containers, VPS, PM2) and is
 * not intended for stateless AWS Lambda function deployments.
 *
 * @param options Adapter configuration including HTTP server instance and WebSocketGateway
 * @returns An object containing the underlying WebSocketServer instance and a cleanup close function
 *
 * @example
 * ```typescript
 * import { serve } from '@hono/node-server';
 * import { bootstrap } from 'glasswork';
 * import { createNodeWebSocketAdapter, WebSocketGateway } from 'glasswork/ws';
 *
 * const { app, container } = await bootstrap(AppModule);
 * const server = serve({ fetch: app.fetch, port: 3000 });
 * const wsGateway = container.resolve<WebSocketGateway>('wsGateway');
 *
 * createNodeWebSocketAdapter({
 *   server,
 *   gateway: wsGateway,
 *   path: '/ws',
 * });
 * ```
 */
export function createNodeWebSocketAdapter(options: NodeWebSocketAdapterOptions): {
  wss: WebSocketServer;
  close: () => Promise<void>;
} {
  const { server, gateway, path = '/ws' } = options;

  const wss = new WebSocketServer({
    server,
    path,
  });

  wss.on('connection', (rawSocket: WebSocket, request: IncomingMessage) => {
    const clientId = nanoid(12);

    const client: WebSocketClient = {
      id: clientId,
      get readyState() {
        return rawSocket.readyState;
      },
      rawSocket,
      request,
      data: {},
      send<T = unknown>(event: string, payload: T) {
        if (rawSocket.readyState === 1 /* OPEN */) {
          rawSocket.send(
            JSON.stringify({
              type: event,
              payload,
              timestamp: Date.now(),
            })
          );
        }
      },
      close(code = 1000, reason = 'Normal Closure') {
        rawSocket.close(code, reason);
      },
    };

    gateway.registerClient(client);

    rawSocket.on('close', () => {
      gateway.unregisterClient(clientId);
    });

    rawSocket.on('error', () => {
      gateway.unregisterClient(clientId);
    });

    // Send an initial connected handshake acknowledgment
    client.send('connected', {
      clientId,
      serverTime: Date.now(),
    });
  });

  const close = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return { wss, close };
}
