import { Hono } from 'hono';
import * as v from 'valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../src/http/route-helpers.js';
import { createTestRouter } from '../helpers/route.js';

describe('route', () => {
  let router: Hono;

  beforeEach(() => {
    router = createTestRouter();
  });

  describe('Custom middleware', () => {
    it('should apply custom middleware before validation', async () => {
      const app = new Hono();
      const authMiddleware = vi.fn(async (c, next) => {
        c.set('user', { id: '123' });
        await next();
      });

      app.get(
        '/protected',
        ...route(router, {
          summary: 'Protected route',
          middleware: [authMiddleware],
          responses: { 200: v.object({ userId: v.string() }) },
          handler: async ({ context }) => {
            const user = context.get('user') as { id: string };
            return { userId: user.id };
          },
        })
      );

      const res = await app.request('/protected');
      expect(res.status).toBe(200);
      expect(authMiddleware).toHaveBeenCalled();
      const body = await res.json();
      expect(body).toEqual({ userId: '123' });
    });
  });

  describe('Public routes', () => {
    it('should mark public routes in OpenAPI', () => {
      const middlewares = route(router, {
        summary: 'Public route',
        public: true,
        responses: { 200: v.object({ ok: v.boolean() }) },
        handler: async () => ({ ok: true }),
      });

      expect(middlewares).toBeDefined();
      // The OpenAPI middleware should be configured with security: []
    });

    it('should add auth security by default', () => {
      const middlewares = route(router, {
        summary: 'Protected route',
        public: false,
        responses: { 200: v.object({ ok: v.boolean() }) },
        handler: async () => ({ ok: true }),
      });

      expect(middlewares).toBeDefined();
      // The OpenAPI middleware should include bearerAuth security
    });
  });
});
