import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { getClientIp } from '../../src/utils/get-client-ip';

describe('getClientIp', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  it('should extract IP from x-forwarded-for header', async () => {
    app.get('/test', (c) => {
      c.set('trustProxy', true);
      const ip = getClientIp(c);
      return c.json({ ip });
    });

    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '203.0.113.1, 192.168.1.1' },
    });
    const body = await res.json();

    expect(body.ip).toBe('203.0.113.1');
  });

  it('should extract IP from x-real-ip header', async () => {
    app.get('/test', (c) => {
      c.set('trustProxy', true);
      const ip = getClientIp(c);
      return c.json({ ip });
    });

    const res = await app.request('/test', {
      headers: { 'x-real-ip': '203.0.113.2' },
    });
    const body = await res.json();

    expect(body.ip).toBe('203.0.113.2');
  });

  it('should prefer x-forwarded-for over x-real-ip', async () => {
    app.get('/test', (c) => {
      c.set('trustProxy', true);
      const ip = getClientIp(c);
      return c.json({ ip });
    });

    const res = await app.request('/test', {
      headers: {
        'x-forwarded-for': '203.0.113.1',
        'x-real-ip': '203.0.113.2',
      },
    });
    const body = await res.json();

    expect(body.ip).toBe('203.0.113.1');
  });

  it('should return "unknown" when no headers present', async () => {
    app.get('/test', (c) => {
      const ip = getClientIp(c);
      return c.json({ ip });
    });

    const res = await app.request('/test');
    const body = await res.json();

    // In test environment without Node.js server, should return 'unknown'
    expect(body.ip).toBe('unknown');
  });

  it('should handle empty x-forwarded-for header', async () => {
    app.get('/test', (c) => {
      c.set('trustProxy', true);
      const ip = getClientIp(c);
      return c.json({ ip });
    });

    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '' },
    });
    const body = await res.json();

    expect(body.ip).toBe('unknown');
  });

  it('should trim whitespace from x-forwarded-for', async () => {
    app.get('/test', (c) => {
      c.set('trustProxy', true);
      const ip = getClientIp(c);
      return c.json({ ip });
    });

    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '  203.0.113.1  , 192.168.1.1' },
    });
    const body = await res.json();

    expect(body.ip).toBe('203.0.113.1');
  });

  it('should return unknown for whitespace-only x-real-ip', async () => {
    app.get('/test', (c) => {
      c.set('trustProxy', true);
      const ip = getClientIp(c);
      return c.json({ ip });
    });

    const res = await app.request('/test', {
      headers: { 'x-real-ip': '   ' },
    });
    const body = await res.json();

    expect(body.ip).toBe('unknown');
  });

  it('should ignore proxy headers when trustProxy is false', async () => {
    app.get('/test', (c) => {
      // trustProxy not set
      const ip = getClientIp(c);
      return c.json({ ip });
    });

    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });
    const body = await res.json();

    expect(body.ip).toBe('unknown');
  });
});
