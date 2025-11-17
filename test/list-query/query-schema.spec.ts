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

    it('should floor decimal page numbers', () => {
      const result = safeParse(ListQuerySchema, { page: '5.7' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.page).toBe(5);
      }
    });

    it('should enforce minimum page of 1', () => {
      const result = safeParse(ListQuerySchema, { page: '0' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.page).toBe(1);
      }
    });

    it('should enforce minimum page of 1 for negative numbers', () => {
      const result = safeParse(ListQuerySchema, { page: '-5' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.page).toBe(1);
      }
    });

    it('should handle invalid page strings', () => {
      const result = safeParse(ListQuerySchema, { page: 'invalid' });
      expect(result.success).toBe(true);
      if (result.success) {
        // Invalid strings result in NaN which valibot may convert to null
        // Accept either null or NaN as valid behavior
        expect(
          result.output.page === null || Number.isNaN(result.output.page)
        ).toBe(true);
      }
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

    it('should floor decimal pageSize numbers', () => {
      const result = safeParse(ListQuerySchema, { pageSize: '20.7' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.pageSize).toBe(20);
      }
    });

    it('should enforce minimum pageSize of 1', () => {
      const result = safeParse(ListQuerySchema, { pageSize: '0' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.pageSize).toBe(1);
      }
    });

    it('should enforce maximum pageSize of 100', () => {
      const result = safeParse(ListQuerySchema, { pageSize: '200' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.pageSize).toBe(100);
      }
    });

    it('should enforce minimum pageSize of 1 for negative numbers', () => {
      const result = safeParse(ListQuerySchema, { pageSize: '-5' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.pageSize).toBe(1);
      }
    });

    it('should handle invalid pageSize strings', () => {
      const result = safeParse(ListQuerySchema, { pageSize: 'invalid' });
      expect(result.success).toBe(true);
      if (result.success) {
        // Invalid strings result in NaN which valibot may convert to null
        // Accept either null or NaN as valid behavior
        expect(
          result.output.pageSize === null || Number.isNaN(result.output.pageSize)
        ).toBe(true);
      }
    });

    it('should cap large pageSize at 100', () => {
      const result = safeParse(ListQuerySchema, { pageSize: '999' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.pageSize).toBe(100);
      }
    });
  });

  describe('optional fields', () => {
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
  });
});

