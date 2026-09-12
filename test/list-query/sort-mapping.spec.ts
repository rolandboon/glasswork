import { describe, expect, it } from 'vitest';
import { applySortMappings, nestSort, renameSort } from '../../src/list-query/sort-mapping.js';

describe('sort-mapping', () => {
  describe('applySortMappings', () => {
    it('returns empty array when orderBy is empty', () => {
      expect(applySortMappings([], { name: 'user.name' })).toEqual([]);
    });

    it('leaves unmapped fields unchanged', () => {
      const result = applySortMappings([{ createdAt: 'desc' }], { name: 'user.name' });
      expect(result).toEqual([{ createdAt: 'desc' }]);
    });

    it('maps field to nested relational path using dot-notation string', () => {
      const result = applySortMappings([{ name: 'asc' }], { name: 'user.name' });
      expect(result).toEqual([{ user: { name: 'asc' } }]);
    });

    it('maps field to deeply nested relational path using dot-notation string', () => {
      const result = applySortMappings([{ dept: 'desc' }], { dept: 'profile.department.name' });
      expect(result).toEqual([{ profile: { department: { name: 'desc' } } }]);
    });

    it('renames a field using renameSort helper', () => {
      const result = applySortMappings([{ displayName: 'asc' }], {
        displayName: renameSort('name'),
      });
      expect(result).toEqual([{ name: 'asc' }]);
    });

    it('maps field using nestSort helper explicitly', () => {
      const result = applySortMappings([{ email: 'asc' }], {
        email: nestSort('user.email'),
      });
      expect(result).toEqual([{ user: { email: 'asc' } }]);
    });

    it('maps field using a custom mapper function', () => {
      const result = applySortMappings([{ custom: 'desc' }], {
        custom: (direction) => ({ metadata: { score: direction } }),
      });
      expect(result).toEqual([{ metadata: { score: 'desc' } }]);
    });

    it('maps multiple sort fields in order', () => {
      const result = applySortMappings([{ name: 'asc' }, { createdAt: 'desc' }, { email: 'asc' }], {
        name: 'user.name',
        email: 'user.email',
      });
      expect(result).toEqual([
        { user: { name: 'asc' } },
        { createdAt: 'desc' },
        { user: { email: 'asc' } },
      ]);
    });
  });
});
