import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';
import {
  createRequestContextMiddleware,
  getRequestContext,
  getRequestId,
  type RequestContext,
  requestContextStorage,
  setRequestContextValue,
  setRequestUser,
} from '../../src/observability/request-context.js';

describe('Request Context', () => {
  describe('getRequestContext', () => {
    it('should return undefined when called outside request lifecycle', () => {
      const ctx = getRequestContext();
      expect(ctx).toBeUndefined();
    });

    it('should return context when inside request lifecycle', async () => {
      const context: RequestContext = {
        requestId: 'test-123',
        method: 'GET',
        path: '/test',
        custom: {},
      };

      await requestContextStorage.run(context, async () => {
        const ctx = getRequestContext();
        expect(ctx).toEqual(context);
        expect(ctx?.requestId).toBe('test-123');
      });
    });
  });

  describe('getRequestId', () => {
    it('should return undefined when called outside request lifecycle', () => {
      const id = getRequestId();
      expect(id).toBeUndefined();
    });

    it('should return requestId when inside request lifecycle', async () => {
      const context: RequestContext = {
        requestId: 'test-456',
        method: 'GET',
        path: '/test',
        custom: {},
      };

      await requestContextStorage.run(context, async () => {
        const id = getRequestId();
        expect(id).toBe('test-456');
      });
    });
  });

  describe('setRequestUser', () => {
    it('should do nothing when called outside request lifecycle', () => {
      expect(() => setRequestUser('user-123')).not.toThrow();
    });

    it('should set userId in context when inside request lifecycle', async () => {
      const context: RequestContext = {
        requestId: 'test-789',
        method: 'GET',
        path: '/test',
        custom: {},
      };

      await requestContextStorage.run(context, async () => {
        setRequestUser('user-123');
        const ctx = getRequestContext();
        expect(ctx?.userId).toBe('user-123');
      });
    });
  });

  describe('setRequestContextValue', () => {
    it('should do nothing when called outside request lifecycle', () => {
      expect(() => setRequestContextValue('key', 'value')).not.toThrow();
    });

    it('should set custom context value when inside request lifecycle', async () => {
      const context: RequestContext = {
        requestId: 'test-abc',
        method: 'GET',
        path: '/test',
        custom: {},
      };

      await requestContextStorage.run(context, async () => {
        setRequestContextValue('tenantId', 'tenant-123');
        setRequestContextValue('orderId', 'order-456');

        const ctx = getRequestContext();
        expect(ctx?.custom.tenantId).toBe('tenant-123');
        expect(ctx?.custom.orderId).toBe('order-456');
      });
    });

    it('should overwrite existing custom context values', async () => {
      const context: RequestContext = {
        requestId: 'test-xyz',
        method: 'GET',
        path: '/test',
        custom: { tenantId: 'old-value' },
      };

      await requestContextStorage.run(context, async () => {
        setRequestContextValue('tenantId', 'new-value');
        const ctx = getRequestContext();
        expect(ctx?.custom.tenantId).toBe('new-value');
      });
    });
  });

  describe('createRequestContextMiddleware', () => {
    it('should create middleware that sets up request context', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(createRequestContextMiddleware());
      app.get('/test', (c) => {
        const ctx = getRequestContext();
        const id = getRequestId();
        return c.json({
          requestId: id,
          method: ctx?.method,
          path: ctx?.path,
        });
      });

      const res = await app.request('/test');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.requestId).toBeDefined();
      expect(body.method).toBe('GET');
      expect(body.path).toBe('/test');
    });

    it('should use existing requestId from context if available', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(createRequestContextMiddleware());
      app.get('/test', (c) => {
        const id = getRequestId();
        return c.json({ requestId: id });
      });

      const res = await app.request('/test', {
        headers: { 'x-request-id': 'custom-id-123' },
      });
      const body = await res.json();
      expect(body.requestId).toBe('custom-id-123');
    });

    it('should generate UUID if requestId not in context', async () => {
      const app = new Hono();
      // Don't use requestId middleware - middleware should generate UUID
      app.use(createRequestContextMiddleware());
      app.get('/test', (c) => {
        const id = getRequestId();
        return c.json({ requestId: id });
      });

      const res = await app.request('/test');
      const body = await res.json();
      expect(body.requestId).toBeDefined();
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(body.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should preserve context across async operations', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(createRequestContextMiddleware());
      app.get('/test', async (c) => {
        const id1 = getRequestId();

        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));

        const id2 = getRequestId();
        return c.json({ id1, id2 });
      });

      const res = await app.request('/test');
      const body = await res.json();
      expect(body.id1).toBe(body.id2);
    });

    it('should isolate context between concurrent requests', async () => {
      const app = new Hono();
      app.use(requestId());
      app.use(createRequestContextMiddleware());
      app.get('/test', (c) => {
        const id = getRequestId();
        return c.json({ requestId: id });
      });

      const [res1, res2] = await Promise.all([
        app.request('/test', {
          headers: { 'x-request-id': 'request-1' },
        }),
        app.request('/test', {
          headers: { 'x-request-id': 'request-2' },
        }),
      ]);

      const body1 = await res1.json();
      const body2 = await res2.json();

      expect(body1.requestId).toBe('request-1');
      expect(body2.requestId).toBe('request-2');
      expect(body1.requestId).not.toBe(body2.requestId);
    });
  });
});
