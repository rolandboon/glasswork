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

  it('should serialize Date and Decimal in nested objects', async () => {
    const app = new Hono();

    const OrderWithDetailsSchema = v.object({
      id: v.string(),
      createdAt: v.string(),
      customer: v.object({
        name: v.string(),
        joinedAt: v.string(),
      }),
      items: v.array(
        v.object({
          name: v.string(),
          price: v.number(),
          addedAt: v.string(),
        })
      ),
    });

    const mockDecimal1 = {
      constructor: { name: 'Decimal' as const },
      toNumber: () => 19.99,
    };

    const mockDecimal2 = {
      constructor: { name: 'Decimal' as const },
      toNumber: () => 29.99,
    };

    app.get(
      '/order-details',
      ...route(router, {
        summary: 'Get order with details',
        responses: {
          200: OrderWithDetailsSchema,
        },
        handler: async () => {
          return {
            id: '999',
            createdAt: new Date('2025-01-20T08:00:00.000Z'),
            customer: {
              name: 'Alice',
              joinedAt: new Date('2024-06-15T12:00:00.000Z'),
            },
            items: [
              {
                name: 'Item A',
                price: mockDecimal1,
                addedAt: new Date('2025-01-20T08:05:00.000Z'),
              },
              {
                name: 'Item B',
                price: mockDecimal2,
                addedAt: new Date('2025-01-20T08:10:00.000Z'),
              },
            ],
          };
        },
      })
    );

    const response = await app.request('/order-details');
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toEqual({
      id: '999',
      createdAt: '2025-01-20T08:00:00.000Z',
      customer: {
        name: 'Alice',
        joinedAt: '2024-06-15T12:00:00.000Z',
      },
      items: [
        {
          name: 'Item A',
          price: 19.99,
          addedAt: '2025-01-20T08:05:00.000Z',
        },
        {
          name: 'Item B',
          price: 29.99,
          addedAt: '2025-01-20T08:10:00.000Z',
        },
      ],
    });

    // Verify all types are correctly serialized
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.customer.joinedAt).toBe('string');
    for (const item of body.items) {
      expect(typeof item.price).toBe('number');
      expect(typeof item.addedAt).toBe('string');
    }
  });

  it('should handle null values without serializing them', async () => {
    const app = new Hono();

    const UserSchema = v.object({
      id: v.string(),
      name: v.string(),
      deletedAt: v.nullable(v.string()),
      lastLoginAt: v.nullable(v.string()),
    });

    app.get(
      '/user-with-nulls',
      ...route(router, {
        summary: 'Get user with nullable fields',
        responses: {
          200: UserSchema,
        },
        handler: async () => {
          return {
            id: '123',
            name: 'John',
            deletedAt: null, // null should remain null
            lastLoginAt: new Date('2025-01-10T09:00:00.000Z'), // Date should be serialized
          };
        },
      })
    );

    const response = await app.request('/user-with-nulls');
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toEqual({
      id: '123',
      name: 'John',
      deletedAt: null,
      lastLoginAt: '2025-01-10T09:00:00.000Z',
    });
    expect(body.deletedAt).toBeNull();
    expect(typeof body.lastLoginAt).toBe('string');
  });

  it('should serialize Prisma types in union responses', async () => {
    const app = new Hono();

    const SuccessSchema = v.object({
      success: v.boolean(),
      amount: v.number(),
      processedAt: v.string(),
    });

    const PendingSchema = v.object({
      success: v.boolean(),
      estimatedAmount: v.number(),
      estimatedAt: v.string(),
    });

    const mockDecimal1 = {
      constructor: { name: 'Decimal' as const },
      toNumber: () => 100.5,
    };

    const mockDecimal2 = {
      constructor: { name: 'Decimal' as const },
      toNumber: () => 95.0,
    };

    app.post(
      '/process',
      ...route(router, {
        summary: 'Process payment',
        body: v.object({ immediate: v.boolean() }),
        responses: {
          200: SuccessSchema,
          201: PendingSchema,
        },
        handler: async ({ body }) => {
          if (body.immediate) {
            return {
              success: true,
              amount: mockDecimal1,
              processedAt: new Date('2025-01-25T15:00:00.000Z'),
            } as const;
          }

          return {
            success: false,
            estimatedAmount: mockDecimal2,
            estimatedAt: new Date('2025-01-26T15:00:00.000Z'),
          } as const;
        },
      })
    );

    // Test immediate processing (200)
    const successResponse = await app.request('/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ immediate: true }),
    });

    expect(successResponse.status).toBe(200);
    const successBody = await successResponse.json();
    expect(successBody).toEqual({
      success: true,
      amount: 100.5,
      processedAt: '2025-01-25T15:00:00.000Z',
    });

    // Test pending processing (201)
    const pendingResponse = await app.request('/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ immediate: false }),
    });

    expect(pendingResponse.status).toBe(201);
    const pendingBody = await pendingResponse.json();
    expect(pendingBody).toEqual({
      success: false,
      estimatedAmount: 95.0,
      estimatedAt: '2025-01-26T15:00:00.000Z',
    });
  });

  it('should serialize Prisma types before schema validation and key stripping', async () => {
    const app = new Hono();

    // Schema only expects specific fields with string/number types
    const ResponseSchema = v.object({
      id: v.string(),
      price: v.number(),
      createdAt: v.string(),
    });

    const mockDecimal = {
      constructor: { name: 'Decimal' as const },
      toNumber: () => 199.99,
    };

    app.get(
      '/product-full',
      ...route(router, {
        summary: 'Get product',
        responses: {
          200: ResponseSchema,
        },
        handler: async () => {
          // Simulate Prisma returning extra fields + Prisma types
          return {
            id: '777',
            price: mockDecimal, // Decimal (will be serialized to number)
            createdAt: new Date('2025-01-30T12:00:00.000Z'), // Date (will be serialized to string)
            updatedAt: new Date('2025-01-31T12:00:00.000Z'), // Extra field (will be stripped)
            internalCode: 'XYZ123', // Extra field (will be stripped)
          };
        },
      })
    );

    const response = await app.request('/product-full');
    expect(response.status).toBe(200);
    const body = await response.json();

    // Should have serialized types AND stripped extra keys
    expect(body).toEqual({
      id: '777',
      price: 199.99, // Serialized from Decimal
      createdAt: '2025-01-30T12:00:00.000Z', // Serialized from Date
    });

    // Verify extra fields are stripped
    expect(body).not.toHaveProperty('updatedAt');
    expect(body).not.toHaveProperty('internalCode');

    // Verify types are correct
    expect(typeof body.price).toBe('number');
    expect(typeof body.createdAt).toBe('string');
  });
});
