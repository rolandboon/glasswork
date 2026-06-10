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

  describe('Custom serialization transformers', () => {
    it('should apply custom transformers via serialization config', async () => {
      const app = new Hono();

      // Mock custom type
      class Money {
        constructor(
          public amount: number,
          public currency: string
        ) {}
      }

      const moneyTransformer = (value: unknown) => {
        if (value instanceof Money) {
          return { amount: value.amount, currency: value.currency };
        }
        return undefined;
      };

      const ProductSchema = v.object({
        id: v.string(),
        name: v.string(),
        price: v.object({
          amount: v.number(),
          currency: v.string(),
        }),
      });

      app.get(
        '/product-custom',
        ...route(router, {
          summary: 'Get product with custom Money type',
          responses: {
            200: ProductSchema,
          },
          serialization: {
            transformers: [moneyTransformer],
          },
          handler: async () => {
            return {
              id: '123',
              name: 'Widget',
              price: new Money(99.99, 'USD'),
            };
          },
        })
      );

      const response = await app.request('/product-custom');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '123',
        name: 'Widget',
        price: {
          amount: 99.99,
          currency: 'USD',
        },
      });
    });

    it('should apply custom transformers AND default transformers', async () => {
      const app = new Hono();

      class Money {
        constructor(
          public amount: number,
          public currency: string
        ) {}
      }

      const moneyTransformer = (value: unknown) => {
        if (value instanceof Money) {
          return `${value.amount} ${value.currency}`;
        }
        return undefined;
      };

      const OrderSchema = v.object({
        id: v.string(),
        total: v.string(), // Money becomes string
        createdAt: v.string(), // Date becomes string
      });

      app.get(
        '/order-mixed',
        ...route(router, {
          summary: 'Get order with custom and default types',
          responses: {
            200: OrderSchema,
          },
          serialization: {
            transformers: [moneyTransformer],
          },
          handler: async () => {
            return {
              id: '789',
              total: new Money(149.99, 'USD'),
              createdAt: new Date('2025-01-15T10:30:00.000Z'),
            } as unknown as { id: string; total: string; createdAt: string };
          },
        })
      );

      const response = await app.request('/order-mixed');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '789',
        total: '149.99 USD', // Custom transformer
        createdAt: '2025-01-15T10:30:00.000Z', // Default transformer
      });
    });

    it('should work with custom transformers in nested structures', async () => {
      const app = new Hono();

      class Coordinates {
        constructor(
          public lat: number,
          public lng: number
        ) {}
      }

      const coordsTransformer = (value: unknown) => {
        if (value instanceof Coordinates) {
          return { latitude: value.lat, longitude: value.lng };
        }
        return undefined;
      };

      const LocationSchema = v.object({
        name: v.string(),
        position: v.object({
          latitude: v.number(),
          longitude: v.number(),
        }),
      });

      app.get(
        '/location',
        ...route(router, {
          summary: 'Get location',
          responses: {
            200: LocationSchema,
          },
          serialization: {
            transformers: [coordsTransformer],
          },
          handler: async () => {
            return {
              name: 'Office',
              position: new Coordinates(52.52, 13.405),
            } as unknown as { name: string; position: { latitude: number; longitude: number } };
          },
        })
      );

      const response = await app.request('/location');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        name: 'Office',
        position: {
          latitude: 52.52,
          longitude: 13.405,
        },
      });
    });

    it('should work without custom transformers (default behavior)', async () => {
      const app = new Hono();

      const UserSchema = v.object({
        id: v.string(),
        createdAt: v.string(),
      });

      app.get(
        '/user-default',
        ...route(router, {
          summary: 'Get user (default serialization)',
          responses: {
            200: UserSchema,
          },
          // No serialization config - should use defaults
          handler: async () => {
            return {
              id: '123',
              createdAt: new Date('2025-01-01T12:00:00.000Z'),
            };
          },
        })
      );

      const response = await app.request('/user-default');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({
        id: '123',
        createdAt: '2025-01-01T12:00:00.000Z',
      });
    });
  });
});
