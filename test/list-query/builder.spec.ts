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

const FilterSchemaWithStatus = object({
  active: optional(booleanFilterSchema()),
  name: optional(stringFilterSchema()),
  email: optional(stringFilterSchema()),
  status: optional(stringFilterSchema()),
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
      take: 10,
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
      .disablePagination()
      .execute(callbackSpy); // No .paginate() call

    expect(callbackSpy).toHaveBeenCalledWith({
      where: { active: { equals: true } },
      orderBy: [],
      skip: 0,
      take: undefined,
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
      take: 10,
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

  describe('aggregations', () => {
    test('should include aggregation params when configured', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      }).parse({});

      const params = builder.build();

      expect(params.aggregations).toBeDefined();
      expect(params.aggregations?.byStatus).toEqual({
        by: ['status'],
        _count: { status: true },
        where: {},
      });
    });

    test('should exclude aggregation field from where clause', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      }).parse({
        filters: 'status==CONFIRMED,name@=test',
      });

      const params = builder.build();

      // Main where should include both filters (merged directly, not wrapped in AND)
      // Note: Filters are merged at root level when there are no scope conditions
      expect(params.where).toEqual({
        status: { equals: 'CONFIRMED' },
        name: { contains: 'test' },
      });

      // Aggregation where should exclude status filter but keep other filters
      expect(params.aggregations?.byStatus.where).toEqual({
        name: { contains: 'test' },
      });
    });

    test('should preserve other filters in aggregation where clause', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      })
        .parse({
          filters: 'status==CONFIRMED,active==true,name@=test',
        })
        .scope({ organizationId: 'org123' });

      const params = builder.build();

      // Aggregation where should exclude status but keep active, name, and scope
      // When merging with scope, AND wrapping is used
      // Filters are merged into a single object, so active and name are together
      expect(params.aggregations?.byStatus.where).toEqual({
        AND: [
          { active: { equals: true }, name: { contains: 'test' } },
          { organizationId: 'org123' },
        ],
      });
    });

    test('should handle nested field aggregations', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byOrganizationName: {
            field: ['organization', 'name'],
            type: 'groupBy',
          },
        },
      }).parse({
        filters: 'organization.name@=acme,active==true',
      });

      const params = builder.build();

      expect(params.aggregations?.byOrganizationName).toEqual({
        by: ['organization', 'name'],
        _count: { name: true },
        where: {
          active: { equals: true },
        },
      });
    });

    test('should handle multiple aggregations', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
          byActive: {
            field: 'active',
            type: 'groupBy',
          },
        },
      }).parse({
        filters: 'status==CONFIRMED,active==true',
      });

      const params = builder.build();

      // byStatus aggregation should exclude status filter, keeping active
      expect(params.aggregations?.byStatus.where).toEqual({
        active: { equals: true },
      });

      // byActive aggregation should exclude active filter, keeping status
      expect(params.aggregations?.byActive.where).toEqual({
        status: { equals: 'CONFIRMED' },
      });
    });

    test('should handle aggregation with no filters', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      }).parse({});

      const params = builder.build();

      expect(params.aggregations?.byStatus.where).toEqual({});
    });

    test('should handle aggregation with only aggregation field filter', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      }).parse({
        filters: 'status==CONFIRMED',
      });

      const params = builder.build();

      // When only the aggregation field is filtered, where should be empty
      expect(params.aggregations?.byStatus.where).toEqual({});
    });

    test('should handle aggregation with AND conditions', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      })
        .parse({
          filters: 'status==CONFIRMED,active==true',
        })
        .scope({ organizationId: 'org123' });

      const params = builder.build();

      // Aggregation where should exclude status but keep other AND conditions
      expect(params.aggregations?.byStatus.where).toEqual({
        AND: [{ active: { equals: true } }, { organizationId: 'org123' }],
      });
    });

    test('should handle nested field removal from complex where clause', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byOrganizationName: {
            field: ['organization', 'name'],
            type: 'groupBy',
          },
        },
      })
        .parse({
          filters: 'organization.name@=acme,active==true',
        })
        .scope({ organizationId: 'org123' });

      const params = builder.build();

      // Should remove organization.name but keep active and organizationId
      expect(params.aggregations?.byOrganizationName.where).toEqual({
        AND: [{ active: { equals: true } }, { organizationId: 'org123' }],
      });
    });

    test('should not include aggregations when not configured', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
      }).parse({
        filters: 'active==true',
      });

      const params = builder.build();

      expect(params.aggregations).toBeUndefined();
    });

    test('should pass aggregation params to execute callback', async () => {
      const mockContext = {
        header: vi.fn(),
      } as unknown as Context;

      const callbackSpy = vi.fn().mockResolvedValue({
        data: [],
        total: 0,
      });

      await createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      })
        .parse(
          {
            filters: 'status==CONFIRMED,name@=test',
          },
          mockContext
        )
        .paginate()
        .execute(callbackSpy);

      expect(callbackSpy).toHaveBeenCalledWith({
        where: {
          status: { equals: 'CONFIRMED' },
          name: { contains: 'test' },
        },
        orderBy: [],
        skip: 0,
        take: 10,
        aggregations: {
          byStatus: {
            by: ['status'],
            _count: { status: true },
            where: {
              name: { contains: 'test' },
            },
          },
        },
      });
    });

    test('should handle aggregation field path as string', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      }).parse({
        filters: 'status==CONFIRMED',
      });

      const params = builder.build();

      expect(params.aggregations?.byStatus.by).toEqual(['status']);
    });

    test('should handle aggregation field path as array', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byNested: {
            field: ['organization', 'name'],
            type: 'groupBy',
          },
        },
      }).parse({});

      const params = builder.build();

      expect(params.aggregations?.byNested.by).toEqual(['organization', 'name']);
    });

    test('should throw error for invalid empty field path', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          invalid: {
            field: [],
            type: 'groupBy',
          },
        },
      }).parse({});

      expect(() => builder.build()).toThrow('Invalid field path for aggregation: invalid');
    });

    test('should handle OR conditions in aggregation where clause', () => {
      const builder = createListQuery({
        filter: object({
          status: optional(stringFilterSchema()),
          active: optional(booleanFilterSchema()),
        }),
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      })
        .parse({
          filters: 'status==CONFIRMED',
        })
        .scope({ OR: [{ active: true }, { verified: true }] });

      const params = builder.build();

      // Status should be removed from aggregation, but OR scope should remain
      expect(params.aggregations?.byStatus.where).toEqual({
        OR: [{ active: true }, { verified: true }],
      });
    });

    test('should handle empty AND after removing aggregation field', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      })
        .parse({
          filters: 'status==CONFIRMED',
        })
        .scope({ AND: [{ status: 'CONFIRMED' }] });

      const params = builder.build();

      // When all conditions in AND are removed, should return empty object
      expect(params.aggregations?.byStatus.where).toEqual({});
    });

    test('should handle single item in AND after filtering', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      })
        .parse({
          filters: 'status==CONFIRMED',
        })
        .scope({ AND: [{ status: 'CONFIRMED' }, { active: true }] });

      const params = builder.build();

      // When AND has only one item after filtering, unwrap it
      expect(params.aggregations?.byStatus.where).toEqual({ active: true });
    });

    test('should handle empty OR after removing aggregation field', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({ OR: [{ status: 'CONFIRMED' }] });

      const params = builder.build();

      // When all conditions in OR are removed, should return empty object
      expect(params.aggregations?.byStatus.where).toEqual({});
    });

    test('should handle single item in OR after filtering', () => {
      const builder = createListQuery({
        filter: FilterSchemaWithStatus,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: 'status',
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({ OR: [{ status: 'CONFIRMED' }, { active: true }] });

      const params = builder.build();

      // When OR has only one item after filtering, unwrap it
      expect(params.aggregations?.byStatus.where).toEqual({ active: true });
    });

    test('should handle nested field when value is not an object', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byOrgName: {
            field: ['organization', 'name'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({ organization: 'invalid-should-be-object' });

      const params = builder.build();

      // Should keep the invalid value as-is (not try to recurse into it)
      expect(params.aggregations?.byOrgName.where).toEqual({
        organization: 'invalid-should-be-object',
      });
    });

    test('should handle nested field when parent is null', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byOrgName: {
            field: ['organization', 'name'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({ organization: null });

      const params = builder.build();

      // Should keep null value as-is
      expect(params.aggregations?.byOrgName.where).toEqual({
        organization: null,
      });
    });

    test('should remove parent when nested field removal makes it empty', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byOrgName: {
            field: ['organization', 'name'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({ organization: { name: 'test' } });

      const params = builder.build();

      // When removing 'name' makes 'organization' empty, remove the parent too
      expect(params.aggregations?.byOrgName.where).toEqual({});
    });

    test('should preserve nested parent when it has other fields', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byOrgName: {
            field: ['organization', 'name'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({ organization: { name: 'test', active: true } });

      const params = builder.build();

      // When removing 'name' but 'organization' still has 'active', keep the parent
      expect(params.aggregations?.byOrgName.where).toEqual({
        organization: { active: true },
      });
    });

    test('should handle Prisma relation filter with is wrapper', () => {
      // Prisma generates { relation: { is: { field: condition } } } for nested filters
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: ['currentStatus', 'status'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({ currentStatus: { is: { status: { equals: 'NEW' } } } });

      const params = builder.build();

      // Should remove the entire currentStatus when the only nested field is removed
      expect(params.aggregations?.byStatus.where).toEqual({});
    });

    test('should preserve other fields in Prisma is wrapper when removing aggregation field', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: ['currentStatus', 'status'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({
          currentStatus: { is: { status: { equals: 'NEW' }, createdAt: { gte: '2024-01-01' } } },
        });

      const params = builder.build();

      // Should remove status but keep createdAt inside the is wrapper
      expect(params.aggregations?.byStatus.where).toEqual({
        currentStatus: { is: { createdAt: { gte: '2024-01-01' } } },
      });
    });

    test('should keep sibling relation wrappers when is becomes empty', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: ['currentStatus', 'status'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({
          currentStatus: {
            is: { status: { equals: 'NEW' } },
            isNot: { archived: true },
          },
        });

      const params = builder.build();

      expect(params.aggregations?.byStatus.where).toEqual({
        currentStatus: { isNot: { archived: true } },
      });
    });

    test('should handle Prisma is wrapper with AND conditions containing nested filter', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byStatus: {
            field: ['currentStatus', 'status'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({
          AND: [
            { currentStatus: { is: { status: { in: ['APPROVED', 'IN_PRODUCTION'] } } } },
            { OR: [{ orderNumber: { contains: 'test', mode: 'insensitive' } }] },
          ],
        });

      const params = builder.build();

      // Should remove currentStatus.is.status but keep search condition
      // Single-item OR is unwrapped, single-item AND is unwrapped
      expect(params.aggregations?.byStatus.where).toEqual({
        orderNumber: { contains: 'test', mode: 'insensitive' },
      });
    });

    test('should handle deeply nested Prisma is wrappers', () => {
      const builder = createListQuery({
        filter: BasicFilterSchema,
        sort: BasicSortSchema,
        aggregations: {
          byOwnerName: {
            field: ['organization', 'owner', 'name'],
            type: 'groupBy',
          },
        },
      })
        .parse({})
        .scope({
          organization: { is: { owner: { is: { name: { equals: 'John' } } } } },
        });

      const params = builder.build();

      // Should remove the entire nested structure when the deepest field is removed
      expect(params.aggregations?.byOwnerName.where).toEqual({});
    });
  });
});
