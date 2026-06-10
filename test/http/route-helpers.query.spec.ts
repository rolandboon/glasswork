import { Hono } from 'hono';
import * as v from 'valibot';
import { beforeEach, describe, expect, it } from 'vitest';
import { route } from '../../src/http/route-helpers.js';
import { createTestRouter } from '../helpers/route.js';

describe('route', () => {
  let router: Hono;

  beforeEach(() => {
    router = createTestRouter();
  });

  describe('Query parameter handling', () => {
    it('should parse and validate query parameters', async () => {
      const app = new Hono();
      let capturedQuery: Record<string, string> | undefined;

      app.get(
        '/search',
        ...route(router, {
          summary: 'Search',
          query: v.object({
            q: v.string(),
            limit: v.optional(v.string()),
          }),
          responses: { 200: v.object({ query: v.record(v.string(), v.string()) }) },
          handler: async ({ query }) => {
            capturedQuery = query;
            return { query };
          },
        })
      );

      const res = await app.request('/search?q=test&limit=10');
      expect(res.status).toBe(200);
      expect(capturedQuery).toEqual({ q: 'test', limit: '10' });
    });

    it('should validate query parameters and return 422 on failure', async () => {
      const app = new Hono();

      app.get(
        '/search',
        ...route(router, {
          summary: 'Search',
          query: v.object({
            required: v.string(),
          }),
          responses: { 200: v.object({ ok: v.boolean() }) },
          handler: async () => ({ ok: true }),
        })
      );

      const res = await app.request('/search'); // Missing required param
      expect(res.status).toBe(422); // Valibot validator returns 422
    });

    it('should type query parameters based on schema', async () => {
      const app = new Hono();

      // Define a specific query schema
      const QuerySchema = v.object({
        from: v.string(),
        to: v.string(),
      });

      let capturedQuery: { from: string; to: string } | undefined;

      app.get(
        '/range',
        ...route(router, {
          summary: 'Get range',
          query: QuerySchema,
          responses: { 200: v.object({ from: v.string(), to: v.string() }) },
          handler: async ({ query }) => {
            // TypeScript should infer query as { from: string; to: string }
            capturedQuery = query;
            return { from: query.from, to: query.to };
          },
        })
      );

      const res = await app.request('/range?from=2024-01-01&to=2024-01-07');
      expect(res.status).toBe(200);
      expect(capturedQuery).toEqual({ from: '2024-01-01', to: '2024-01-07' });

      const body = await res.json();
      expect(body).toEqual({ from: '2024-01-01', to: '2024-01-07' });
    });

    it('should type params based on schema', async () => {
      const app = new Hono();

      // Define a specific params schema
      const ParamsSchema = v.object({
        id: v.string(),
        userId: v.string(),
      });

      let capturedParams: { id: string; userId: string } | undefined;

      app.get(
        '/users/:userId/items/:id',
        ...route(router, {
          summary: 'Get item',
          params: ParamsSchema,
          responses: { 200: v.object({ id: v.string(), userId: v.string() }) },
          handler: async ({ params }) => {
            // TypeScript should infer params as { id: string; userId: string }
            capturedParams = params;
            return { id: params.id, userId: params.userId };
          },
        })
      );

      const res = await app.request('/users/user123/items/item456');
      expect(res.status).toBe(200);
      expect(capturedParams).toEqual({ id: 'item456', userId: 'user123' });

      const body = await res.json();
      expect(body).toEqual({ id: 'item456', userId: 'user123' });
    });

    it('should fallback to Record<string, string> when no query schema is provided', async () => {
      const app = new Hono();

      app.get(
        '/untyped',
        ...route(router, {
          summary: 'Untyped query',
          responses: { 200: v.object({ ok: v.boolean() }) },
          handler: async () => {
            return { ok: true };
          },
        })
      );

      const res = await app.request('/untyped?foo=bar&baz=qux');
      expect(res.status).toBe(200);
      // Query params are not validated, so they may be empty or contain values depending on Hono's behavior
    });

    it('should type both query and params together', async () => {
      const app = new Hono();

      const QuerySchema = v.object({
        limit: v.optional(v.string()),
        offset: v.optional(v.string()),
      });

      const ParamsSchema = v.object({
        projectId: v.string(),
      });

      let capturedQuery: { limit?: string; offset?: string } | undefined;
      let capturedParams: { projectId: string } | undefined;

      app.get(
        '/projects/:projectId/items',
        ...route(router, {
          summary: 'List project items',
          query: QuerySchema,
          params: ParamsSchema,
          responses: {
            200: v.object({
              projectId: v.string(),
              limit: v.optional(v.string()),
              offset: v.optional(v.string()),
            }),
          },
          handler: async ({ query, params }) => {
            capturedQuery = query;
            capturedParams = params;
            return {
              projectId: params.projectId,
              limit: query.limit,
              offset: query.offset,
            };
          },
        })
      );

      const res = await app.request('/projects/proj123/items?limit=10&offset=20');
      expect(res.status).toBe(200);
      expect(capturedParams).toEqual({ projectId: 'proj123' });
      expect(capturedQuery).toEqual({ limit: '10', offset: '20' });

      const body = await res.json();
      expect(body).toEqual({ projectId: 'proj123', limit: '10', offset: '20' });
    });
  });
});
