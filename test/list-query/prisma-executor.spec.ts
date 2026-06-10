import { describe, expect, test, vi } from 'vitest';
import {
  createPrismaListExecutor,
  resolveOrderBy,
  runGroupByAggregations,
} from '../../src/list-query/prisma-executor.js';

describe('resolveOrderBy', () => {
  test('returns request orderBy when present', () => {
    expect(resolveOrderBy([{ name: 'asc' }], [{ createdAt: 'desc' }])).toEqual([{ name: 'asc' }]);
  });

  test('returns defaultOrderBy when request orderBy is empty', () => {
    expect(resolveOrderBy([], [{ createdAt: 'desc' }])).toEqual([{ createdAt: 'desc' }]);
  });

  test('returns empty array when neither is set', () => {
    expect(resolveOrderBy(undefined, undefined)).toEqual([]);
  });
});

describe('runGroupByAggregations', () => {
  test('returns undefined when no configs are provided', async () => {
    const delegate = { groupBy: vi.fn() };

    await expect(runGroupByAggregations(delegate, undefined)).resolves.toBeUndefined();
    expect(delegate.groupBy).not.toHaveBeenCalled();
  });

  test('transforms groupBy results into count maps', async () => {
    const delegate = {
      groupBy: vi.fn().mockResolvedValue([
        { status: 'ACTIVE', _count: { status: 3 } },
        { status: 'INACTIVE', _count: { status: 1 } },
      ]),
    };

    const result = await runGroupByAggregations(delegate, {
      byStatus: {
        by: ['status'],
        _count: { status: true },
        where: { active: true },
      },
    });

    expect(delegate.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      _count: { status: true },
      where: { active: true },
    });
    expect(result).toEqual({
      byStatus: { ACTIVE: 3, INACTIVE: 1 },
    });
  });

  test('stringifies boolean aggregation keys', async () => {
    const delegate = {
      groupBy: vi.fn().mockResolvedValue([
        { active: true, _count: { active: 2 } },
        { active: false, _count: { active: 5 } },
      ]),
    };

    const result = await runGroupByAggregations(delegate, {
      byActive: {
        by: ['active'],
        _count: { active: true },
        where: {},
      },
    });

    expect(result).toEqual({
      byActive: { true: 2, false: 5 },
    });
  });

  test('runs multiple aggregations in parallel', async () => {
    const delegate = {
      groupBy: vi
        .fn()
        .mockResolvedValueOnce([{ status: 'OPEN', _count: { status: 4 } }])
        .mockResolvedValueOnce([{ role: 'ADMIN', _count: { role: 2 } }]),
    };

    const result = await runGroupByAggregations(delegate, {
      byStatus: {
        by: ['status'],
        _count: { status: true },
        where: {},
      },
      byRole: {
        by: ['role'],
        _count: { role: true },
        where: { active: true },
      },
    });

    expect(delegate.groupBy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      byStatus: { OPEN: 4 },
      byRole: { ADMIN: 2 },
    });
  });
});

describe('createPrismaListExecutor', () => {
  type TestItem = { id: string };
  type TestWhere = { active?: boolean };
  type TestOrderBy = { createdAt?: 'asc' | 'desc'; name?: 'asc' | 'desc' };

  test('runs findMany, count, and aggregations', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: '1' }]);
    const count = vi.fn().mockResolvedValue(1);
    const groupBy = vi.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { status: 1 } }]);

    const list = createPrismaListExecutor<TestItem, TestWhere, TestOrderBy>({
      delegate: () => ({ findMany, count, groupBy }),
      include: { category: true },
      defaultOrderBy: [{ createdAt: 'desc' }],
    });

    const result = await list({
      where: { active: true },
      skip: 0,
      take: 10,
      aggregations: {
        byStatus: {
          by: ['status'],
          _count: { status: true },
          where: {},
        },
      },
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: [{ createdAt: 'desc' }],
      skip: 0,
      take: 10,
      include: { category: true },
    });
    expect(count).toHaveBeenCalledWith({ where: { active: true } });
    expect(result).toEqual({
      data: [{ id: '1' }],
      total: 1,
      aggregations: { byStatus: { ACTIVE: 1 } },
    });
  });

  test('prefers request orderBy over defaultOrderBy', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    const list = createPrismaListExecutor<TestItem, TestWhere, TestOrderBy>({
      delegate: () => ({
        findMany,
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn(),
      }),
      defaultOrderBy: [{ createdAt: 'desc' }],
    });

    await list({ orderBy: [{ name: 'asc' }] });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: 'asc' }],
      })
    );
  });

  test('works without params', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);

    const list = createPrismaListExecutor<TestItem, TestWhere, TestOrderBy>({
      delegate: () => ({
        findMany,
        count,
        groupBy: vi.fn(),
      }),
    });

    const result = await list();

    expect(findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [],
      skip: undefined,
      take: undefined,
    });
    expect(result).toEqual({ data: [], total: 0 });
  });
});
