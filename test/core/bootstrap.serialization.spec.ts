import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { BootstrapOptions } from '../../src/core/types.js';
import { createRoutes } from '../../src/http/route-helpers.js';

/** A Decimal.js-shaped value, as Prisma returns it. */
function decimal(fixed: string, asNumber: number) {
  return { constructor: { name: 'Decimal' }, toNumber: () => asNumber, toFixed: () => fixed };
}

class Money {
  constructor(public amount: string) {}
}

/**
 * The option's type follows the GlassworkConfig declaration, which this test program leaves
 * at the defaults; the consumer type tests cover the declaration.
 */
function serialization(options: Record<string, unknown>): BootstrapOptions['serialization'] {
  return options as BootstrapOptions['serialization'];
}

describe('bootstrap serialization option', () => {
  const routes = createRoutes((router, _services, route) => {
    router.get(
      '/invoice',
      ...route({
        responses: { 200: v.object({ total: v.string() }) },
        handler: () => ({ total: decimal('10.50', 10.5) as unknown as string }),
      })
    );
    router.get(
      '/raw',
      ...route({ handler: () => ({ total: decimal('10.50', 10.5), paid: new Money('10.50') }) })
    );
    router.get(
      '/serialized',
      ...route({ strictTypes: false, handler: () => ({ total: decimal('10.50', 10.5) }) })
    );
  });
  const module = defineModule({ name: 'billing', basePath: 'billing', providers: [], routes });

  it('serializes Decimals as strings for every route with decimals: "string"', async () => {
    const { app } = await bootstrap(module, {
      environment: 'test',
      serialization: serialization({ decimals: 'string' }),
    });

    const response = await app.request('/api/billing/invoice');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total: '10.50' });
  });

  it('serializes Decimals as numbers without the option', async () => {
    const { app } = await bootstrap(module, { environment: 'test' });

    expect(await (await app.request('/api/billing/raw')).json()).toEqual({
      total: 10.5,
      paid: { amount: '10.50' },
    });
  });

  it('applies strictTypes to every route unless the route sets strictTypes: false', async () => {
    const { app } = await bootstrap(module, {
      environment: 'test',
      serialization: serialization({ strictTypes: true }),
    });

    // Without serialization the Decimal reaches JSON.stringify as a plain object.
    expect(await (await app.request('/api/billing/raw')).json()).toEqual({
      total: { constructor: { name: 'Decimal' } },
      paid: { amount: '10.50' },
    });
    expect(await (await app.request('/api/billing/serialized')).json()).toEqual({ total: 10.5 });
  });

  it('runs application transformers for every route', async () => {
    const { app } = await bootstrap(module, {
      environment: 'test',
      serialization: serialization({
        transformers: [(value: unknown) => (value instanceof Money ? value.amount : undefined)],
      }),
    });

    expect(await (await app.request('/api/billing/raw')).json()).toEqual({
      total: 10.5,
      paid: '10.50',
    });
  });
});
