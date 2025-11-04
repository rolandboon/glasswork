import { describe, expect, test } from 'vitest';
import { parseFilters, parseQueryParams, parseSorts } from '../../src/list-query/parser.js';

describe('list-query parser', () => {
  describe('parseSorts', () => {
    test('should parse empty string', () => {
      const result = parseSorts('');
      expect(result).toEqual([]);
    });
    test('should parse undefined', () => {
      const result = parseSorts(undefined);
      expect(result).toEqual([]);
    });
    test('should parse single ascending sort', () => {
      const result = parseSorts('name');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          direction: 'asc',
        },
      ]);
    });
    test('should parse single descending sort', () => {
      const result = parseSorts('-name');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          direction: 'desc',
        },
      ]);
    });
    test('should parse multiple sorts', () => {
      const result = parseSorts('name,-createdAt,email');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          direction: 'asc',
        },
        {
          fieldPath: ['createdAt'],
          direction: 'desc',
        },
        {
          fieldPath: ['email'],
          direction: 'asc',
        },
      ]);
    });
    test('should parse nested field sort', () => {
      const result = parseSorts('organization.name');
      expect(result).toEqual([
        {
          fieldPath: ['organization', 'name'],
          direction: 'asc',
        },
      ]);
    });
    test('should parse nested field descending sort', () => {
      const result = parseSorts('-organization.name');
      expect(result).toEqual([
        {
          fieldPath: ['organization', 'name'],
          direction: 'desc',
        },
      ]);
    });
    test('should handle whitespace', () => {
      const result = parseSorts(' name , -createdAt ');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          direction: 'asc',
        },
        {
          fieldPath: ['createdAt'],
          direction: 'desc',
        },
      ]);
    });
  });

  describe('parseFilters', () => {
    test('should parse empty string', () => {
      const result = parseFilters('');
      expect(result).toEqual([]);
    });
    test('should parse undefined', () => {
      const result = parseFilters(undefined);
      expect(result).toEqual([]);
    });
    test('should parse equals operator', () => {
      const result = parseFilters('name==value');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '==',
          value: 'value',
        },
      ]);
    });
    test('should parse not equals operator', () => {
      const result = parseFilters('name!=value');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '!=',
          value: 'value',
        },
      ]);
    });
    test('should parse greater than operator', () => {
      const result = parseFilters('age>18');
      expect(result).toEqual([
        {
          fieldPath: ['age'],
          operator: '>',
          value: '18',
        },
      ]);
    });
    test('should parse less than operator', () => {
      const result = parseFilters('age<100');
      expect(result).toEqual([
        {
          fieldPath: ['age'],
          operator: '<',
          value: '100',
        },
      ]);
    });
    test('should parse greater than or equal operator', () => {
      const result = parseFilters('age>=18');
      expect(result).toEqual([
        {
          fieldPath: ['age'],
          operator: '>=',
          value: '18',
        },
      ]);
    });
    test('should parse less than or equal operator', () => {
      const result = parseFilters('age<=100');
      expect(result).toEqual([
        {
          fieldPath: ['age'],
          operator: '<=',
          value: '100',
        },
      ]);
    });
    test('should parse contains operator', () => {
      const result = parseFilters('name@=test');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '@=',
          value: 'test',
        },
      ]);
    });
    test('should parse starts with operator', () => {
      const result = parseFilters('name_=prefix');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '_=',
          value: 'prefix',
        },
      ]);
    });
    test('should parse ends with operator', () => {
      const result = parseFilters('name_-=suffix');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '_-=',
          value: 'suffix',
        },
      ]);
    });
    test('should parse not contains operator', () => {
      const result = parseFilters('name!@=test');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '!@=',
          value: 'test',
        },
      ]);
    });
    test('should parse not starts with operator', () => {
      const result = parseFilters('name!_=prefix');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '!_=',
          value: 'prefix',
        },
      ]);
    });
    test('should parse not ends with operator', () => {
      const result = parseFilters('name!_-=suffix');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '!_-=',
          value: 'suffix',
        },
      ]);
    });
    test('should parse case-insensitive equals operator', () => {
      const result = parseFilters('name==*test');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '==*',
          value: 'test',
        },
      ]);
    });
    test('should parse case-insensitive contains operator', () => {
      const result = parseFilters('name@=*test');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '@=*',
          value: 'test',
        },
      ]);
    });
    test('should parse case-insensitive starts with operator', () => {
      const result = parseFilters('name_=*test');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '_=*',
          value: 'test',
        },
      ]);
    });
    test('should parse case-insensitive ends with operator', () => {
      const result = parseFilters('name_-=*test');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '_-=*',
          value: 'test',
        },
      ]);
    });
    test('should parse case-insensitive not contains operator', () => {
      const result = parseFilters('name!@=*test');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '!@=*',
          value: 'test',
        },
      ]);
    });
    test('should parse case-insensitive not starts with operator', () => {
      const result = parseFilters('name!_=*test');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '!_=*',
          value: 'test',
        },
      ]);
    });
    test('should parse multiple filters', () => {
      const result = parseFilters('name@=test,age>18,active==true');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '@=',
          value: 'test',
        },
        {
          fieldPath: ['age'],
          operator: '>',
          value: '18',
        },
        {
          fieldPath: ['active'],
          operator: '==',
          value: 'true',
        },
      ]);
    });
    test('should parse nested field filter', () => {
      const result = parseFilters('organization.name@=Acme');
      expect(result).toEqual([
        {
          fieldPath: ['organization', 'name'],
          operator: '@=',
          value: 'Acme',
        },
      ]);
    });
    test('should handle whitespace', () => {
      const result = parseFilters(' name == value , age > 18 ');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '==',
          value: 'value',
        },
        {
          fieldPath: ['age'],
          operator: '>',
          value: '18',
        },
      ]);
    });
    test('should unescape commas in values', () => {
      const result = parseFilters('name@=test\\,value');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '@=',
          value: 'test,value',
        },
      ]);
    });
    test('should unescape pipes in values', () => {
      const result = parseFilters('name@=test\\|value');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '@=',
          value: 'test|value',
        },
      ]);
    });
    test('should unescape null literal in values', () => {
      const result = parseFilters('name@=\\null');
      expect(result).toEqual([
        {
          fieldPath: ['name'],
          operator: '@=',
          value: 'null',
        },
      ]);
    });
    test('should throw error for invalid filter format', () => {
      expect(() => parseFilters('invalidfilter')).toThrow('Invalid filter format');
    });
  });

  describe('parseQueryParams', () => {
    test('should parse minimal params with defaults', () => {
      const result = parseQueryParams({});
      expect(result).toEqual({
        sorts: [],
        filters: [],
        page: 1,
        pageSize: 10,
        search: undefined,
      });
    });
    test('should parse all params', () => {
      const result = parseQueryParams({
        sorts: 'name,-createdAt',
        filters: 'active==true',
        page: 2,
        pageSize: 20,
        search: 'test',
      });
      expect(result).toEqual({
        sorts: [
          { fieldPath: ['name'], direction: 'asc' },
          { fieldPath: ['createdAt'], direction: 'desc' },
        ],
        filters: [{ fieldPath: ['active'], operator: '==', value: 'true' }],
        page: 2,
        pageSize: 20,
        search: 'test',
      });
    });
    test('should default page to 1 when invalid', () => {
      const result = parseQueryParams({ page: 0 });
      expect(result.page).toBe(1);
    });
    test('should default pageSize to 10 when invalid', () => {
      const result = parseQueryParams({ pageSize: 0 });
      expect(result.pageSize).toBe(10);
    });
    test('should cap pageSize at 100', () => {
      const result = parseQueryParams({ pageSize: 200 });
      expect(result.pageSize).toBe(100);
    });
    test('should trim search string', () => {
      const result = parseQueryParams({ search: '  test  ' });
      expect(result.search).toBe('test');
    });
    test('should set search to undefined when empty string', () => {
      const result = parseQueryParams({ search: '   ' });
      expect(result.search).toBeUndefined();
    });
  });
});
