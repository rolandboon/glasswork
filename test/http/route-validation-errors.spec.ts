import { Hono } from 'hono';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { createValidationMiddleware } from '../../src/http/route-validation.js';
import { createRateLimitMiddleware } from '../../src/middleware/rate-limit.js';

describe('error codes outside the error handler', () => {
  it('marks request validation failures with validation-failed', async () => {
    const app = new Hono();
    app.post('/', createValidationMiddleware('json', v.object({ name: v.string() })), (c) =>
      c.json({})
    );

    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ name: 1 }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: 'Validation failed',
      code: 'validation-failed',
    });
  });

  it('returns issues as message and path without echoing the request', async () => {
    const app = new Hono();
    const schema = v.object({
      user: v.object({ email: v.pipe(v.string(), v.email('Invalid email')) }),
      password: v.string(),
      tags: v.array(v.string('Tags must be text')),
    });
    app.post('/', createValidationMiddleware('json', schema), (c) => c.json({}));

    const res = await app.request('/', {
      method: 'POST',
      body: JSON.stringify({ user: { email: 'x' }, password: 'secret-value', tags: [1] }),
      headers: { 'content-type': 'application/json' },
    });
    const text = await res.text();

    expect(JSON.parse(text)).toEqual({
      error: 'Validation failed',
      code: 'validation-failed',
      issues: [
        { message: 'Invalid email', path: ['user', 'email'] },
        { message: 'Tags must be text', path: ['tags', 0] },
      ],
    });
    expect(text).not.toContain('secret-value');
  });

  it('marks rate limited requests with too-many-requests', async () => {
    const app = new Hono();
    app.use(createRateLimitMiddleware({ enabled: true, maxRequests: 1, windowMs: 60_000 }));
    app.get('/', (c) => c.json({}));

    await app.request('/');
    const res = await app.request('/');

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Too Many Requests', code: 'too-many-requests' });
  });
});
