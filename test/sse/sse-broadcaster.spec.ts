import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrap, defineModule } from '../../src/core/index.js';
import { createSseModule, SseBroadcaster } from '../../src/sse/index.js';

function createApp(broadcaster: SseBroadcaster) {
  const app = new Hono();
  app.get('/stream', (context) => broadcaster.stream(context));
  return app;
}

async function open(app: Hono, signal?: AbortSignal) {
  const response = await app.request('/stream', { signal });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing SSE body');
  const initial = await reader.read();
  expect(new TextDecoder().decode(initial.value)).toContain('retry: 3000');
  return { response, reader };
}

describe('SseBroadcaster', () => {
  afterEach(() => vi.useRealTimers());

  it('streams named JSON events through ordinary HTTP middleware', async () => {
    const broadcaster = new SseBroadcaster({ heartbeatIntervalMs: 0 });
    const app = new Hono();
    app.use('/stream', (c, next) => {
      if (c.req.header('Authorization') !== 'Bearer test') return c.text('Unauthorized', 401);
      c.header('X-Middleware', 'applied');
      return next();
    });
    app.get('/stream', (c) => broadcaster.stream(c));
    expect((await app.request('/stream')).status).toBe(401);
    expect(broadcaster.clientCount).toBe(0);
    const response = await app.request('/stream', { headers: { Authorization: 'Bearer test' } });
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    expect(response.headers.get('X-Middleware')).toBe('applied');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing body');
    await reader.read();
    const payload = { label: 'Foto’s\ngewijzigd', count: 1 };
    broadcaster.broadcast('photos:updated', payload);
    payload.count = 2;
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toBe('event: photos:updated\ndata: {"label":"Foto’s\\ngewijzigd","count":1}\n\n');
    await reader.cancel();
    expect(broadcaster.clientCount).toBe(0);
  });

  it('disconnects slow readers without blocking healthy readers or accumulating buffers', async () => {
    const broadcaster = new SseBroadcaster({ heartbeatIntervalMs: 0, maxBufferedBytes: 64 });
    const app = createApp(broadcaster);
    const slow = await open(app);
    const healthy = await open(app);
    for (let index = 0; index < 10; index++) {
      broadcaster.broadcast('refresh', index);
      expect(new TextDecoder().decode((await healthy.reader.read()).value)).toContain(
        `data: ${index}`
      );
    }
    expect(broadcaster.clientCount).toBe(1);
    await expect(slow.reader.read()).rejects.toThrow('buffer limit');
    await healthy.reader.cancel();
  });

  it('sends heartbeat comments and releases timers on request abort', async () => {
    vi.useFakeTimers();
    const broadcaster = new SseBroadcaster({ heartbeatIntervalMs: 100 });
    const controller = new AbortController();
    const { reader } = await open(createApp(broadcaster), controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': heartbeat\n\n');
    controller.abort();
    expect(broadcaster.clientCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect((await reader.read()).done).toBe(true);
  });

  it('shuts down immediately with unread clients and refuses new streams', async () => {
    vi.useFakeTimers();
    const broadcaster = new SseBroadcaster();
    const app = createApp(broadcaster);
    const { reader } = await open(app);
    broadcaster.broadcast('refresh', null);
    broadcaster.onModuleDestroy();
    broadcaster.onModuleDestroy();
    expect(broadcaster.clientCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: refresh');
    expect((await reader.read()).done).toBe(true);
    expect((await app.request('/stream')).status).toBe(503);
  });

  it('cleans up a request that was aborted before subscription', async () => {
    const broadcaster = new SseBroadcaster();
    const response = await createApp(broadcaster).request('/stream', {
      signal: AbortSignal.abort(),
    });
    expect(broadcaster.clientCount).toBe(0);
    expect(await response.text()).toBe('');
  });

  it('rejects invalid options, frame injection and invalid or oversized data', () => {
    expect(() => new SseBroadcaster({ heartbeatIntervalMs: Number.NaN })).toThrow(RangeError);
    expect(() => new SseBroadcaster({ maxBufferedBytes: 0 })).toThrow(RangeError);
    const broadcaster = new SseBroadcaster({ maxBufferedBytes: 64 });
    expect(() => broadcaster.broadcast('refresh\ndata: injected', null)).toThrow(TypeError);
    expect(() => broadcaster.broadcast('refresh', undefined)).toThrow(TypeError);
    expect(() => broadcaster.broadcast('refresh', 'x'.repeat(100))).toThrow(RangeError);
  });

  it('isolates module instances by application and cleans them up through stop()', async () => {
    const module = defineModule({ name: 'app', imports: [createSseModule()] });
    const first = await bootstrap(module, { environment: 'test', openapi: { enabled: false } });
    const second = await bootstrap(module, { environment: 'test', openapi: { enabled: false } });
    const a = first.container.resolve<SseBroadcaster>('sseBroadcaster');
    const b = second.container.resolve<SseBroadcaster>('sseBroadcaster');
    expect(a).not.toBe(b);
    const { reader } = await open(createApp(a));
    await first.stop();
    expect((await reader.read()).done).toBe(true);
    expect(b.clientCount).toBe(0);
    await second.stop();
  });
});
