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

  describe('Automatic key stripping', () => {
    it('should strip extra keys not defined in response schema', async () => {
      const app = new Hono();

      // Define a schema that only allows specific keys
      const UserResponseSchema = v.object({
        id: v.string(),
        email: v.string(),
        name: v.string(),
      });

      app.get(
        '/user',
        ...route(router, {
          summary: 'Get user',
          responses: {
            200: UserResponseSchema,
          },
          handler: async () => {
            // Simulate Prisma returning extra fields (like password, createdAt, etc.)
            return {
              id: '123',
              email: 'user@example.com',
              name: 'John Doe',
              password: 'hashed_password', // Should be stripped
              createdAt: new Date(), // Should be stripped
              updatedAt: new Date(), // Should be stripped
              internalField: 'secret', // Should be stripped
            } as { id: string; email: string; name: string };
          },
        })
      );

      const response = await app.request('/user');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Only the fields defined in the schema should be present
      expect(body).toEqual({
        id: '123',
        email: 'user@example.com',
        name: 'John Doe',
      });

      // Extra fields should be stripped
      expect(body).not.toHaveProperty('password');
      expect(body).not.toHaveProperty('createdAt');
      expect(body).not.toHaveProperty('updatedAt');
      expect(body).not.toHaveProperty('internalField');
    });

    it('should strip extra keys from union response types', async () => {
      const app = new Hono();

      const SuccessSchema = v.object({
        success: v.boolean(),
        data: v.string(),
      });

      const ErrorSchema = v.object({
        success: v.boolean(),
        error: v.string(),
      });

      app.post(
        '/action',
        ...route(router, {
          summary: 'Perform action',
          body: v.object({ shouldFail: v.boolean() }),
          responses: {
            200: SuccessSchema,
            201: ErrorSchema,
          },
          handler: async ({ body }) => {
            if (body.shouldFail) {
              // Return error type with extra fields
              return {
                success: false,
                error: 'Action failed',
                internalError: 'Database error', // Should be stripped
                stackTrace: 'Error at line...', // Should be stripped
              } as { success: boolean; error: string };
            }

            // Return success type with extra fields
            return {
              success: true,
              data: 'Action completed',
              metadata: { timing: 123 }, // Should be stripped
              debug: 'Some debug info', // Should be stripped
            } as { success: boolean; data: string };
          },
        })
      );

      // Test success response
      const successResponse = await app.request('/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldFail: false }),
      });

      expect(successResponse.status).toBe(200);
      const successBody = await successResponse.json();
      expect(successBody).toEqual({
        success: true,
        data: 'Action completed',
      });
      expect(successBody).not.toHaveProperty('metadata');
      expect(successBody).not.toHaveProperty('debug');

      // Test error response
      const errorResponse = await app.request('/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldFail: true }),
      });

      expect(errorResponse.status).toBe(201);
      const errorBody = await errorResponse.json();
      expect(errorBody).toEqual({
        success: false,
        error: 'Action failed',
      });
      expect(errorBody).not.toHaveProperty('internalError');
      expect(errorBody).not.toHaveProperty('stackTrace');
    });

    it('should handle arrays in response and strip extra keys from elements', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
      });

      app.get(
        '/users',
        ...route(router, {
          summary: 'List users',
          responses: {
            200: v.array(UserSchema),
          },
          handler: async () => {
            // Simulate database returning extra fields
            return [
              { id: '1', name: 'Alice', password: 'secret1', role: 'admin' },
              { id: '2', name: 'Bob', password: 'secret2', role: 'user' },
            ] as unknown as { id: string; name: string }[];
          },
        })
      );

      const response = await app.request('/users');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);

      // Each element should not have the extra fields
      for (const user of body) {
        expect(user).not.toHaveProperty('password');
        expect(user).not.toHaveProperty('role');
      }
    });

    it('should return data as-is when no response schema is defined', async () => {
      const app = new Hono();

      app.get(
        '/raw',
        ...route(router, {
          summary: 'Raw response',
          // No response schema defined
          handler: async () => {
            return {
              id: '123',
              extraField: 'should remain',
              anotherExtra: 'also remains',
            };
          },
        })
      );

      const response = await app.request('/raw');
      expect(response.status).toBe(200);
      const body = await response.json();

      // All fields should be present since no schema is defined
      expect(body).toEqual({
        id: '123',
        extraField: 'should remain',
        anotherExtra: 'also remains',
      });
    });
  });
});
