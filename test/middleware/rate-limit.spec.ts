import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimitMiddleware } from '../../src/middleware/rate-limit.js';

describe('createRateLimitMiddleware', () => {
  let useFakeTimers = false;

  beforeEach(() => {
    if (useFakeTimers) {
      vi.useFakeTimers();
    }
  });

  afterEach(() => {
    if (useFakeTimers) {
      vi.useRealTimers();
      useFakeTimers = false;
    }
  });

  it('should allow requests within rate limit', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
        maxRequests: 5,
        windowMs: 60000,
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    const response = await app.request('/test');

    expect(response.status).toBe(200);
    expect(response.headers.get('RateLimit-Limit')).toBe('5');
    expect(response.headers.get('RateLimit-Remaining')).toBe('4');
  });

  it('should block requests that exceed rate limit', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
        maxRequests: 2,
        windowMs: 60000,
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    // First request - should succeed
    await app.request('/test');
    // Second request - should succeed
    await app.request('/test');
    // Third request - should be rate limited
    const response3 = await app.request('/test');

    expect(response3.status).toBe(429);
    expect(response3.headers.get('RateLimit-Remaining')).toBe('0');
    expect(response3.headers.get('Retry-After')).toBeTruthy();
  });

  it('should set correct rate limit headers', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
        maxRequests: 10,
        windowMs: 60000,
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    const response = await app.request('/test');

    expect(response.headers.get('RateLimit-Limit')).toBe('10');
    expect(response.headers.get('RateLimit-Remaining')).toBe('9');
    expect(response.headers.get('RateLimit-Reset')).toBeTruthy();
  });

  it('should reset count after window expires', async () => {
    useFakeTimers = true;
    vi.useFakeTimers();

    const app = new Hono();
    const windowMs = 10000; // 10 seconds
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
        maxRequests: 2,
        windowMs,
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    // First request
    await app.request('/test');
    // Second request
    await app.request('/test');
    // Third request - should be rate limited
    const response3 = await app.request('/test');
    expect(response3.status).toBe(429);

    // Advance time past the window
    vi.advanceTimersByTime(windowMs + 1000);

    // Fourth request - should succeed after window reset
    const response4 = await app.request('/test');
    expect(response4.status).toBe(200);
    expect(response4.headers.get('RateLimit-Remaining')).toBe('1');
  });

  it('should use default values when not specified', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    const response = await app.request('/test');

    expect(response.headers.get('RateLimit-Limit')).toBe('100');
    expect(response.headers.get('RateLimit-Remaining')).toBe('99');
  });

  it('should extract client IP from x-forwarded-for header', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
        maxRequests: 1,
        windowMs: 60000,
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    // First request from IP1
    await app.request('/test', {
      headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
    });

    // Second request from same IP - should be rate limited
    const response2 = await app.request('/test', {
      headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
    });
    expect(response2.status).toBe(429);

    // Request from different IP - should succeed
    const response3 = await app.request('/test', {
      headers: { 'x-forwarded-for': '192.168.1.2' },
    });
    expect(response3.status).toBe(200);
  });

  it('should extract client IP from x-real-ip header', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
        maxRequests: 1,
        windowMs: 60000,
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    // First request
    await app.request('/test', {
      headers: { 'x-real-ip': '192.168.1.1' },
    });

    // Second request from same IP - should be rate limited
    const response2 = await app.request('/test', {
      headers: { 'x-real-ip': '192.168.1.1' },
    });
    expect(response2.status).toBe(429);
  });

  it('should handle missing IP headers gracefully', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
        maxRequests: 1,
        windowMs: 60000,
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    // First request without IP header
    const response1 = await app.request('/test');
    expect(response1.status).toBe(200);

    // Second request without IP header - should be rate limited (all use 'unknown')
    const response2 = await app.request('/test');
    expect(response2.status).toBe(429);
  });

  it.skip('should decrement remaining count correctly', async () => {
    const app = new Hono();
    app.use(
      '*',
      createRateLimitMiddleware({
        enabled: true,
        storage: 'memory',
        maxRequests: 3,
        windowMs: 60000,
      })
    );
    app.get('/test', (context) => context.json({ success: true }));

    const response1 = await app.request('/test');
    expect(response1.headers.get('RateLimit-Remaining')).toBe('2');

    const response2 = await app.request('/test');
    expect(response2.headers.get('RateLimit-Remaining')).toBe('1');

    const response3 = await app.request('/test');
    expect(response3.headers.get('RateLimit-Remaining')).toBe('0');
  });
});
