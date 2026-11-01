import { Hono } from 'hono';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../../src/core/types.js';
import { route } from '../../src/http/route-helpers.js';
import type { RouteContext } from '../../src/http/route-types.js';
import { createTestRouter } from '../helpers/route.js';

const ItemDto = v.object({ id: v.string() });
type Handler = (context: RouteContext) => unknown;

async function request(
  responses: Record<number, v.GenericSchema>,
  handler: Handler,
  environment: Environment = 'development'
) {
  const router = createTestRouter();
  const app = new Hono();
  app.onError((error, c) => c.json({ error: error.message }, 500));
  app.get(
    '/item',
    ...route(router, {
      summary: 'Item',
      public: true,
      responses: responses as never,
      handler: handler as never,
    })
  );
  // Routes registered outside bootstrap detect the environment.
  vi.stubEnv('NODE_ENV', environment);
  try {
    return await app.request('/item');
  } finally {
    vi.unstubAllEnvs();
  }
}

describe('response status selection', () => {
  it('keeps an explicit status when its schema overlaps an earlier one', async () => {
    const response = await request({ 200: ItemDto, 201: ItemDto }, ({ context }) => {
      context.status(201);
      return { id: 'a1', secret: 'x' };
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'a1' });
  });

  it('keeps an explicit 200 when a later schema also matches', async () => {
    const response = await request({ 200: ItemDto, 201: ItemDto }, ({ context }) => {
      context.status(200);
      return { id: 'a1' };
    });

    expect(response.status).toBe(200);
  });

  it('uses the first matching schema without an explicit status', async () => {
    const both = await request({ 200: ItemDto, 201: ItemDto }, () => ({ id: 'a1' }));
    const createdOnly = await request({ 201: ItemDto }, () => ({ id: 'a1' }));

    expect(both.status).toBe(200);
    expect(createdOnly.status).toBe(201);
  });

  it('falls back to schema matching when the explicit status has no schema', async () => {
    const response = await request({ 200: ItemDto }, ({ context }) => {
      context.status(202);
      return { id: 'a1' };
    });

    expect(response.status).toBe(200);
  });

  it('does not switch to another schema when data fails the explicit one', async () => {
    const responses = { 200: v.object({ name: v.string() }), 201: ItemDto };
    const handler: Handler = ({ context }) => {
      context.status(201);
      return { name: 'not an item' };
    };

    const production = await request(responses, handler, 'production');
    const development = await request(responses, handler, 'development');

    expect(production.status).toBe(500);
    expect(development.status).toBe(201);
    expect(await development.json()).toEqual({ name: 'not an item' });
  });

  it('keeps headers set by the handler', async () => {
    const response = await request({ 201: ItemDto }, ({ context }) => {
      context.header('Location', '/items/a1');
      context.status(201);
      return { id: 'a1' };
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe('/items/a1');
  });

  it('returns a native Response unchanged', async () => {
    const response = await request({ 200: ItemDto }, () =>
      Response.redirect('https://example.com/items/a1', 302)
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/items/a1');
  });
});
