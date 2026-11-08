import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import {
  createContextAwarePinoLogger,
  type PinoLogger,
} from '../../src/observability/pino-logger.js';

describe('bootstrap logging', () => {
  it('adds request fields to the HTTP line and to service logs of the request', async () => {
    const mockPino: PinoLogger = {
      level: 'info',
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => mockPino),
    };
    const serviceLogger = createContextAwarePinoLogger({ pino: mockPino, service: 'Orders' });
    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router) => {
        router.get('/hello', (c) => {
          serviceLogger.info('Order viewed');
          return c.json({ message: 'Hello' });
        });
      },
    });

    const { app } = await bootstrap(module, {
      logger: {
        pino: mockPino,
        requestFields: (c) => ({
          userAgent: c.req.header('user-agent'),
          clientNetwork: undefined,
          status: 'spoofed',
          secret: 'not for logs',
        }),
        sanitizers: {
          metadata: ({ secret: _secret, ...rest }) => rest,
        },
      },
    });

    const res = await app.request('/api/test/hello', { headers: { 'user-agent': 'Agent/1.0' } });
    expect(res.status).toBe(200);

    const httpLine = vi
      .mocked(mockPino.info)
      .mock.calls.find(([, message]) => message === 'HTTP Request')?.[0];
    expect(httpLine).toMatchObject({ userAgent: 'Agent/1.0', method: 'GET', status: 200 });
    expect(httpLine).not.toHaveProperty('clientNetwork');
    expect(httpLine).not.toHaveProperty('secret');
    expect(mockPino.info).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: 'Agent/1.0', service: 'Orders' }),
      'Order viewed'
    );
  });

  it('should apply Pino logger with request context middleware', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const mockPino: PinoLogger = {
      level: 'info',
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => mockPino),
    };

    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router) => {
        router.get('/hello', (c) => c.json({ message: 'Hello' }));
      },
    });

    const { app } = await bootstrap(module, {
      debug: true,
      logger: {
        pino: mockPino,
      },
    });

    // Verify Pino logger was configured
    expect(mockPino.debug).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'Glasswork' }),
      expect.stringContaining('Pino logger')
    );
    expect(consoleSpy).not.toHaveBeenCalled();

    // Make a request to verify middleware is working
    const res = await app.request('/api/test/hello');
    expect(res.status).toBe(200);

    // Pino HTTP middleware should have logged
    expect(mockPino.info).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should disable logging when enabled is false', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router) => {
        router.get('/hello', (c) => c.json({ message: 'Hello' }));
      },
    });

    const { app } = await bootstrap(module, {
      debug: true,
      logger: {
        enabled: false,
      },
    });

    // Verify logging was NOT applied (no mention of logger in debug output)
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).not.toContain('Applying built-in logger');
    expect(calls).not.toContain('Pino logger');

    // Make a request
    const res = await app.request('/api/test/hello');
    expect(res.status).toBe(200);

    consoleSpy.mockRestore();
  });
});
