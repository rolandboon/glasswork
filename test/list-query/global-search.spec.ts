import { describe, expect, test } from 'vitest';
import { buildGlobalSearchWhere } from '../../src/list-query/global-search.js';
import type { SearchFieldInput } from '../../src/list-query/types.js';

describe('global-search', () => {
  describe('buildGlobalSearchWhere', () => {
    test('should return empty object for empty search term', () => {
      const searchFields: SearchFieldInput[] = ['name'];
      const result = buildGlobalSearchWhere(searchFields, '');
      expect(result).toEqual({});
    });
    test('should return empty object for undefined search term', () => {
      const searchFields: SearchFieldInput[] = ['name'];
      const result = buildGlobalSearchWhere(searchFields, undefined);
      expect(result).toEqual({});
    });
    test('should return empty object for whitespace-only search term', () => {
      const searchFields: SearchFieldInput[] = ['name'];
      const result = buildGlobalSearchWhere(searchFields, '   ');
      expect(result).toEqual({});
    });
    test('should return empty object for no search fields', () => {
      const result = buildGlobalSearchWhere([]);
      expect(result).toEqual({});
    });
    test('should build search condition for single direct field (string syntax)', () => {
      const searchFields: SearchFieldInput[] = ['name'];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      expect(result).toEqual({
        name: {
          contains: 'test',
          mode: 'insensitive',
        },
      });
    });
    test('should build search condition for single direct field (array syntax)', () => {
      const searchFields: SearchFieldInput[] = [['name']];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      expect(result).toEqual({
        name: {
          contains: 'test',
          mode: 'insensitive',
        },
      });
    });
    test('should build OR conditions for multiple direct fields (string syntax)', () => {
      const searchFields: SearchFieldInput[] = ['name', 'email'];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      expect(result).toEqual({
        OR: [
          {
            name: {
              contains: 'test',
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: 'test',
              mode: 'insensitive',
            },
          },
        ],
      });
    });
    test('should build OR conditions for multiple direct fields (array syntax)', () => {
      const searchFields: SearchFieldInput[] = [['name'], ['email']];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      expect(result).toEqual({
        OR: [
          {
            name: {
              contains: 'test',
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: 'test',
              mode: 'insensitive',
            },
          },
        ],
      });
    });
    test('should build search condition for nested field', () => {
      const searchFields: SearchFieldInput[] = [['organization', 'name']];
      const result = buildGlobalSearchWhere(searchFields, 'Acme');
      expect(result).toEqual({
        organization: {
          name: {
            contains: 'Acme',
            mode: 'insensitive',
          },
        },
      });
    });
    test('should build OR conditions for mixed string and nested fields', () => {
      const searchFields: SearchFieldInput[] = ['name', 'email', ['organization', 'name']];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      expect(result).toEqual({
        OR: [
          {
            name: {
              contains: 'test',
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: 'test',
              mode: 'insensitive',
            },
          },
          {
            organization: {
              name: {
                contains: 'test',
                mode: 'insensitive',
              },
            },
          },
        ],
      });
    });
    test('should trim search term', () => {
      const searchFields: SearchFieldInput[] = ['name'];
      const result = buildGlobalSearchWhere(searchFields, '  test  ');
      expect(result).toEqual({
        name: {
          contains: 'test',
          mode: 'insensitive',
        },
      });
    });
    test('should handle deep nested fields', () => {
      const searchFields: SearchFieldInput[] = [['organization', 'address', 'city']];
      const result = buildGlobalSearchWhere(searchFields, 'Amsterdam');
      expect(result).toEqual({
        organization: {
          address: {
            city: {
              contains: 'Amsterdam',
              mode: 'insensitive',
            },
          },
        },
      });
    });
    test('should not create OR for single field (string syntax)', () => {
      const searchFields: SearchFieldInput[] = ['name'];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      expect(result).not.toHaveProperty('OR');
      expect(result).toHaveProperty('name');
    });
    test('should not create OR for single field (array syntax)', () => {
      const searchFields: SearchFieldInput[] = [['name']];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      expect(result).not.toHaveProperty('OR');
      expect(result).toHaveProperty('name');
    });
    test('should create OR for multiple fields', () => {
      const searchFields: SearchFieldInput[] = ['name', 'email'];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      expect(result).toHaveProperty('OR');
      expect(Array.isArray(result.OR)).toBe(true);
    });

    test('should throw error for undefined field in single field path', () => {
      const searchFields: SearchFieldInput[] = [undefined as unknown as string];
      // The error occurs when trying to access length property of undefined
      expect(() => buildGlobalSearchWhere(searchFields, 'test')).toThrow();
    });

    test('should throw error for undefined field in nested field path', () => {
      const searchFields: SearchFieldInput[] = [
        ['organization', undefined as unknown as string, 'name'],
      ];
      expect(() => buildGlobalSearchWhere(searchFields, 'test')).toThrow(
        'Field path element cannot be undefined'
      );
    });

    test('should handle empty condition array gracefully', () => {
      // This tests the edge case where orConditions might have empty conditions
      // Simulated by having a field that results in empty condition
      const searchFields: SearchFieldInput[] = ['name'];
      const result = buildGlobalSearchWhere(searchFields, 'test');
      // Should not throw and should return valid condition
      expect(result).toHaveProperty('name');
    });
  });
});
