import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketClient } from '../../src/ws/types.js';
import { WebSocketGateway } from '../../src/ws/websocket-gateway.js';

describe('WebSocketGateway', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with default options and handles proxy objects safely', () => {
    const gateway1 = new WebSocketGateway();
    expect(gateway1.clientCount).toBe(0);

    const gateway2 = new WebSocketGateway({ heartbeatIntervalMs: 5000 });
    expect(gateway2.clientCount).toBe(0);
    gateway2.onModuleDestroy();
  });

  it('registers and unregisters clients correctly', () => {
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 0 });
    const mockSocket = {
      send: vi.fn(),
      close: vi.fn(),
      ping: vi.fn(),
    };

    const client: WebSocketClient = {
      id: 'client-1',
      readyState: 1,
      rawSocket: mockSocket as unknown as import('ws').WebSocket,
      data: { userId: 'u-123' },
      send: vi.fn(),
      close: vi.fn(),
    };

    gateway.registerClient(client);
    expect(gateway.clientCount).toBe(1);
    expect(gateway.getClient('client-1')).toBe(client);
    expect(gateway.getClients()).toEqual([client]);

    gateway.unregisterClient('client-1');
    expect(gateway.clientCount).toBe(0);
    expect(gateway.getClient('client-1')).toBeUndefined();
    expect(gateway.getClients()).toEqual([]);
  });

  it('broadcasts messages to all open clients and ignores non-open or errored sockets', () => {
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 0 });

    const openSocket = { send: vi.fn() };
    const throwingSocket = {
      send: vi.fn().mockImplementation(() => {
        throw new Error('Socket write error');
      }),
    };
    const closedSocket = { send: vi.fn() };

    const client1: WebSocketClient = {
      id: 'client-open',
      readyState: 1, // OPEN
      rawSocket: openSocket as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: vi.fn(),
    };

    const client2: WebSocketClient = {
      id: 'client-throwing',
      readyState: 1, // OPEN
      rawSocket: throwingSocket as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: vi.fn(),
    };

    const client3: WebSocketClient = {
      id: 'client-closed',
      readyState: 3, // CLOSED
      rawSocket: closedSocket as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: vi.fn(),
    };

    gateway.registerClient(client1);
    gateway.registerClient(client2);
    gateway.registerClient(client3);

    gateway.broadcast('test:event', { foo: 'bar' });

    expect(openSocket.send).toHaveBeenCalledTimes(1);
    expect(throwingSocket.send).toHaveBeenCalledTimes(1);
    expect(closedSocket.send).not.toHaveBeenCalled();

    const parsed = JSON.parse(openSocket.send.mock.calls[0][0]);
    expect(parsed.type).toBe('test:event');
    expect(parsed.payload).toEqual({ foo: 'bar' });
    expect(typeof parsed.timestamp).toBe('number');
  });

  it('sends direct message to a specific client when connected and open', () => {
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 0 });
    const mockSend = vi.fn();

    const client: WebSocketClient = {
      id: 'target-client',
      readyState: 1, // OPEN
      rawSocket: {} as unknown as import('ws').WebSocket,
      data: {},
      send: mockSend,
      close: vi.fn(),
    };

    gateway.registerClient(client);

    const success = gateway.sendTo('target-client', 'private:event', { secret: 42 });
    expect(success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith('private:event', { secret: 42 });

    const nonExistent = gateway.sendTo('unknown-id', 'event', {});
    expect(nonExistent).toBe(false);
  });

  it('handles sendTo failure when socket send throws or is not open', () => {
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 0 });
    const throwingSend = vi.fn().mockImplementation(() => {
      throw new Error('Send failed');
    });

    const clientThrowing: WebSocketClient = {
      id: 'throwing-client',
      readyState: 1,
      rawSocket: {} as unknown as import('ws').WebSocket,
      data: {},
      send: throwingSend,
      close: vi.fn(),
    };

    const clientClosing: WebSocketClient = {
      id: 'closing-client',
      readyState: 2, // CLOSING
      rawSocket: {} as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: vi.fn(),
    };

    gateway.registerClient(clientThrowing);
    gateway.registerClient(clientClosing);

    expect(gateway.sendTo('throwing-client', 'event', {})).toBe(false);
    expect(gateway.sendTo('closing-client', 'event', {})).toBe(false);
  });

  it('runs heartbeat timer to ping active clients and cleans up dead sockets', () => {
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 1000 });

    const healthySocket = { ping: vi.fn() };
    const deadSocket = {
      ping: vi.fn().mockImplementation(() => {
        throw new Error('Ping failed');
      }),
    };
    const disconnectedSocket = { ping: vi.fn() };

    const clientHealthy: WebSocketClient = {
      id: 'c-healthy',
      readyState: 1, // OPEN
      rawSocket: healthySocket as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: vi.fn(),
    };

    const clientDead: WebSocketClient = {
      id: 'c-dead',
      readyState: 1, // OPEN
      rawSocket: deadSocket as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: vi.fn(),
    };

    const clientDisconnected: WebSocketClient = {
      id: 'c-disconnected',
      readyState: 3, // CLOSED
      rawSocket: disconnectedSocket as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: vi.fn(),
    };

    gateway.registerClient(clientHealthy);
    gateway.registerClient(clientDead);
    gateway.registerClient(clientDisconnected);

    expect(gateway.clientCount).toBe(3);

    // Advance timer to trigger heartbeat
    vi.advanceTimersByTime(1000);

    expect(healthySocket.ping).toHaveBeenCalledTimes(1);
    expect(deadSocket.ping).toHaveBeenCalledTimes(1);
    // Dead and disconnected clients should have been cleaned up
    expect(gateway.clientCount).toBe(1);
    expect(gateway.getClient('c-healthy')).toBeDefined();
    expect(gateway.getClient('c-dead')).toBeUndefined();
    expect(gateway.getClient('c-disconnected')).toBeUndefined();

    gateway.onModuleDestroy();
  });

  it('closes all clients and cleans up on onModuleDestroy', async () => {
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 1000 });

    const mockClose1 = vi.fn();
    const mockClose2 = vi.fn().mockImplementation(() => {
      throw new Error('Close error');
    });

    const client1: WebSocketClient = {
      id: 'c-1',
      readyState: 1,
      rawSocket: {} as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: mockClose1,
    };

    const client2: WebSocketClient = {
      id: 'c-2',
      readyState: 1,
      rawSocket: {} as unknown as import('ws').WebSocket,
      data: {},
      send: vi.fn(),
      close: mockClose2,
    };

    gateway.registerClient(client1);
    gateway.registerClient(client2);
    await gateway.onModuleDestroy();

    expect(mockClose1).toHaveBeenCalledWith(1001, 'Server shutting down');
    expect(mockClose2).toHaveBeenCalledWith(1001, 'Server shutting down');
    expect(gateway.clientCount).toBe(0);
  });

  it('automatically attaches to server via onServerStart and attachToServer', async () => {
    const EventEmitter = (await import('node:events')).default;
    const mockServer = new EventEmitter();

    const gateway = new WebSocketGateway({ path: '/custom-ws' });

    // Calling onServerStart should attach adapter
    await gateway.onServerStart(mockServer);

    // Calling attachToServer again should be idempotent and return existing adapter
    const adapter = gateway.attachToServer(mockServer);
    expect(adapter).toBeDefined();
    expect(adapter.wss).toBeDefined();

    await gateway.onModuleDestroy();
  });
});
