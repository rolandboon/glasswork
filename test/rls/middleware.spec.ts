import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { getTenantContext, runWithBypass } from '../../src/rls/context.js';
import { createRLSMiddleware } from '../../src/rls/middleware.js';
import { MissingTenantContextException } from '../../src/rls/types.js';

type TestEnv = { Variables: { user: Record<string, unknown>; auth: Record<string, unknown> } };

describe('RLS Hono Middleware', () => {
  it.each(['user', 'auth'] as const)('accepts %s without optional user metadata', async (key) => {
    const app = new Hono<TestEnv>();
    app.use('*', async (context, next) => {
      context.set(key, { tenantId: 'a' });
      await next();
    });
    app.use('*', createRLSMiddleware());
    app.get('/', (context) => context.json(getTenantContext()));
    expect(await (await app.request('/')).json()).toEqual({ tenantId: 'a' });
  });

  it('clears inherited bypass context for public requests', async () => {
    const app = new Hono<TestEnv>();
    app.use('*', createRLSMiddleware());
    app.get('/', (context) => context.json({ tenant: getTenantContext() }));
    const response = await runWithBypass(() => app.request('/'));
    expect(await response.json()).toEqual({});
  });
  it('extracts tenant context from c.get("user") and binds to ALS', async () => {
    const app = new Hono<TestEnv>();

    app.use('*', async (c, next) => {
      c.set('user', { id: 'u1', tenantId: 'tenant_cwz', role: 'admin' });
      await next();
    });

    app.use('*', createRLSMiddleware());

    app.get('/test', (c) => {
      const ctx = getTenantContext();
      return c.json({ context: ctx });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      context: {
        tenantId: 'tenant_cwz',
        userId: 'u1',
        role: 'admin',
      },
    });
  });

  it('extracts tenant context from c.get("auth")', async () => {
    const app = new Hono<TestEnv>();

    app.use('*', async (c, next) => {
      c.set('auth', { userId: 'u2', tenantId: 'tenant_rijnstate', role: 'member' });
      await next();
    });

    app.use('*', createRLSMiddleware());

    app.get('/test', (c) => {
      const ctx = getTenantContext();
      return c.json({ context: ctx });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      context: {
        tenantId: 'tenant_rijnstate',
        userId: 'u2',
        role: 'member',
      },
    });
  });

  it('supports custom extractTenant function', async () => {
    const app = new Hono<TestEnv>();

    app.use(
      '*',
      createRLSMiddleware({
        extractTenant: (c) => {
          const header = c.req.header('x-tenant-id');
          if (header) {
            return { tenantId: header };
          }
          return undefined;
        },
      })
    );

    app.get('/test', (c) => {
      const ctx = getTenantContext();
      return c.json({ context: ctx });
    });

    const res = await app.request('/test', {
      headers: { 'x-tenant-id': 'tenant_custom_header' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ context: { tenantId: 'tenant_custom_header' } });
  });

  it('allows unauthenticated requests when allowUnauthenticated is true', async () => {
    const app = new Hono<TestEnv>();

    app.use('*', createRLSMiddleware({ allowUnauthenticated: true }));

    app.get('/public', (c) => {
      const ctx = getTenantContext();
      return c.json({ hasContext: Boolean(ctx) });
    });

    const res = await app.request('/public');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hasContext: false });
  });

  it('throws MissingTenantContextException when unauthenticated and allowUnauthenticated is false', async () => {
    const app = new Hono<TestEnv>();

    app.onError((err, c) => {
      if (err instanceof MissingTenantContextException) {
        return c.json({ error: 'unauthorized_tenant' }, 403);
      }
      return c.json({ error: 'other' }, 500);
    });

    app.use('*', createRLSMiddleware({ allowUnauthenticated: false }));

    app.get('/protected', (c) => c.text('ok'));

    const res = await app.request('/protected');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'unauthorized_tenant' });
  });
});
