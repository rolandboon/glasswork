import { object, optional, picklist, string } from 'valibot';
import { describe, expect, test } from 'vitest';
import { booleanFilterSchema, sortDirectionSchema } from '../../src/list-query/schema-helpers.js';
import {
  validateListParams,
  validateOrderBy,
  validateWhere,
} from '../../src/list-query/validator.js';

describe('validator', () => {
  describe('validateWhere', () => {
    test('should validate valid where clause', () => {
      const schema = object({
        name: optional(string()),
        active: optional(booleanFilterSchema()),
      });

      const where = { name: 'test', active: { equals: true } };
      const result = validateWhere(where, schema);

      expect(result).toEqual({ name: 'test', active: { equals: true } });
    });

    test('should strip unknown fields', () => {
      const schema = object({
        name: optional(string()),
      });

      const where = { name: 'test', unknown: 'value' };
      const result = validateWhere(where, schema);

      expect(result).toEqual({ name: 'test' });
    });

    test('should throw error on invalid data', () => {
      const schema = object({
        active: optional(booleanFilterSchema()),
      });

      const where = { active: 'not-a-boolean' };

      expect(() => validateWhere(where, schema)).toThrow('Invalid filter:');
    });

    test('should preserve error message from Valibot', () => {
      const schema = object({
        role: optional(picklist(['ADMIN', 'USER'])),
      });

      const where = { role: 'INVALID_ROLE' };

      try {
        validateWhere(where, schema);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Invalid filter:');
      }
    });
  });

  describe('validateOrderBy', () => {
    test('should validate valid orderBy clause', () => {
      const schema = object({
        name: optional(sortDirectionSchema()),
        createdAt: optional(sortDirectionSchema()),
      });

      const orderBy = [{ name: 'asc' }, { createdAt: 'desc' }];
      const result = validateOrderBy(orderBy, schema);

      expect(result).toEqual([{ name: 'asc' }, { createdAt: 'desc' }]);
    });

    test('should validate empty orderBy', () => {
      const schema = object({
        name: optional(sortDirectionSchema()),
      });

      const orderBy: readonly Record<string, unknown>[] = [];
      const result = validateOrderBy(orderBy, schema);

      expect(result).toEqual([]);
    });

    test('should strip unknown fields from orderBy items', () => {
      const schema = object({
        name: optional(sortDirectionSchema()),
      });

      const orderBy = [{ name: 'asc', unknown: 'value' }];
      const result = validateOrderBy(orderBy, schema);

      expect(result).toEqual([{ name: 'asc' }]);
    });

    test('should throw error on invalid orderBy data', () => {
      const schema = object({
        name: optional(sortDirectionSchema()),
      });

      const orderBy = [{ name: 'invalid' }];

      expect(() => validateOrderBy(orderBy, schema)).toThrow('Invalid sort:');
    });

    test('should preserve error message from Valibot', () => {
      const schema = object({
        name: optional(sortDirectionSchema()),
      });

      const orderBy = [{ name: 'up' }]; // Invalid direction

      try {
        validateOrderBy(orderBy, schema);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Invalid sort:');
      }
    });
  });

  describe('validateListParams', () => {
    test('should validate complete list params', () => {
      const config = {
        whereSchema: object({
          name: optional(string()),
          active: optional(booleanFilterSchema()),
        }),
        orderBySchema: object({
          name: optional(sortDirectionSchema()),
          createdAt: optional(sortDirectionSchema()),
        }),
      };

      const where = { name: 'test', active: { equals: true } };
      const orderBy = [{ name: 'asc' }, { createdAt: 'desc' }];

      const result = validateListParams(where, orderBy, 10, 20, config);

      expect(result).toEqual({
        where: { name: 'test', active: { equals: true } },
        orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
        skip: 10,
        take: 20,
      });
    });

    test('should validate with empty where and orderBy', () => {
      const config = {
        whereSchema: object({}),
        orderBySchema: object({}),
      };

      const result = validateListParams({}, [], 0, 10, config);

      expect(result).toEqual({
        where: {},
        orderBy: [],
        skip: 0,
        take: 10,
      });
    });

    test('should pass through skip and take unchanged', () => {
      const config = {
        whereSchema: object({}),
        orderBySchema: object({}),
      };

      const result = validateListParams({}, [], 50, 100, config);

      expect(result.skip).toBe(50);
      expect(result.take).toBe(100);
    });

    test('should throw on invalid where clause', () => {
      const config = {
        whereSchema: object({
          active: optional(booleanFilterSchema()),
        }),
        orderBySchema: object({}),
      };

      const where = { active: 'not-boolean' };

      expect(() => validateListParams(where, [], 0, 10, config)).toThrow('Invalid filter:');
    });

    test('should throw on invalid orderBy clause', () => {
      const config = {
        whereSchema: object({}),
        orderBySchema: object({
          name: optional(sortDirectionSchema()),
        }),
      };

      const orderBy = [{ name: 'invalid' }];

      expect(() => validateListParams({}, orderBy, 0, 10, config)).toThrow('Invalid sort:');
    });
  });
});
