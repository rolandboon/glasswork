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

  describe('Response type handling', () => {
    it('should return Response objects directly', async () => {
      const customResponse = new Response('Custom text', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
      const handler = vi.fn().mockResolvedValue(customResponse);

      const middlewares = route(router, {
        summary: 'Test route',
        responses: { 200: undefined },
        handler,
      });

      const handlerMiddleware = middlewares[middlewares.length - 1];

      const mockContext = {
        req: {
          header: vi.fn(),
          valid: vi.fn(),
        },
        get: vi.fn().mockReturnValue({}),
        json: vi.fn(),
      };

      const result = await handlerMiddleware(mockContext as unknown as never, vi.fn());

      expect(result).toBe(customResponse);
      expect(mockContext.json).not.toHaveBeenCalled();
    });

    it('should handle text responses through context.text()', async () => {
      const app = new Hono();

      app.get(
        '/text',
        ...route(router, {
          summary: 'Text response',
          responses: { 200: undefined },
          handler: async ({ context }) => {
            return context.text('OK') as unknown;
          },
        })
      );

      const res = await app.request('/text');
      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe('OK');
    });

    it('should return JSON for plain objects', async () => {
      const app = new Hono();

      app.get(
        '/json',
        ...route(router, {
          summary: 'JSON response',
          responses: { 200: v.object({ id: v.string() }) },
          handler: async () => ({ id: '123' }),
        })
      );

      const res = await app.request('/json');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ id: '123' });
    });
  });
});
