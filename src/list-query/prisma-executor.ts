import type { PaginatedResult } from './builder.js';
import type { AggregationResult, PrismaAggregationParams } from './types.js';

/** Minimal Prisma `groupBy` surface used by {@link runGroupByAggregations}. */
export interface PrismaGroupByDelegate {
  groupBy(args: Record<string, unknown>): Promise<
    Array<
      Record<string, unknown> & {
        _count: Record<string, number>;
      }
    >
  >;
}

/** Minimal Prisma list delegate used by {@link createPrismaListExecutor}. */
export interface PrismaListDelegate<TItem, TWhere, TOrderBy> {
  findMany(args: {
    where?: TWhere;
    orderBy?: TOrderBy | TOrderBy[];
    skip?: number;
    take?: number;
    include?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<TItem[]>;
  count(args: { where?: TWhere }): Promise<number>;
}

export interface PrismaListQueryParams<TWhere, TOrderBy> {
  readonly where?: TWhere;
  readonly orderBy?: readonly TOrderBy[];
  readonly skip?: number;
  readonly take?: number;
  readonly aggregations?: Record<string, PrismaAggregationParams>;
}

/** Prisma model delegate shape accepted by {@link bindPrismaListDelegate}. */
export type PrismaListModelDelegate = {
  findMany(args?: object): Promise<unknown[]>;
  count(args?: object): Promise<number>;
  groupBy?(args?: object): Promise<unknown[]>;
};

/**
 * Adapt a Prisma model delegate for {@link createPrismaListExecutor}.
 * Centralizes the include/payload typing gap between Prisma delegates and list executors.
 */
export function bindPrismaListDelegate<TItem, TWhere, TOrderBy>(
  delegate: PrismaListModelDelegate
): PrismaListDelegate<TItem, TWhere, TOrderBy> {
  return delegate as PrismaListDelegate<TItem, TWhere, TOrderBy>;
}

/** Adapt a Prisma model delegate for {@link runGroupByAggregations}. */
export function bindPrismaGroupByDelegate(
  delegate: PrismaListModelDelegate
): PrismaGroupByDelegate {
  return delegate as PrismaGroupByDelegate;
}

export interface PrismaListExecutorConfig<TItem, TWhere, TOrderBy> {
  /** Resolves the Prisma model delegate (e.g. `() => bindPrismaListDelegate(prisma.user)`). */
  delegate: () => PrismaListDelegate<TItem, TWhere, TOrderBy>;
  readonly include?: Record<string, unknown>;
  readonly select?: Record<string, unknown>;
  readonly defaultOrderBy?: readonly TOrderBy[];
}

/**
 * Pick `orderBy` from list params, falling back to `defaultOrderBy` when empty.
 */
export function resolveOrderBy<TOrderBy>(
  orderBy: readonly TOrderBy[] | undefined,
  defaultOrderBy?: readonly TOrderBy[]
): TOrderBy[] {
  if (orderBy && orderBy.length > 0) {
    return [...orderBy];
  }
  return defaultOrderBy ? [...defaultOrderBy] : [];
}

/**
 * Run Prisma `groupBy` aggregations produced by `createListQuery().build()`.
 */
export async function runGroupByAggregations(
  delegate: PrismaGroupByDelegate,
  aggregationConfigs?: Record<string, PrismaAggregationParams>
): Promise<Record<string, AggregationResult> | undefined> {
  if (!aggregationConfigs) {
    return undefined;
  }

  const entries = Object.entries(aggregationConfigs);
  if (entries.length === 0) {
    return undefined;
  }

  const results: Record<string, AggregationResult> = {};

  await Promise.all(
    entries.map(async ([key, config]) => {
      const grouped = await delegate.groupBy({
        by: config.by,
        _count: config._count,
        where: config.where,
      });

      const countField = Object.keys(config._count)[0];
      if (!countField) {
        return;
      }

      const aggregationResult: Record<string, number> = {};
      for (const item of grouped) {
        const fieldValue = item[countField];
        const count = item._count[countField];
        if (count !== undefined) {
          aggregationResult[String(fieldValue)] = count;
        }
      }

      results[key] = aggregationResult;
    })
  );

  return results;
}

/**
 * Create a reusable list handler that runs `findMany`, `count`, and optional `groupBy`
 * aggregations from {@link createListQuery} params.
 */
export function createPrismaListExecutor<TItem, TWhere, TOrderBy>(
  config: PrismaListExecutorConfig<TItem, TWhere, TOrderBy>
): (params?: PrismaListQueryParams<TWhere, TOrderBy>) => Promise<PaginatedResult<TItem>> {
  return async (params) => {
    const delegate = config.delegate();
    const where = params?.where;
    const orderBy = resolveOrderBy(params?.orderBy, config.defaultOrderBy);

    const findManyArgs: Parameters<PrismaListDelegate<TItem, TWhere, TOrderBy>['findMany']>[0] = {
      where,
      orderBy,
      skip: params?.skip,
      take: params?.take,
    };

    if (config.include !== undefined) {
      findManyArgs.include = config.include;
    }
    if (config.select !== undefined) {
      findManyArgs.select = config.select;
    }

    const [data, total, aggregations] = await Promise.all([
      delegate.findMany(findManyArgs),
      delegate.count({ where }),
      runGroupByAggregations(delegate as unknown as PrismaGroupByDelegate, params?.aggregations),
    ]);

    return {
      data,
      total,
      ...(aggregations && { aggregations }),
    };
  };
}
