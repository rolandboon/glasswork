import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createContextAwarePinoLogger,
  createPinoHttpMiddleware,
  lambdaPinoConfig,
  type PinoLogger,
} from '../../src/observability/pino-logger.js';
import { requestContextStorage } from '../../src/observability/request-context.js';

describe('Pino Logger', () => {
  describe('lambdaPinoConfig', () => {
    it('should have correct structure', () => {
      expect(lambdaPinoConfig).toHaveProperty('level');
      expect(lambdaPinoConfig).toHaveProperty('formatters');
      expect(lambdaPinoConfig.formatters).toHaveProperty('level');
      expect(lambdaPinoConfig.transport).toBeUndefined();
      expect(lambdaPinoConfig.base).toBeUndefined();
    });

    it('should use LOG_LEVEL env var or default to info', () => {
      const originalLevel = process.env.LOG_LEVEL;
      delete process.env.LOG_LEVEL;

      // Re-import to get fresh config
      const config = lambdaPinoConfig;
      expect(config.level).toBe('info');

      if (originalLevel) {
        process.env.LOG_LEVEL = originalLevel;
      }
    });
  });

  describe('createContextAwarePinoLogger', () => {
    let mockPino: PinoLogger;

    beforeEach(() => {
      mockPino = {
        level: 'info',
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn((_bindings) => ({
          level: 'info',
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          child: mockPino.child,
        })),
      };
    });

    it('should create logger with service name', async () => {
      const logger = createContextAwarePinoLogger({
        pino: mockPino,
        service: 'test-service',
      });

      await requestContextStorage.run(
        {
          requestId: 'req-123',
          method: 'GET',
          path: '/test',
          custom: {},
        },
        async () => {
          logger.info('Test message', { key: 'value' });
        }
      );

      expect(mockPino.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-123',
          service: 'test-service',
          key: 'value',
        }),
        'Test message'
      );
    });

    it('should include requestId from context', async () => {
      const logger = createContextAwarePinoLogger({ pino: mockPino });

      await requestContextStorage.run(
        {
          requestId: 'req-456',
          method: 'GET',
          path: '/test',
          custom: {},
        },
        async () => {
          logger.info('Test message');
        }
      );

      expect(mockPino.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-456',
        }),
        'Test message'
      );
    });

    it('should include userId from context', async () => {
      const logger = createContextAwarePinoLogger({ pino: mockPino });

      await requestContextStorage.run(
        {
          requestId: 'req-789',
          method: 'GET',
          path: '/test',
          userId: 'user-123',
          custom: {},
        },
        async () => {
          logger.info('Test message');
        }
      );

      expect(mockPino.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-789',
          userId: 'user-123',
        }),
        'Test message'
      );
    });

    it('should include custom context values', async () => {
      const logger = createContextAwarePinoLogger({ pino: mockPino });

      await requestContextStorage.run(
        {
          requestId: 'req-abc',
          method: 'GET',
          path: '/test',
          custom: {
            tenantId: 'tenant-123',
            orderId: 'order-456',
          },
        },
        async () => {
          logger.info('Test message');
        }
      );

      expect(mockPino.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-abc',
          tenantId: 'tenant-123',
          orderId: 'order-456',
        }),
        'Test message'
      );
    });

    it('should merge meta objects with context', async () => {
      const logger = createContextAwarePinoLogger({
        pino: mockPino,
        service: 'test-service',
      });

      await requestContextStorage.run(
        {
          requestId: 'req-xyz',
          method: 'GET',
          path: '/test',
          custom: { tenantId: 'tenant-123' },
        },
        async () => {
          logger.info('Test message', { userId: 'user-456', action: 'create' });
        }
      );

      expect(mockPino.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-xyz',
          service: 'test-service',
          tenantId: 'tenant-123',
          userId: 'user-456',
          action: 'create',
        }),
        'Test message'
      );
    });

    it('should work without request context', () => {
      const logger = createContextAwarePinoLogger({
        pino: mockPino,
        service: 'test-service',
      });

      logger.info('Test message', { key: 'value' });

      expect(mockPino.info).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'test-service',
          key: 'value',
        }),
        'Test message'
      );
    });

    it('should support all log levels', async () => {
      const logger = createContextAwarePinoLogger({ pino: mockPino });

      await requestContextStorage.run(
        {
          requestId: 'req-all',
          method: 'GET',
          path: '/test',
          custom: {},
        },
        async () => {
          logger.debug('debug');
          logger.info('info');
          logger.warn('warn');
          logger.error('error');
        }
      );

      expect(mockPino.debug).toHaveBeenCalled();
      expect(mockPino.info).toHaveBeenCalled();
      expect(mockPino.warn).toHaveBeenCalled();
      expect(mockPino.error).toHaveBeenCalled();
    });

    it('should support child logger creation', () => {
      const logger = createContextAwarePinoLogger({ pino: mockPino });
      const childLogger = logger.child({ extra: 'data' });

      expect(childLogger).toBeDefined();
      expect(mockPino.child).toHaveBeenCalledWith({ extra: 'data' });
    });
  });

  describe('createPinoHttpMiddleware', () => {
    let mockPino: PinoLogger;

    beforeEach(() => {
      mockPino = {
        level: 'info',
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };
    });

    it('should log HTTP requests with request context', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(async (c, next) => {
        await requestContextStorage.run(
          {
            requestId: c.get('requestId'),
            method: c.req.method,
            path: c.req.path,
            custom: {},
          },
          async () => {
            await next();
          }
        );
      });
      app.use(createPinoHttpMiddleware(mockPino));
      app.get('/test', (c) => c.json({ success: true }));

      await app.request('/test');

      expect(mockPino.info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          method: 'GET',
          path: '/test',
          status: 200,
          duration: expect.any(Number),
        }),
        'HTTP Request'
      );
    });

    it('should log errors with error level for 5xx status', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(async (c, next) => {
        await requestContextStorage.run(
          {
            requestId: c.get('requestId'),
            method: c.req.method,
            path: c.req.path,
            custom: {},
          },
          async () => {
            await next();
          }
        );
      });
      app.use(createPinoHttpMiddleware(mockPino));
      app.get('/error', () => {
        return new Response('Error', { status: 500 });
      });

      await app.request('/error');

      expect(mockPino.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 500,
        }),
        'HTTP Request'
      );
    });

    it('should log warnings for 4xx status', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(async (c, next) => {
        await requestContextStorage.run(
          {
            requestId: c.get('requestId'),
            method: c.req.method,
            path: c.req.path,
            custom: {},
          },
          async () => {
            await next();
          }
        );
      });
      app.use(createPinoHttpMiddleware(mockPino));
      app.get('/not-found', () => {
        return new Response('Not Found', { status: 404 });
      });

      await app.request('/not-found');

      expect(mockPino.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 404,
        }),
        'HTTP Request'
      );
    });

    it('should include userId if available in context', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(async (c, next) => {
        await requestContextStorage.run(
          {
            requestId: c.get('requestId'),
            method: c.req.method,
            path: c.req.path,
            userId: 'user-123',
            custom: {},
          },
          async () => {
            await next();
          }
        );
      });
      app.use(createPinoHttpMiddleware(mockPino));
      app.get('/test', (c) => c.json({ success: true }));

      await app.request('/test');

      expect(mockPino.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
        }),
        'HTTP Request'
      );
    });

    it('should calculate request duration', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(async (c, next) => {
        await requestContextStorage.run(
          {
            requestId: c.get('requestId'),
            method: c.req.method,
            path: c.req.path,
            custom: {},
          },
          async () => {
            await next();
          }
        );
      });
      app.use(createPinoHttpMiddleware(mockPino));
      app.get('/slow', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new Response('OK', { status: 200 });
      });

      await app.request('/slow');

      const call = (mockPino.info as ReturnType<typeof vi.fn>).mock.calls[0];
      const logObject = call[0] as { duration: number };
      expect(logObject.duration).toBeGreaterThanOrEqual(50);
    });
  });
});
