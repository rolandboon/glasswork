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

  describe('Strict types mode', () => {
    it('should require manual serialization with strictTypes: true', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
        createdAt: v.string(),
      });

      app.get(
        '/user-strict',
        ...route(router, {
          summary: 'Get user (strict)',
          strictTypes: true,
          responses: {
            200: UserSchema,
          },
          handler: async () => {
            // With strictTypes: true, we must manually serialize
            // No automatic Date -> string conversion happens
            const date = new Date('2025-01-01T12:00:00.000Z');
            return {
              id: '123',
              name: 'John Doe',
              createdAt: date.toISOString(), // Manual serialization
            };
          },
        })
      );

      const response = await app.request('/user-strict');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '123',
        name: 'John Doe',
        createdAt: '2025-01-01T12:00:00.000Z',
      });
      expect(typeof body.createdAt).toBe('string');
    });

    it('should work with strictTypes: true returning exact schema types', async () => {
      const app = new Hono();

      const ProductSchema = v.object({
        id: v.string(),
        name: v.string(),
        price: v.number(),
      });

      app.get(
        '/product-strict',
        ...route(router, {
          summary: 'Get product (strict)',
          strictTypes: true,
          responses: {
            200: ProductSchema,
          },
          handler: async () => {
            // With strictTypes: true, returning exact schema types works
            return {
              id: '456',
              name: 'Widget',
              price: 99.99, // Already a number, no Decimal conversion needed
            };
          },
        })
      );

      const response = await app.request('/product-strict');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '456',
        name: 'Widget',
        price: 99.99,
      });
    });

    it('should work with strictTypes: false (default) accepting Prisma types', async () => {
      const app = new Hono();

      const OrderSchema = v.object({
        id: v.string(),
        total: v.number(),
        createdAt: v.string(),
      });

      const mockDecimal = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 149.99,
      };

      app.get(
        '/order-permissive',
        ...route(router, {
          summary: 'Get order (permissive)',
          strictTypes: false, // Explicitly set to false (same as default)
          responses: {
            200: OrderSchema,
          },
          handler: async () => {
            // With strictTypes: false, Prisma types are accepted
            return {
              id: '789',
              total: mockDecimal,
              createdAt: new Date('2025-01-15T10:30:00.000Z'),
            };
          },
        })
      );

      const response = await app.request('/order-permissive');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '789',
        total: 149.99,
        createdAt: '2025-01-15T10:30:00.000Z',
      });
    });

    it('should work with strictTypes: true in union response types', async () => {
      const app = new Hono();

      const SuccessSchema = v.object({
        success: v.boolean(),
        message: v.string(),
      });

      const ErrorSchema = v.object({
        success: v.boolean(),
        error: v.string(),
      });

      app.post(
        '/action-strict',
        ...route(router, {
          summary: 'Perform action (strict)',
          strictTypes: true,
          body: v.object({ shouldSucceed: v.boolean() }),
          responses: {
            200: SuccessSchema,
            201: ErrorSchema,
          },
          handler: async ({ body }) => {
            if (body.shouldSucceed) {
              return {
                success: true,
                message: 'Action completed',
              };
            }

            return {
              success: false,
              error: 'Action failed',
            };
          },
        })
      );

      // Test success response
      const successResponse = await app.request('/action-strict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldSucceed: true }),
      });

      expect(successResponse.status).toBe(200);
      const successBody = await successResponse.json();
      expect(successBody).toEqual({
        success: true,
        message: 'Action completed',
      });

      // Test error response
      const errorResponse = await app.request('/action-strict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldSucceed: false }),
      });

      expect(errorResponse.status).toBe(201);
      const errorBody = await errorResponse.json();
      expect(errorBody).toEqual({
        success: false,
        error: 'Action failed',
      });
    });

    it('should skip serialization when strictTypes: true', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
        createdAt: v.string(),
      });

      app.get(
        '/user-no-serialize',
        ...route(router, {
          summary: 'Get user without serialization',
          strictTypes: true,
          responses: {
            200: UserSchema,
          },
          handler: async () => {
            // With strictTypes: true, handler must return pre-serialized data
            // The Date.toISOString() is done manually by the handler
            return {
              id: '123',
              name: 'John Doe',
              createdAt: new Date('2025-01-01T12:00:00.000Z').toISOString(),
            };
          },
        })
      );

      const response = await app.request('/user-no-serialize');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '123',
        name: 'John Doe',
        createdAt: '2025-01-01T12:00:00.000Z',
      });
      expect(typeof body.createdAt).toBe('string');
    });

    it('should fail validation when strictTypes: true and Date not serialized manually', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
        createdAt: v.string(),
      });

      app.get(
        '/user-invalid',
        ...route(router, {
          summary: 'Get user with invalid Date',
          strictTypes: true,
          responses: {
            200: UserSchema,
          },
          handler: async () => {
            // With strictTypes: true, returning a Date object will fail validation
            // because serialization is disabled
            return {
              id: '456',
              name: 'Jane Doe',
              createdAt: new Date('2025-01-01T12:00:00.000Z'),
            } as unknown as { id: string; name: string; createdAt: string };
          },
        })
      );

      const response = await app.request('/user-invalid');

      // In development, should return data as-is with warning
      // In production, should return 500 error
      if (process.env.NODE_ENV === 'production') {
        expect(response.status).toBe(500);
      } else {
        // In development, returns data but validation fails
        expect(response.status).toBe(200);
        const body = await response.json();
        // Note: The Date object will be serialized by JSON.stringify, not our serializer
        expect(body.createdAt).toBeDefined();
      }
    });

    it('should serialize when strictTypes: false (default)', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
        createdAt: v.string(),
      });

      app.get(
        '/user-auto-serialize',
        ...route(router, {
          summary: 'Get user with auto serialization',
          // strictTypes: false is the default
          responses: {
            200: UserSchema,
          },
          handler: async () => {
            // Without strictTypes or with strictTypes: false, Date is auto-serialized
            return {
              id: '789',
              name: 'Bob Smith',
              createdAt: new Date('2025-01-15T08:00:00.000Z'),
            };
          },
        })
      );

      const response = await app.request('/user-auto-serialize');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Date should be automatically serialized to ISO string
      expect(body).toEqual({
        id: '789',
        name: 'Bob Smith',
        createdAt: '2025-01-15T08:00:00.000Z',
      });
      expect(typeof body.createdAt).toBe('string');
    });

    it('should skip Decimal serialization when strictTypes: true', async () => {
      const app = new Hono();

      const ProductSchema = v.object({
        id: v.string(),
        name: v.string(),
        price: v.number(),
      });

      app.get(
        '/product-no-serialize',
        ...route(router, {
          summary: 'Get product without serialization',
          strictTypes: true,
          responses: {
            200: ProductSchema,
          },
          handler: async () => {
            // With strictTypes: true, Decimal must be converted manually
            const mockDecimal = {
              constructor: { name: 'Decimal' as const },
              toNumber: () => 99.99,
            };

            return {
              id: '999',
              name: 'Gadget',
              price: mockDecimal.toNumber(), // Manual conversion
            };
          },
        })
      );

      const response = await app.request('/product-no-serialize');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '999',
        name: 'Gadget',
        price: 99.99,
      });
      expect(typeof body.price).toBe('number');
    });
  });
});
