import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { PinoLogger } from '../../src/observability/pino-logger.js';

describe('bootstrap logging', () => {
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
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('Pino logger');
    expect(calls).toContain('AsyncLocalStorage');

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
