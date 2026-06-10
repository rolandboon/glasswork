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

  describe('Prisma type serialization', () => {
    it('should automatically serialize Date objects to ISO strings', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        name: v.string(),
        createdAt: v.string(), // Schema expects string
      });

      app.get(
        '/user',
        ...route(router, {
          summary: 'Get user',
          responses: {
            200: UserSchema,
          },
          handler: async () => {
            // Handler returns Date object (simulating Prisma result)
            return {
              id: '123',
              name: 'John Doe',
              createdAt: new Date('2025-01-01T12:00:00.000Z'), // Date object
            };
          },
        })
      );

      const response = await app.request('/user');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Date should be serialized to ISO string
      expect(body).toEqual({
        id: '123',
        name: 'John Doe',
        createdAt: '2025-01-01T12:00:00.000Z',
      });
      expect(typeof body.createdAt).toBe('string');
    });

    it('should automatically serialize Decimal objects to numbers', async () => {
      const app = new Hono();

      const ProductSchema = v.object({
        id: v.string(),
        name: v.string(),
        price: v.number(), // Schema expects number
      });

      // Mock Decimal object (simulating Prisma Decimal)
      const mockDecimal = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 99.99,
      };

      app.get(
        '/product',
        ...route(router, {
          summary: 'Get product',
          responses: {
            200: ProductSchema,
          },
          handler: async () => {
            // Handler returns Decimal object (simulating Prisma result)
            return {
              id: '456',
              name: 'Widget',
              price: mockDecimal, // Decimal object
            };
          },
        })
      );

      const response = await app.request('/product');
      expect(response.status).toBe(200);
      const body = await response.json();

      // Decimal should be serialized to number
      expect(body).toEqual({
        id: '456',
        name: 'Widget',
        price: 99.99,
      });
      expect(typeof body.price).toBe('number');
    });

    it('should serialize Prisma Decimal objects with internal structure (s, e, d)', async () => {
      const app = new Hono();

      const MaterialSchema = v.object({
        id: v.string(),
        density: v.number(),
        thickness: v.number(),
        price: v.number(),
      });

      // Mock Decimal objects matching actual Prisma Decimal.js structure
      const mockDensity = {
        s: 1,
        e: 0,
        d: [1, 2000000],
        toNumber: () => 1.2,
      };

      const mockThickness = {
        s: 1,
        e: -1,
        d: [2000000],
        toNumber: () => 0.2,
      };

      const mockPrice = {
        s: 1,
        e: 1,
        d: [25, 5000000],
        toNumber: () => 25.5,
      };

      app.get(
        '/material',
        ...route(router, {
          summary: 'Get material',
          responses: {
            200: MaterialSchema,
          },
          handler: async () => {
            // Handler returns Prisma Decimal objects with internal structure
            return {
              id: '789',
              density: mockDensity,
              thickness: mockThickness,
              price: mockPrice,
            };
          },
        })
      );

      const response = await app.request('/material');
      expect(response.status).toBe(200);
      const body = await response.json();

      // All Decimal fields should be serialized to numbers
      expect(body).toEqual({
        id: '789',
        density: 1.2,
        thickness: 0.2,
        price: 25.5,
      });
      expect(typeof body.density).toBe('number');
      expect(typeof body.thickness).toBe('number');
      expect(typeof body.price).toBe('number');
    });

    it('should serialize both Date and Decimal in the same object', async () => {
      const app = new Hono();

      const OrderSchema = v.object({
        id: v.string(),
        total: v.number(), // Schema expects number
        createdAt: v.string(), // Schema expects string
      });

      const mockDecimal = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 149.99,
      };

      app.get(
        '/order',
        ...route(router, {
          summary: 'Get order',
          responses: {
            200: OrderSchema,
          },
          handler: async () => {
            return {
              id: '789',
              total: mockDecimal, // Decimal object
              createdAt: new Date('2025-01-15T10:30:00.000Z'), // Date object
            };
          },
        })
      );

      const response = await app.request('/order');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '789',
        total: 149.99,
        createdAt: '2025-01-15T10:30:00.000Z',
      });
      expect(typeof body.total).toBe('number');
      expect(typeof body.createdAt).toBe('string');
    });

    it('should serialize Date and Decimal in arrays', async () => {
      const app = new Hono();

      const TransactionSchema = v.object({
        id: v.string(),
        amount: v.number(),
        timestamp: v.string(),
      });

      const mockDecimal1 = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 25.5,
      };

      const mockDecimal2 = {
        constructor: { name: 'Decimal' as const },
        toNumber: () => 75.25,
      };

      app.get(
        '/transactions',
        ...route(router, {
          summary: 'List transactions',
          responses: {
            200: v.array(TransactionSchema),
          },
          handler: async () => {
            return [
              {
                id: '1',
                amount: mockDecimal1,
                timestamp: new Date('2025-01-01T10:00:00.000Z'),
              },
              {
                id: '2',
                amount: mockDecimal2,
                timestamp: new Date('2025-01-02T14:00:00.000Z'),
              },
            ];
          },
        })
      );

      const response = await app.request('/transactions');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual([
        {
          id: '1',
          amount: 25.5,
          timestamp: '2025-01-01T10:00:00.000Z',
        },
        {
          id: '2',
          amount: 75.25,
          timestamp: '2025-01-02T14:00:00.000Z',
        },
      ]);

      // Verify types
      for (const transaction of body) {
        expect(typeof transaction.amount).toBe('number');
        expect(typeof transaction.timestamp).toBe('string');
      }
    });
  });
});
