import { describe, expect, test } from 'vitest';
import {
  buildOrderBy,
  buildPrismaParams,
  buildWhereClause,
} from '../../src/list-query/prisma-builder.js';
import type {
  FilterOperator,
  ParsedFilter,
  ParsedQueryParams,
  ParsedSort,
} from '../../src/list-query/types.js';

describe('prisma-builder', () => {
  describe('buildWhereClause', () => {
    test('should return empty object for no filters', () => {
      const result = buildWhereClause([]);
      expect(result).toEqual({});
    });
    test('should build equals condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '==', value: 'test' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { equals: 'test' },
      });
    });
    test('should build not equals condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '!=', value: 'test' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { not: 'test' },
      });
    });
    test('should build greater than condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['age'], operator: '>', value: '18' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        age: { gt: 18 },
      });
    });
    test('should build less than condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['age'], operator: '<', value: '100' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        age: { lt: 100 },
      });
    });
    test('should build greater than or equal condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['age'], operator: '>=', value: '18' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        age: { gte: 18 },
      });
    });
    test('should build less than or equal condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['age'], operator: '<=', value: '100' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        age: { lte: 100 },
      });
    });
    test('should build contains condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '@=', value: 'test' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { contains: 'test' },
      });
    });
    test('should build starts with condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '_=', value: 'prefix' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { startsWith: 'prefix' },
      });
    });
    test('should build ends with condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '_-=', value: 'suffix' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { endsWith: 'suffix' },
      });
    });
    test('should build not contains condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '!@=', value: 'test' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { not: { contains: 'test' } },
      });
    });
    test('should build not starts with condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '!_=', value: 'prefix' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { not: { startsWith: 'prefix' } },
      });
    });
    test('should build not ends with condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '!_-=', value: 'suffix' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { not: { endsWith: 'suffix' } },
      });
    });
    test('should build case-insensitive equals condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '==*', value: 'test' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { equals: 'test', mode: 'insensitive' },
      });
    });
    test('should build case-insensitive contains condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '@=*', value: 'test' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { contains: 'test', mode: 'insensitive' },
      });
    });
    test('should build case-insensitive starts with condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '_=*', value: 'prefix' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { startsWith: 'prefix', mode: 'insensitive' },
      });
    });
    test('should build case-insensitive ends with condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '_-=*', value: 'suffix' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { endsWith: 'suffix', mode: 'insensitive' },
      });
    });
    test('should build case-insensitive not contains condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '!@=*', value: 'test' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { not: { contains: 'test', mode: 'insensitive' } },
      });
    });
    test('should build case-insensitive not starts with condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '!_=*', value: 'prefix' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { not: { startsWith: 'prefix', mode: 'insensitive' } },
      });
    });
    test('should parse boolean true value', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['active'], operator: '==', value: 'true' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        active: { equals: true },
      });
    });

    test('should parse boolean false value', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['active'], operator: '==', value: 'false' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        active: { equals: false },
      });
    });
    test('should parse numeric values', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['age'], operator: '==', value: '42' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        age: { equals: 42 },
      });
    });
    test('should build multiple filters', () => {
      const filters: ParsedFilter[] = [
        { fieldPath: ['name'], operator: '@=', value: 'test' },
        { fieldPath: ['age'], operator: '>', value: '18' },
        { fieldPath: ['active'], operator: '==', value: 'true' },
      ];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { contains: 'test' },
        age: { gt: 18 },
        active: { equals: true },
      });
    });
    test('should build nested field filter', () => {
      const filters: ParsedFilter[] = [
        { fieldPath: ['organization', 'name'], operator: '@=', value: 'Acme' },
      ];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        organization: {
          is: { name: { contains: 'Acme' } },
        },
      });
    });
    test('should merge multiple filters on same nested field', () => {
      const filters: ParsedFilter[] = [
        { fieldPath: ['organization', 'name'], operator: '@=', value: 'Acme' },
        { fieldPath: ['organization', 'active'], operator: '==', value: 'true' },
      ];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        organization: {
          is: {
            name: { contains: 'Acme' },
            active: { equals: true },
          },
        },
      });
    });
    test('should handle deep nested fields', () => {
      const filters: ParsedFilter[] = [
        { fieldPath: ['organization', 'address', 'city'], operator: '==', value: 'Amsterdam' },
      ];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        organization: {
          is: {
            address: {
              city: { equals: 'Amsterdam' },
            },
          },
        },
      });
    });

    test('should build case-insensitive not equals condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '!=*', value: 'test' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { not: { equals: 'test', mode: 'insensitive' } },
      });
    });

    test('should build case-insensitive not ends with condition', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['name'], operator: '!_-=*', value: 'suffix' }];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        name: { not: { endsWith: 'suffix', mode: 'insensitive' } },
      });
    });

    test('should throw error for string operator with non-string value', () => {
      // The value '123' gets parsed as number, so @= operator should throw an error
      const filters: ParsedFilter[] = [{ fieldPath: ['age'], operator: '@=', value: '123' }];
      expect(() => buildWhereClause(filters)).toThrow('String operator @= requires string value');
    });

    test('should throw error for unsupported operator', () => {
      const filters: ParsedFilter[] = [
        { fieldPath: ['name'], operator: '~=' as FilterOperator, value: 'test' },
      ];
      expect(() => buildWhereClause(filters)).toThrow('Unsupported operator: ~=');
    });

    test('should throw error for empty field path in single field', () => {
      const filters: ParsedFilter[] = [{ fieldPath: [''], operator: '==', value: 'test' }];
      expect(() => buildWhereClause(filters)).toThrow('Field path cannot be empty');
    });

    test('should throw error for empty field path in nested field first segment', () => {
      const filters: ParsedFilter[] = [{ fieldPath: ['', 'name'], operator: '==', value: 'test' }];
      expect(() => buildWhereClause(filters)).toThrow('Field path cannot be empty');
    });

    test('should throw error for empty field path in nested field rest segment', () => {
      const filters: ParsedFilter[] = [
        { fieldPath: ['organization', ''], operator: '==', value: 'test' },
      ];
      expect(() => buildWhereClause(filters)).toThrow('Field path cannot be empty');
    });

    test('should handle merge with array values', () => {
      const filters: ParsedFilter[] = [
        { fieldPath: ['tags'], operator: '==', value: 'tag1' },
        { fieldPath: ['tags'], operator: '==', value: 'tag2' },
      ];
      const result = buildWhereClause(filters);
      // When merging same field with array-like values, last one wins
      expect(result).toEqual({
        tags: { equals: 'tag2' },
      });
    });

    test('should handle merge when existing value is array', () => {
      // Simulate a scenario where we're merging and one value is an array
      // This tests the line: merged[key] = value;
      const filters: ParsedFilter[] = [
        { fieldPath: ['organization', 'id'], operator: '==', value: 'org1' },
        { fieldPath: ['organization', 'name'], operator: '@=', value: 'test' },
      ];
      const result = buildWhereClause(filters);
      expect(result).toEqual({
        organization: {
          is: {
            id: { equals: 'org1' },
            name: { contains: 'test' },
          },
        },
      });
    });
  });

  describe('buildOrderBy', () => {
    test('should return empty array for no sorts', () => {
      const result = buildOrderBy([]);
      expect(result).toEqual([]);
    });
    test('should build single ascending sort', () => {
      const sorts: ParsedSort[] = [{ fieldPath: ['name'], direction: 'asc' }];
      const result = buildOrderBy(sorts);
      expect(result).toEqual([{ name: 'asc' }]);
    });
    test('should build single descending sort', () => {
      const sorts: ParsedSort[] = [{ fieldPath: ['name'], direction: 'desc' }];
      const result = buildOrderBy(sorts);
      expect(result).toEqual([{ name: 'desc' }]);
    });
    test('should build multiple sorts', () => {
      const sorts: ParsedSort[] = [
        { fieldPath: ['name'], direction: 'asc' },
        { fieldPath: ['createdAt'], direction: 'desc' },
      ];
      const result = buildOrderBy(sorts);
      expect(result).toEqual([{ name: 'asc' }, { createdAt: 'desc' }]);
    });
    test('should build nested field sort', () => {
      const sorts: ParsedSort[] = [{ fieldPath: ['organization', 'name'], direction: 'asc' }];
      const result = buildOrderBy(sorts);
      expect(result).toEqual([
        {
          organization: {
            name: 'asc',
          },
        },
      ]);
    });
    test('should build deep nested field sort', () => {
      const sorts: ParsedSort[] = [
        { fieldPath: ['organization', 'address', 'city'], direction: 'asc' },
      ];
      const result = buildOrderBy(sorts);
      expect(result).toEqual([
        {
          organization: {
            address: {
              city: 'asc',
            },
          },
        },
      ]);
    });
    test('should build mixed nested and direct sorts', () => {
      const sorts: ParsedSort[] = [
        { fieldPath: ['organization', 'name'], direction: 'asc' },
        { fieldPath: ['createdAt'], direction: 'desc' },
      ];
      const result = buildOrderBy(sorts);
      expect(result).toEqual([
        {
          organization: {
            name: 'asc',
          },
        },
        { createdAt: 'desc' },
      ]);
    });

    test('should throw error for empty field path in single field sort', () => {
      const sorts: ParsedSort[] = [{ fieldPath: [''], direction: 'asc' }];
      expect(() => buildOrderBy(sorts)).toThrow('Field path cannot be empty');
    });

    test('should throw error for empty field path in nested sort', () => {
      const sorts: ParsedSort[] = [{ fieldPath: ['organization', ''], direction: 'asc' }];
      expect(() => buildOrderBy(sorts)).toThrow('Field path cannot be empty');
    });

    test('should throw error for empty last field in nested sort', () => {
      const sorts: ParsedSort[] = [
        { fieldPath: ['organization', 'address', ''], direction: 'asc' },
      ];
      expect(() => buildOrderBy(sorts)).toThrow('Field path cannot be empty');
    });

    test('should throw error for empty middle field in deeply nested sort', () => {
      const sorts: ParsedSort[] = [{ fieldPath: ['organization', '', 'city'], direction: 'asc' }];
      expect(() => buildOrderBy(sorts)).toThrow('Field path cannot be empty');
    });
  });

  describe('buildPrismaParams', () => {
    test('should build complete params', () => {
      const params: ParsedQueryParams = {
        sorts: [
          { fieldPath: ['name'], direction: 'asc' },
          { fieldPath: ['createdAt'], direction: 'desc' },
        ],
        filters: [{ fieldPath: ['active'], operator: '==', value: 'true' }],
        page: 2,
        pageSize: 20,
        search: undefined,
      };
      const result = buildPrismaParams(params);
      expect(result).toEqual({
        where: {
          active: { equals: true },
        },
        orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
        skip: 20,
        take: 20,
      });
    });
    test('should calculate skip correctly', () => {
      const params: ParsedQueryParams = {
        sorts: [],
        filters: [],
        page: 1,
        pageSize: 10,
      };
      const result = buildPrismaParams(params);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(10);
    });
    test('should calculate skip for page 3', () => {
      const params: ParsedQueryParams = {
        sorts: [],
        filters: [],
        page: 3,
        pageSize: 10,
      };
      const result = buildPrismaParams(params);
      expect(result.skip).toBe(20);
      expect(result.take).toBe(10);
    });
  });
});
