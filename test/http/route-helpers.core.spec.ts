import { Hono } from 'hono';
import * as v from 'valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type RouteContext, route } from '../../src/http/route-helpers.js';
import { createTestRouter } from '../helpers/route.js';

describe('route', () => {
  let router: Hono;

  beforeEach(() => {
    router = createTestRouter();
  });

  it('should create middleware array with OpenAPI and handler', () => {
    const handler = vi.fn().mockResolvedValue({ success: true });

    const middlewares = route(router, {
      summary: 'Test route',
      handler,
    });

    expect(middlewares).toBeInstanceOf(Array);
    expect(middlewares.length).toBeGreaterThan(0);
  });

  it('should add validation middleware when body schema provided', () => {
    const bodySchema = v.object({ email: v.string() });
    const handler = vi.fn();

    const middlewares = route(router, {
      summary: 'Test route',
      body: bodySchema,
      handler,
    });

    // Should have: OpenAPI + body validator + handler
    expect(middlewares.length).toBe(3);
  });

  it('should add multiple validation middlewares', () => {
    const bodySchema = v.object({ email: v.string() });
    const querySchema = v.object({ page: v.string() });
    const handler = vi.fn();

    const middlewares = route(router, {
      summary: 'Test route',
      body: bodySchema,
      query: querySchema,
      handler,
    });

    // Should have: OpenAPI + body validator + query validator + handler
    expect(middlewares.length).toBe(4);
  });

  it('should return 204 for null/undefined results', async () => {
    const handler = vi.fn().mockResolvedValue(null);

    const middlewares = route(router, {
      summary: 'Test route',
      handler,
    });

    const handlerMiddleware = middlewares[middlewares.length - 1];

    const mockContext = {
      req: {
        header: vi.fn(),
        valid: vi.fn(),
        query: vi.fn().mockReturnValue({}),
        param: vi.fn().mockReturnValue({}),
      },
      get: vi.fn().mockReturnValue({}),
      status: vi.fn(),
      body: vi.fn(),
    };

    await handlerMiddleware(mockContext as unknown as never, vi.fn());

    expect(mockContext.status).toHaveBeenCalledWith(204);
    expect(mockContext.body).toHaveBeenCalledWith(null);
  });

  it('should return JSON for non-null results', async () => {
    const result = { success: true, data: { id: '123' } };
    const handler = vi.fn().mockResolvedValue(result);

    const middlewares = route(router, {
      summary: 'Test route',
      handler,
    });

    const handlerMiddleware = middlewares[middlewares.length - 1];

    const mockContext = {
      req: {
        header: vi.fn(),
        valid: vi.fn(),
        query: vi.fn().mockReturnValue({}),
        param: vi.fn().mockReturnValue({}),
      },
      get: vi.fn().mockReturnValue({}),
      json: vi.fn(),
    };

    await handlerMiddleware(mockContext as unknown as never, vi.fn());

    expect(mockContext.json).toHaveBeenCalledWith(result);
  });

  it('should pass services and session from context', async () => {
    const services = { userService: { getUser: vi.fn() } };
    const session = { userId: '123' };
    let capturedContext: unknown;

    const handler = vi.fn().mockImplementation((ctx) => {
      capturedContext = ctx;
      return { success: true };
    });

    const middlewares = route(router, {
      summary: 'Test route',
      handler,
    });

    const handlerMiddleware = middlewares[middlewares.length - 1];

    const mockContext = {
      req: {
        header: vi.fn(),
        valid: vi.fn(),
        query: vi.fn().mockReturnValue({}),
        param: vi.fn().mockReturnValue({}),
      },
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'services') return services;
        if (key === 'session') return session;
        return undefined;
      }),
      json: vi.fn(),
    };

    await handlerMiddleware(mockContext as unknown as never, vi.fn());

    expect(capturedContext).toBeDefined();
    expect((capturedContext as RouteContext).services).toBe(services);
    expect((capturedContext as RouteContext).session).toBe(session);
    expect((capturedContext as RouteContext).context).toBe(mockContext);
  });

  it('should integrate with Hono router', () => {
    const app = new Hono();
    const handler = vi.fn().mockResolvedValue({ success: true });

    // This should work without errors
    app.post(
      '/test',
      ...route(router, {
        summary: 'Test route',
        handler,
      })
    );

    expect(app).toBeDefined();
  });
});
