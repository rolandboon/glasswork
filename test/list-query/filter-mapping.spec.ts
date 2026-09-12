import { describe, expect, test } from 'vitest';
import { createListQuery } from '../../src/list-query/builder.js';
import {
  applyFilterMappings,
  composeFilterMappers,
  mapBooleanFilter,
  mapPresenceFilter,
  mapValueFilter,
  nestFilter,
  renameFilter,
} from '../../src/list-query/filter-mapping.js';
import {
  booleanFilterSchema,
  createFilterSchema,
  createSortSchema,
  sortDirectionSchema,
  stringFilterSchema,
} from '../../src/list-query/schema-helpers.js';

describe('mapPresenceFilter', () => {
  const mapper = mapPresenceFilter('archivedAt');

  test('maps equals: false to null', () => {
    expect(mapper({ equals: false })).toEqual({ archivedAt: null });
  });

  test('maps equals: true to { not: null }', () => {
    expect(mapper({ equals: true })).toEqual({ archivedAt: { not: null } });
  });

  test('maps not: true to null', () => {
    expect(mapper({ not: true })).toEqual({ archivedAt: null });
  });

  test('maps not: false to { not: null }', () => {
    expect(mapper({ not: false })).toEqual({ archivedAt: { not: null } });
  });

  test('maps boolean literals directly', () => {
    expect(mapper(false)).toEqual({ archivedAt: null });
    expect(mapper(true)).toEqual({ archivedAt: { not: null } });
  });

  test('returns undefined for empty/unrecognized filter', () => {
    expect(mapper({})).toBeUndefined();
    expect(mapper(null)).toBeUndefined();
    expect(mapper(undefined)).toBeUndefined();
  });

  test('supports inverted polarity via presentWhen: false', () => {
    const activeMapper = mapPresenceFilter('archivedAt', { presentWhen: false });
    expect(activeMapper({ equals: true })).toEqual({ archivedAt: null });
    expect(activeMapper({ equals: false })).toEqual({ archivedAt: { not: null } });
    expect(activeMapper(true)).toEqual({ archivedAt: null });
    expect(activeMapper(false)).toEqual({ archivedAt: { not: null } });
  });
});

describe('mapBooleanFilter', () => {
  const mapper = mapBooleanFilter('status', {
    whenTrue: 'ACTIVE',
    whenFalse: 'INACTIVE',
  });

  test('maps true literal to whenTrue', () => {
    expect(mapper(true)).toEqual({ status: 'ACTIVE' });
  });

  test('maps false literal to whenFalse', () => {
    expect(mapper(false)).toEqual({ status: 'INACTIVE' });
  });

  test('maps { equals: true } and { equals: false }', () => {
    expect(mapper({ equals: true })).toEqual({ status: 'ACTIVE' });
    expect(mapper({ equals: false })).toEqual({ status: 'INACTIVE' });
  });

  test('maps { not: true } and { not: false }', () => {
    expect(mapper({ not: true })).toEqual({ status: 'INACTIVE' });
    expect(mapper({ not: false })).toEqual({ status: 'ACTIVE' });
  });

  test('supports object condition mappings', () => {
    const roleMapper = mapBooleanFilter('role', {
      whenTrue: { in: ['ADMIN', 'MANAGER'] },
      whenFalse: { notIn: ['ADMIN', 'MANAGER'] },
    });
    expect(roleMapper(true)).toEqual({ role: { in: ['ADMIN', 'MANAGER'] } });
    expect(roleMapper(false)).toEqual({ role: { notIn: ['ADMIN', 'MANAGER'] } });
  });

  test('returns undefined for non-boolean or empty input', () => {
    expect(mapper({})).toBeUndefined();
    expect(mapper('true')).toBeUndefined();
    expect(mapper(null)).toBeUndefined();
    expect(mapper(undefined)).toBeUndefined();
  });
});

describe('mapValueFilter', () => {
  const mapper = mapValueFilter('status', {
    draft: 'DRAFT',
    published: 'PUBLISHED',
    archived: 'ARCHIVED',
  });

  test('maps primitive literal values', () => {
    expect(mapper('draft')).toEqual({ status: 'DRAFT' });
    expect(mapper('published')).toEqual({ status: 'PUBLISHED' });
  });

  test('maps equals and not operators', () => {
    expect(mapper({ equals: 'draft' })).toEqual({ status: { equals: 'DRAFT' } });
    expect(mapper({ not: 'archived' })).toEqual({ status: { not: 'ARCHIVED' } });
  });

  test('maps in and notIn array operators', () => {
    expect(mapper({ in: ['draft', 'published'] })).toEqual({
      status: { in: ['DRAFT', 'PUBLISHED'] },
    });
    expect(mapper({ notIn: ['archived'] })).toEqual({
      status: { notIn: ['ARCHIVED'] },
    });
  });

  test('passes through unmapped values and other operators unchanged', () => {
    expect(mapper('unknown')).toEqual({ status: 'unknown' });
    expect(mapper({ contains: 'pub' })).toEqual({ status: { contains: 'pub' } });
  });

  test('returns undefined for empty object or nullish input', () => {
    expect(mapper({})).toBeUndefined();
    expect(mapper(null)).toBeUndefined();
    expect(mapper(undefined)).toBeUndefined();
  });
});

describe('renameFilter', () => {
  const mapper = renameFilter('email');

  test('renames filter key', () => {
    expect(mapper({ contains: 'example.com' })).toEqual({
      email: { contains: 'example.com' },
    });
    expect(mapper('admin@cwz.nl')).toEqual({ email: 'admin@cwz.nl' });
  });

  test('returns undefined when input is undefined', () => {
    expect(mapper(undefined)).toBeUndefined();
  });
});

describe('nestFilter', () => {
  test('nests filter under dot-separated path', () => {
    const mapper = nestFilter('author.email');
    expect(mapper({ contains: 'alice' })).toEqual({
      author: { email: { contains: 'alice' } },
    });
  });

  test('nests filter under array path segments', () => {
    const mapper = nestFilter(['department', 'manager', 'id']);
    expect(mapper({ equals: 'dept-1' })).toEqual({
      department: { manager: { id: { equals: 'dept-1' } } },
    });
  });

  test('applies inner mapper before nesting', () => {
    const mapper = nestFilter('author', mapPresenceFilter('archivedAt'));
    expect(mapper({ equals: false })).toEqual({
      author: { archivedAt: null },
    });
    expect(mapper({ equals: true })).toEqual({
      author: { archivedAt: { not: null } },
    });
  });

  test('returns undefined if inner mapper returns undefined', () => {
    const mapper = nestFilter('author', mapPresenceFilter('archivedAt'));
    expect(mapper({})).toBeUndefined();
    expect(mapper(undefined)).toBeUndefined();
  });

  test('throws if path is empty', () => {
    expect(() => nestFilter('')).toThrow('nestFilter requires at least one path segment');
    expect(() => nestFilter([])).toThrow('nestFilter requires at least one path segment');
  });
});

describe('composeFilterMappers', () => {
  const composite = composeFilterMappers(
    mapBooleanFilter('isBlocked', { whenTrue: false, whenFalse: true }),
    mapBooleanFilter('isVerified', { whenTrue: true, whenFalse: false })
  );

  test('combines mapped outputs from all mappers', () => {
    expect(composite(true)).toEqual({
      isBlocked: false,
      isVerified: true,
    });
    expect(composite(false)).toEqual({
      isBlocked: true,
      isVerified: false,
    });
  });

  test('returns undefined if all mappers return undefined', () => {
    expect(composite({})).toBeUndefined();
  });
});

describe('applyFilterMappings', () => {
  test('maps root level filters', () => {
    const result = applyFilterMappings(
      { archived: { equals: false }, name: { contains: 'test' } },
      { archived: mapPresenceFilter('archivedAt') }
    );
    expect(result).toEqual({
      archivedAt: null,
      name: { contains: 'test' },
    });
  });

  test('maps recursively within AND/OR/NOT arrays', () => {
    const result = applyFilterMappings(
      {
        AND: [
          { archived: { equals: false } },
          { OR: [{ archived: { equals: true } }, { name: 'admin' }] },
        ],
      },
      { archived: mapPresenceFilter('archivedAt') }
    );
    expect(result).toEqual({
      AND: [{ archivedAt: null }, { OR: [{ archivedAt: { not: null } }, { name: 'admin' }] }],
    });
  });

  test('preserves Date instances without converting to empty object', () => {
    const testDate = new Date('2026-09-12T12:00:00.000Z');
    const result = applyFilterMappings(
      { deadline: { gt: testDate }, archived: { equals: false } },
      { archived: mapPresenceFilter('archivedAt') }
    );
    expect(result.deadline).toEqual({ gt: testDate });
    expect((result.deadline as { gt: Date }).gt).toBeInstanceOf(Date);
    expect(result.archivedAt).toBeNull();
  });

  test('supports composite mappers returning multiple keys or OR', () => {
    const lifecycleMapper = (filter: unknown) => {
      const { equals } = (filter ?? {}) as { equals?: string };
      if (equals === 'CLOSED') {
        return {
          OR: [{ status: 'CLOSED' }, { status: 'OPEN', deadline: { lte: new Date('2026-01-01') } }],
        };
      }
      return undefined;
    };

    const result = applyFilterMappings(
      { lifecycle: { equals: 'CLOSED' } },
      { lifecycle: lifecycleMapper }
    );
    expect(result).toEqual({
      OR: [{ status: 'CLOSED' }, { status: 'OPEN', deadline: { lte: new Date('2026-01-01') } }],
    });
  });
});

describe('createListQuery with mapFilters', () => {
  const FilterSchema = createFilterSchema({
    archived: booleanFilterSchema(),
    name: stringFilterSchema(),
  });
  const SortSchema = createSortSchema({
    name: sortDirectionSchema(),
  });

  test('transforms virtual filter in build()', () => {
    const query = createListQuery({
      filter: FilterSchema,
      sort: SortSchema,
      mapFilters: {
        archived: mapPresenceFilter('archivedAt'),
      },
    });

    const params = query.parse({ filters: 'archived==false' }).build();
    expect(params.where).toEqual({ archivedAt: null });
  });

  test('combines mapped virtual filter with global search in AND clause', () => {
    const query = createListQuery({
      filter: FilterSchema,
      sort: SortSchema,
      search: ['name', 'description'],
      mapFilters: {
        archived: mapPresenceFilter('archivedAt'),
      },
    });

    const params = query.parse({ filters: 'archived==false', search: 'hospital' }).build();

    expect(params.where).toEqual({
      AND: [
        { archivedAt: null },
        {
          OR: [
            { name: { contains: 'hospital', mode: 'insensitive' } },
            { description: { contains: 'hospital', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });
});
