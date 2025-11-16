import type { Context } from 'hono';
import { object, optional } from 'valibot';
import { describe, expect, test, vi } from 'vitest';
import { createListQuery } from '../../src/list-query/builder.js';
import {
  booleanFilterSchema,
  dateFilterSchema,
  sortDirectionSchema,
  stringFilterSchema,
} from '../../src/list-query/schema-helpers.js';

const EmptyFilterSchema = object({});
const EmptySortSchema = object({});

const BasicFilterSchema = object({
  active: optional(booleanFilterSchema()),
  name: optional(stringFilterSchema()),
  email: optional(stringFilterSchema()),
  createdAt: optional(dateFilterSchema()),
});

const BasicSortSchema = object({
  name: optional(sortDirectionSchema()),
  createdAt: optional(sortDirectionSchema()),
});

describe('ListQueryBuilder', () => {
  test('should pass correct params to execute callback', async () => {
    const mockContext = {
      header: vi.fn(),
    } as unknown as Context;

    const callbackSpy = vi.fn().mockResolvedValue({
      data: [{ id: '1' }],
      total: 1,
    });

    await createListQuery({
      filter: BasicFilterSchema,
      sort: BasicSortSchema,
    })
      .parse(
        {
          filters: 'active==true,name@=test',
          sorts: 'name,-createdAt',
          page: 2,
          pageSize: 20,
        },
        mockContext
      )
      .paginate()
      .execute(callbackSpy);

    expect(callbackSpy).toHaveBeenCalledWith({
      where: {
        active: { equals: true },
        name: { contains: 'test' },
      },
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
      skip: 20,
      take: 20,
    });
  });

  test('should merge global search with user filters', async () => {
    const mockContext = {
      header: vi.fn(),
    } as unknown as Context;

    const callbackSpy = vi.fn().mockResolvedValue({
      data: [],
      total: 0,
    });

    await createListQuery({
      filter: BasicFilterSchema,
      sort: BasicSortSchema,
      search: ['name', 'email'],
    })
      .parse(
        {
          filters: 'active==true',
          search: 'john',
        },
        mockContext
      )
      .paginate()
      .execute(callbackSpy);

    expect(callbackSpy).toHaveBeenCalledWith({
      where: {
        AND: [
          { active: { equals: true } },
          {
            OR: [
              { name: { contains: 'john', mode: 'insensitive' } },
              { email: { contains: 'john', mode: 'insensitive' } },
            ],
          },
        ],
      },
      orderBy: [],
      skip: 0,
      take: 10,
    });
  });

  test('should merge scope conditions with user filters', async () => {
    const mockContext = {
      header: vi.fn(),
    } as unknown as Context;

    const callbackSpy = vi.fn().mockResolvedValue({
      data: [],
      total: 0,
    });

    await createListQuery({
      filter: BasicFilterSchema,
      sort: BasicSortSchema,
    })
      .parse(
        {
          filters: 'active==true',
        },
        mockContext
      )
      .scope({ organizationId: 'org123' })
      .paginate()
      .execute(callbackSpy);

    expect(callbackSpy).toHaveBeenCalledWith({
      where: {
        AND: [{ active: { equals: true } }, { organizationId: 'org123' }],
      },
      orderBy: [],
      skip: 0,
      take: 10,
    });
  });

  test('should handle empty filters with global search', async () => {
    const mockContext = {
      header: vi.fn(),
    } as unknown as Context;

    const callbackSpy = vi.fn().mockResolvedValue({
      data: [],
      total: 0,
    });

    await createListQuery({
      filter: EmptyFilterSchema,
      sort: EmptySortSchema,
      search: ['name'],
    })
      .parse({ search: 'test' }, mockContext)
      .paginate()
      .execute(callbackSpy);

    expect(callbackSpy).toHaveBeenCalledWith({
      where: {
        name: { contains: 'test', mode: 'insensitive' },
      },
      orderBy: [],
      skip: 0,
      take: 10,
    });
  });

  test('should apply transform to params', async () => {
    const mockContext = {
      header: vi.fn(),
    } as unknown as Context;

    const callbackSpy = vi.fn().mockResolvedValue({
      data: [],
      total: 0,
    });

    await createListQuery({
      filter: BasicFilterSchema,
      sort: BasicSortSchema,
    })
      .parse({ filters: 'active==true' }, mockContext)
      .transform((params) => ({
        ...params,
        where: { ...params.where, archived: false },
      }))
      .paginate()
      .execute(callbackSpy);

    expect(callbackSpy).toHaveBeenCalledWith({
      where: {
        active: { equals: true },
        archived: false,
      },
      orderBy: [],
      skip: 0,
      take: 10,
    });
  });

  test('should throw error when build() called before parse()', () => {
    const builder = createListQuery({
      filter: EmptyFilterSchema,
      sort: EmptySortSchema,
    });

    expect(() => builder.build()).toThrow('Must call .parse() before .build()');
  });

  test('should work without validation config', () => {
    const builder = createListQuery({})
      .parse({ filters: 'name@=test' })
      .scope({ organizationId: 'org123' });

    const params = builder.build();

    expect(params).toEqual({
      where: {
        AND: [{ name: { contains: 'test' } }, { organizationId: 'org123' }],
      },
      orderBy: [],
      skip: 0,
      take: 999999, // Default for non-paginated
    });
  });

  test('should handle non-paginated queries', async () => {
    const mockContext = {
      header: vi.fn(),
    } as unknown as Context;

    const callbackSpy = vi.fn().mockResolvedValue({
      data: [{ id: '1' }, { id: '2' }],
      total: 2,
    });

    await createListQuery({
      filter: BasicFilterSchema,
      sort: BasicSortSchema,
    })
      .parse({ filters: 'active==true' }, mockContext)
      .execute(callbackSpy); // No .paginate() call

    expect(callbackSpy).toHaveBeenCalledWith({
      where: { active: { equals: true } },
      orderBy: [],
      skip: 0,
      take: 999999,
    });

    // Headers should not be set for non-paginated queries
    expect(mockContext.header).not.toHaveBeenCalled();
  });

  test('should handle multiple scope conditions', () => {
    const builder = createListQuery({
      filter: BasicFilterSchema,
      sort: BasicSortSchema,
    })
      .parse({ filters: 'active==true' })
      .scope({ organizationId: 'org123' })
      .scope({ userId: 'user456' });

    const params = builder.build();

    expect(params.where).toEqual({
      AND: [{ active: { equals: true } }, { organizationId: 'org123' }, { userId: 'user456' }],
    });
  });

  test('should skip empty scope conditions', () => {
    const builder = createListQuery({
      filter: BasicFilterSchema,
      sort: BasicSortSchema,
    })
      .parse({ filters: 'active==true' })
      .scope({});

    const params = builder.build();

    expect(params.where).toEqual({ active: { equals: true } });
  });

  test('should handle builder without schemas (empty config)', () => {
    const builder = createListQuery({}).parse({});

    const params = builder.build();

    expect(params).toEqual({
      where: {},
      orderBy: [],
      skip: 0,
      take: 999999,
    });
  });

  test('should not set pagination headers when context not provided', async () => {
    const callbackSpy = vi.fn().mockResolvedValue({
      data: [{ id: '1' }],
      total: 1,
    });

    // Parse without context
    await createListQuery({
      filter: BasicFilterSchema,
    })
      .parse({ filters: 'active==true' })
      .paginate()
      .execute(callbackSpy);

    // Should work fine, just no headers set
    expect(callbackSpy).toHaveBeenCalled();
  });
});
