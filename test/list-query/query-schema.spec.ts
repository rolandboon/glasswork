import { safeParse } from 'valibot';
import { describe, expect, it } from 'vitest';
import { ListQuerySchema } from '../../src/list-query/query-schema.js';

describe('ListQuerySchema', () => {
  describe('page transformation', () => {
    it('should transform valid page string to number', () => {
      const result = safeParse(ListQuerySchema, { page: '5' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.page).toBe(5);
      }
    });

    it.each(['0', '-5', '5.7', 'invalid', '1000001'])(
      'should reject invalid page value %s',
      (page) => {
        expect(safeParse(ListQuerySchema, { page }).success).toBe(false);
      }
    );

    it('should accept the maximum page', () => {
      const result = safeParse(ListQuerySchema, { page: '1000000' });
      expect(result.success).toBe(true);
    });
  });

  describe('pageSize transformation', () => {
    it('should transform valid pageSize string to number', () => {
      const result = safeParse(ListQuerySchema, { pageSize: '20' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.pageSize).toBe(20);
      }
    });

    it.each(['0', '-5', '20.7', 'invalid', '101', '999'])(
      'should reject invalid pageSize value %s',
      (pageSize) => {
        expect(safeParse(ListQuerySchema, { pageSize }).success).toBe(false);
      }
    );
  });

  describe('bounded optional fields', () => {
    it('should allow all fields to be optional', () => {
      const result = safeParse(ListQuerySchema, {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toEqual({});
      }
    });

    it('should parse sorts as string when provided', () => {
      const result = safeParse(ListQuerySchema, { sorts: 'name:asc' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.sorts).toBe('name:asc');
      }
    });

    it('should parse filters as string when provided', () => {
      const result = safeParse(ListQuerySchema, { filters: 'status:active' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.filters).toBe('status:active');
      }
    });

    it('should parse search as string when provided', () => {
      const result = safeParse(ListQuerySchema, { search: 'test query' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.search).toBe('test query');
      }
    });

    it('should handle all fields together', () => {
      const result = safeParse(ListQuerySchema, {
        sorts: 'name:asc',
        filters: 'status:active',
        page: '2',
        pageSize: '25',
        search: 'test',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toEqual({
          sorts: 'name:asc',
          filters: 'status:active',
          page: 2,
          pageSize: 25,
          search: 'test',
        });
      }
    });

    it('should reject unknown parameters', () => {
      expect(safeParse(ListQuerySchema, { unknown: 'value' }).success).toBe(false);
    });

    it.each([
      { sorts: 'a'.repeat(101) },
      { filters: 'a'.repeat(1_001) },
      { search: 'a'.repeat(256) },
    ])('should reject oversized strings', (query) => {
      expect(safeParse(ListQuerySchema, query).success).toBe(false);
    });
  });
});
