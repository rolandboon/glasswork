import { Hono } from 'hono';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import type { OpenAPIContext } from '../../src/http/route-helpers.js';
import { route, setOpenAPIContext } from '../../src/http/route-helpers.js';
import { createSerializationConfig } from '../../src/utils/serialize-prisma-types.js';

/** A Decimal.js-shaped value, as Prisma returns it. */
function decimal(fixed: string, asNumber: number) {
  return { constructor: { name: 'Decimal' }, toNumber: () => asNumber, toFixed: () => fixed };
}

/** A router carrying the context bootstrap builds from its `serialization` option. */
function routerWith(context: Partial<OpenAPIContext>): Hono {
  const router = new Hono();
  setOpenAPIContext(router, { processors: [], securitySchemes: [], ...context });
  return router;
}

class Money {
  constructor(
    public amount: number,
    public currency: string
  ) {}
}

describe('route with application-wide serialization', () => {
  it('serializes Decimals as strings when the application configured decimals: "string"', async () => {
    const router = routerWith({
      serialization: createSerializationConfig({ decimals: 'string' }),
    });
    const app = new Hono();
    app.get(
      '/invoice',
      ...route(router, {
        responses: {
          200: v.object({
            total: v.string(),
            lines: v.array(v.object({ amount: v.string() })),
            createdAt: v.string(),
          }),
        },
        // Response types follow GlassworkConfig, which this test program leaves at the
        // defaults; the consumer type tests cover the string declaration.
        handler: () =>
          ({
            total: decimal('1234.50', 1234.5),
            lines: [{ amount: decimal('0.1', 0.1) }, { amount: decimal('1234.40', 1234.4) }],
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
          }) as unknown as { total: string; lines: { amount: string }[]; createdAt: string },
      })
    );

    const response = await app.request('/invoice');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      total: '1234.50',
      lines: [{ amount: '0.1' }, { amount: '1234.40' }],
      createdAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('keeps serializing Decimals as numbers for routers without an application configuration', async () => {
    const router = routerWith({});
    const app = new Hono();
    app.get(
      '/price',
      ...route(router, {
        responses: { 200: v.object({ price: v.number() }) },
        handler: () => ({ price: decimal('10.50', 10.5) }),
      })
    );

    const response = await app.request('/price');

    expect(await response.json()).toEqual({ price: 10.5 });
  });

  it('runs route transformers before application transformers and the built-in ones', async () => {
    const applicationTransformer = (value: unknown) =>
      value instanceof Money ? `${value.amount} ${value.currency}` : undefined;
    const routeTransformer = (value: unknown) =>
      value instanceof Money ? { amount: value.amount, currency: value.currency } : undefined;
    const router = routerWith({
      serialization: createSerializationConfig({ transformers: [applicationTransformer] }),
    });
    const app = new Hono();
    app.get(
      '/application',
      ...route(router, {
        handler: () => ({ price: new Money(99.99, 'USD'), createdAt: new Date(0) }),
      })
    );
    app.get(
      '/route',
      ...route(router, {
        serialization: { transformers: [routeTransformer] },
        handler: () => ({ price: new Money(99.99, 'USD'), createdAt: new Date(0) }),
      })
    );

    expect(await (await app.request('/application')).json()).toEqual({
      price: '99.99 USD',
      createdAt: '1970-01-01T00:00:00.000Z',
    });
    expect(await (await app.request('/route')).json()).toEqual({
      price: { amount: 99.99, currency: 'USD' },
      createdAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('applies application-wide strictTypes unless the route sets strictTypes: false', async () => {
    const router = routerWith({ strictTypes: true });
    const app = new Hono();
    app.get(
      '/strict',
      ...route(router, {
        handler: () => ({ price: decimal('10.50', 10.5) }),
      })
    );
    app.get(
      '/serialized',
      ...route(router, {
        strictTypes: false,
        handler: () => ({ price: decimal('10.50', 10.5) }),
      })
    );

    // Without serialization the Decimal reaches JSON.stringify as a plain object.
    expect(await (await app.request('/strict')).json()).toEqual({
      price: { constructor: { name: 'Decimal' } },
    });
    expect(await (await app.request('/serialized')).json()).toEqual({ price: 10.5 });
  });
});
