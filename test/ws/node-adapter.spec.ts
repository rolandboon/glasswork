import EventEmitter from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createNodeWebSocketAdapter } from '../../src/ws/node-adapter.js';
import { WebSocketGateway } from '../../src/ws/websocket-gateway.js';

describe('createNodeWebSocketAdapter', () => {
  it('creates adapter and registers client connections on connection event', async () => {
    const mockServer = new EventEmitter();
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 0 });

    const adapter = createNodeWebSocketAdapter({
      server: mockServer,
      gateway,
      path: '/ws',
    });

    expect(adapter.wss).toBeDefined();

    // Create a mock raw socket
    const mockRawSocket = new EventEmitter() as EventEmitter & {
      readyState: number;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    mockRawSocket.readyState = 1; // OPEN
    mockRawSocket.send = vi.fn();
    mockRawSocket.close = vi.fn();

    const mockRequest = { headers: { host: 'localhost:3000' } };

    // Emit connection event on wss
    adapter.wss.emit('connection', mockRawSocket, mockRequest);

    // Client should now be registered with gateway
    expect(gateway.clientCount).toBe(1);
    const client = gateway.getClients()[0];
    expect(client).toBeDefined();
    expect(client.readyState).toBe(1);
    expect(client.request).toBe(mockRequest);

    // Initial 'connected' message should have been sent
    expect(mockRawSocket.send).toHaveBeenCalledTimes(1);
    const initialMsg = JSON.parse(mockRawSocket.send.mock.calls[0][0]);
    expect(initialMsg.type).toBe('connected');
    expect(initialMsg.payload.clientId).toBe(client.id);

    // Test client.send
    client.send('custom:event', { hello: 'world' });
    expect(mockRawSocket.send).toHaveBeenCalledTimes(2);
    const customMsg = JSON.parse(mockRawSocket.send.mock.calls[1][0]);
    expect(customMsg.type).toBe('custom:event');
    expect(customMsg.payload).toEqual({ hello: 'world' });

    // Test client.close
    client.close(1000, 'Done');
    expect(mockRawSocket.close).toHaveBeenCalledWith(1000, 'Done');

    // Emit close event on raw socket -> unregisters client
    mockRawSocket.emit('close');
    expect(gateway.clientCount).toBe(0);

    await adapter.close();
  });

  it('unregisters client on socket error', async () => {
    const mockServer = new EventEmitter();
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 0 });

    const adapter = createNodeWebSocketAdapter({
      server: mockServer,
      gateway,
    });

    const mockRawSocket = new EventEmitter() as EventEmitter & {
      readyState: number;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    mockRawSocket.readyState = 1;
    mockRawSocket.send = vi.fn();
    mockRawSocket.close = vi.fn();

    adapter.wss.emit('connection', mockRawSocket, {});
    expect(gateway.clientCount).toBe(1);

    mockRawSocket.emit('error', new Error('Connection reset'));
    expect(gateway.clientCount).toBe(0);

    await adapter.close();
  });
});
