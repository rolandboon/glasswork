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

  describe('Error handling and safety', () => {
    it('should handle serialization errors (circular reference)', async () => {
      const app = new Hono();

      interface CircularType {
        name: string;
        self?: CircularType;
      }

      app.get(
        '/circular',
        ...route(router, {
          summary: 'Test circular reference',
          responses: {
            200: v.object({
              name: v.string(),
            }),
          },
          handler: async () => {
            const circular: CircularType = { name: 'test' };
            circular.self = circular; // Create circular reference
            return circular as { name: string };
          },
        })
      );

      const response = await app.request('/circular');

      // Should return 500 error instead of crashing
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toContain('Circular reference');
    });

    it('should handle serialization errors (max depth exceeded)', async () => {
      const app = new Hono();

      app.get(
        '/deep',
        ...route(router, {
          summary: 'Test max depth',
          responses: {
            200: v.object({
              value: v.string(),
            }),
          },
          handler: async () => {
            // Create extremely deep nesting (more than 20 levels)
            let deep: Record<string, unknown> = { value: 'end' };
            for (let i = 0; i < 25; i++) {
              deep = { nested: deep };
            }
            return deep as { value: string };
          },
        })
      );

      const response = await app.request('/deep');

      // Should return 500 error
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toContain('depth');
    });

    it('should throw in production when response does not match schema', async () => {
      const app = new Hono();
      const originalEnv = process.env.NODE_ENV;
      // Suppress expected error logs in test output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Simulate production environment
        process.env.NODE_ENV = 'production';

        app.get(
          '/invalid-response',
          ...route(router, {
            summary: 'Test invalid response',
            responses: {
              200: v.object({
                id: v.string(),
                name: v.string(),
              }),
            },
            handler: async () => {
              // Return data that doesn't match the schema
              return {
                id: 123, // Should be string, not number
                name: 'Test',
              } as unknown as { id: string; name: string };
            },
          })
        );

        const response = await app.request('/invalid-response');

        // In production, should return 500 when validation fails
        expect(response.status).toBe(500);
      } finally {
        // Restore original environment
        process.env.NODE_ENV = originalEnv;
        consoleErrorSpy.mockRestore();
      }
    });

    it('should warn in development when response does not match schema', async () => {
      const app = new Hono();
      const originalEnv = process.env.NODE_ENV;

      try {
        // Simulate development environment
        process.env.NODE_ENV = 'development';

        app.get(
          '/invalid-response-dev',
          ...route(router, {
            summary: 'Test invalid response in dev',
            responses: {
              200: v.object({
                id: v.string(),
                name: v.string(),
              }),
            },
            handler: async () => {
              // Return data that doesn't match the schema
              return {
                id: 123, // Wrong type
                name: 'Test',
              } as unknown as { id: string; name: string };
            },
          })
        );

        const response = await app.request('/invalid-response-dev');

        // In development, should still return the data (with warning)
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe(123); // Returns as-is in development
      } finally {
        // Restore original environment
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should handle normal errors from handler', async () => {
      const app = new Hono();
      // Suppress expected error logs in test output
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      app.get(
        '/error',
        ...route(router, {
          summary: 'Test handler error',
          responses: {
            200: v.object({ ok: v.boolean() }),
          },
          handler: async () => {
            throw new Error('Handler error');
          },
        })
      );

      // Handler errors are caught by Hono and return 500
      const response = await app.request('/error');
      expect(response.status).toBe(500);

      consoleErrorSpy.mockRestore();
    });
  });
});
