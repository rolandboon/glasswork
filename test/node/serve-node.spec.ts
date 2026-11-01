import type { Server } from 'node:http';
import http from 'node:http';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShutdownController, serveNode } from '../../src/node/serve-node.js';
import { SseBroadcaster } from '../../src/sse/sse-broadcaster.js';

function captureLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** An app with a request that waits until the test releases it. */
function slowApp() {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reachedHandler = new Promise<void>((resolve) => {
    started = resolve;
  });
  const events = new SseBroadcaster({ heartbeatIntervalMs: 0 });
  const app = new Hono();
  app.get('/fast', (c) => c.text('fast'));
  app.get('/slow', async (c) => {
    started();
    await gate;
    return c.text('slow');
  });
  app.get('/events', (c) => events.stream(c));
  return { app, release, reachedHandler, events };
}

/** A request on its own connection, with the response body read in full. */
function get(port: number, path: string) {
  return new Promise<{ status: number; connection?: string; body: string }>((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path, agent: false }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          connection: response.headers.connection,
          body,
        })
      );
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.closeAllConnections();
});

async function start(options: Partial<Parameters<typeof serveNode>[0]> & { app: Hono }) {
  const stop = options.stop ?? vi.fn(async () => {});
  const logger = captureLogger();
  const node = serveNode({
    fetch: options.app.fetch,
    stop,
    port: 0,
    hostname: '127.0.0.1',
    signals: false,
    logger,
    ...options,
  });
  servers.push(node.server);
  const { port } = await node.listening;
  return { node, port, stop, logger };
}

describe('serveNode', () => {
  it('finishes in-flight requests after shutdown began and refuses new connections', async () => {
    const order: string[] = [];
    const { app, release, reachedHandler } = slowApp();
    const { node, port } = await start({
      app,
      stop: async () => {
        order.push('stop');
      },
    });
    node.server.on('request', (request, response) => {
      response.on('finish', () => order.push(`sent ${request.url}`));
    });
    expect(await get(port, '/health/ready')).toMatchObject({ status: 200, body: 'ready' });

    const slow = get(port, '/slow');
    await reachedHandler;
    const shutdown = node.shutdown('test');

    expect(node.ready).toBe(false);
    await expect(get(port, '/fast')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    release();
    expect(await slow).toMatchObject({ status: 200, body: 'slow', connection: 'close' });
    expect(await shutdown).toBe(0);
    expect(order).toEqual(['sent /health/ready', 'sent /slow', 'stop']);
  });

  it('closes the remaining connections at the deadline and reports exit code 1', async () => {
    const { app, release, reachedHandler } = slowApp();
    const { node, port, stop, logger } = await start({ app, shutdownTimeoutMs: 100 });

    const slow = get(port, '/slow');
    await reachedHandler;

    expect(await node.shutdown('test')).toBe(1);
    await expect(slow).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      'Shutdown deadline of 100 ms passed; closing the remaining connections'
    );
    expect(stop).toHaveBeenCalledOnce();
    release();
  });

  it('runs drain steps, and reports a failed drain step or stop with exit code 1', async () => {
    const drained: string[] = [];
    const { app } = slowApp();
    const failingDrain = await start({
      app,
      drain: [
        () => {
          drained.push('jobs');
        },
        async () => {
          throw new Error('consumer did not stop');
        },
      ],
    });
    const failingStop = await start({
      app,
      stop: async () => {
        throw new Error('pool close failed');
      },
    });

    expect(await failingDrain.node.shutdown()).toBe(1);
    expect(drained).toEqual(['jobs']);
    expect(failingDrain.stop).toHaveBeenCalledOnce();
    expect(failingDrain.logger.error).toHaveBeenCalledWith(
      'A drain step failed during shutdown',
      expect.objectContaining({ message: 'consumer did not stop' })
    );
    expect(await failingStop.node.shutdown()).toBe(1);
    expect(failingStop.logger.error).toHaveBeenCalledWith(
      'Stopping the application failed',
      expect.objectContaining({ message: 'pool close failed' })
    );
  });

  it('closes event streams in a drain step instead of waiting for the deadline', async () => {
    const { app, events } = slowApp();
    const { node, port } = await start({ app, drain: [() => events.close()] });
    const stream = new Promise<string>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/events', agent: false }, (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => resolve(body));
        })
        .on('error', reject);
    });
    await vi.waitFor(() => expect(events.clientCount).toBe(1));

    const startedAt = Date.now();
    expect(await node.shutdown()).toBe(0);

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(await stream).toContain('retry:');
  });

  it('shuts down on a signal and exits at once on a second one', async () => {
    const exit = vi.fn();
    const { app, release, reachedHandler } = slowApp();
    const listeners = process.listenerCount('SIGUSR2');
    const { port } = await start({ app, signals: ['SIGUSR2'], exit });

    const slow = get(port, '/slow');
    await reachedHandler;
    process.emit('SIGUSR2');
    process.emit('SIGUSR2');
    expect(exit).toHaveBeenCalledWith(1);

    release();
    await slow;
    await vi.waitFor(() => expect(exit).toHaveBeenLastCalledWith(0));
    expect(process.listenerCount('SIGUSR2')).toBe(listeners);
  });
});

describe('shutdown request guard', () => {
  it('answers 503 with Connection: close to work that arrives during shutdown', async () => {
    const controller = createShutdownController({
      fetch: () => new Response('handled'),
      stop: async () => {},
      logger: captureLogger(),
    });
    controller.markListening();
    const server = { close: (done: () => void) => done(), closeIdleConnections: () => {} };

    expect((await controller.fetch(new Request('http://app/health/live'))).status).toBe(200);
    expect(await controller.shutdown(server as unknown as Server)).toBe(0);
    const late = await controller.fetch(new Request('http://app/orders'));
    const ready = await controller.fetch(new Request('http://app/health/ready'));

    expect([late.status, late.headers.get('connection'), late.headers.get('retry-after')]).toEqual([
      503,
      'close',
      '1',
    ]);
    expect(ready.status).toBe(503);
    expect((await controller.fetch(new Request('http://app/health/live'))).status).toBe(200);
  });
});

describe('shutdown resource bounds', () => {
  it('bounds application cleanup even when stop never settles', async () => {
    const { app } = slowApp();
    const { node, logger } = await start({
      app,
      stop: () => new Promise(() => {}),
      shutdownTimeoutMs: 10,
      stopTimeoutMs: 20,
    } as Parameters<typeof start>[0]);
    const result = await Promise.race([
      node.shutdown(),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 200)),
    ]);
    expect(result).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cleanup deadline'));
  });

  it('removes its signal listeners after programmatic shutdown', async () => {
    const before = process.listenerCount('SIGUSR2');
    const { app } = slowApp();
    const { node } = await start({ app, signals: ['SIGUSR2'], exit: vi.fn() });
    const listeners = process.listeners('SIGUSR2');
    try {
      await node.shutdown();
      expect(process.listenerCount('SIGUSR2')).toBe(before);
    } finally {
      // The original implementation leaks its listener; keep this regression isolated.
      for (const listener of listeners.slice(before)) process.removeListener('SIGUSR2', listener);
    }
  });
});
