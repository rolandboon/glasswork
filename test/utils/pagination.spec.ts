import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { paginate, paginationInput } from '../../src/utils/pagination';

describe('pagination', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  describe('paginationInput', () => {
    it('should extract pagination from query params', async () => {
      app.get('/test', (c) => {
        const pagination = paginationInput(c);
        return c.json(pagination);
      });

      const res = await app.request('/test?page=2&limit=50');
      const body = await res.json();

      expect(body).toEqual({ page: 2, limit: 50 });
    });

    it('should use defaults when params not provided', async () => {
      app.get('/test', (c) => {
        const pagination = paginationInput(c);
        return c.json(pagination);
      });

      const res = await app.request('/test');
      const body = await res.json();

      expect(body).toEqual({ page: 1, limit: 100 });
    });

    it('should use custom default limit', async () => {
      app.get('/test', (c) => {
        const pagination = paginationInput(c, 25);
        return c.json(pagination);
      });

      const res = await app.request('/test');
      const body = await res.json();

      expect(body).toEqual({ page: 1, limit: 25 });
    });
  });

  describe('paginate', () => {
    it('should execute function and set headers', async () => {
      app.get('/test', async (c) => {
        const items = await paginate(c, async (p) => ({
          data: ['item1', 'item2'],
          total: 10,
          page: p.page,
          limit: p.limit,
        }));
        return c.json(items);
      });

      const res = await app.request('/test?page=2&limit=50');
      const body = await res.json();

      expect(body).toEqual(['item1', 'item2']);
      expect(res.headers.get('X-Total-Count')).toBe('10');
      expect(res.headers.get('X-Page')).toBe('2');
      expect(res.headers.get('X-Limit')).toBe('50');
    });

    it('should work with default pagination', async () => {
      app.get('/test', async (c) => {
        const items = await paginate(c, async (p) => ({
          data: ['a', 'b', 'c'],
          total: 100,
          page: p.page,
          limit: p.limit,
        }));
        return c.json(items);
      });

      const res = await app.request('/test');
      const body = await res.json();

      expect(body).toEqual(['a', 'b', 'c']);
      expect(res.headers.get('X-Total-Count')).toBe('100');
      expect(res.headers.get('X-Page')).toBe('1');
      expect(res.headers.get('X-Limit')).toBe('100');
    });
  });
});
