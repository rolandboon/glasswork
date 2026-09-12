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

/** Prisma model delegate shape accepted by {@link executePrismaList} and {@link createPrismaListExecutor}. */
export type PrismaModelDelegate<TItem = unknown, TWhere = unknown, TOrderBy = unknown> = {
  findMany(args?: {
    where?: TWhere;
    orderBy?: TOrderBy | readonly TOrderBy[];
    skip?: number;
    take?: number;
    include?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<TItem[]>;
  count(args?: { where?: TWhere }): Promise<number>;
  groupBy?(args?: Record<string, unknown>): Promise<unknown[]>;
};

/** Backwards-compatible alias for {@link PrismaModelDelegate}. */
export type PrismaListDelegate<TItem, TWhere, TOrderBy> = PrismaModelDelegate<
  TItem,
  TWhere,
  TOrderBy
>;

/** Backwards-compatible alias for loose model delegate shape. */
export type PrismaListModelDelegate = {
  findMany(args?: never): Promise<unknown>;
  count(args?: never): Promise<number>;
  groupBy?: (args: never) => Promise<unknown>;
};

/** Adapt a Prisma model delegate for {@link runGroupByAggregations}. */
export function bindPrismaGroupByDelegate(
  delegate: PrismaListModelDelegate
): PrismaGroupByDelegate {
  return delegate as unknown as PrismaGroupByDelegate;
}

export interface ExecutePrismaListArgs<TWhere = unknown, TOrderBy = unknown> {
  readonly where?: TWhere | undefined;
  readonly orderBy?: TOrderBy | readonly TOrderBy[] | undefined;
  readonly skip?: number | undefined;
  readonly take?: number | undefined;
  readonly include?: Record<string, unknown> | undefined;
  readonly select?: Record<string, unknown> | undefined;
  readonly aggregations?: Record<string, PrismaAggregationParams> | undefined;
  readonly defaultOrderBy?: readonly TOrderBy[] | undefined;
}

export interface PrismaListQueryParams<TWhere, TOrderBy> {
  readonly where?: TWhere | undefined;
  readonly orderBy?: readonly TOrderBy[] | undefined;
  readonly skip?: number | undefined;
  readonly take?: number | undefined;
  readonly aggregations?: Record<string, PrismaAggregationParams> | undefined;
}

export interface PrismaListExecutorConfig<TItem, TWhere, TOrderBy> {
  /** Resolves or provides the Prisma model delegate (e.g. `prisma.user` or `() => prisma.user`). */
  delegate:
    | PrismaListModelDelegate
    | (() => PrismaListModelDelegate);
  readonly include?: Record<string, unknown> | undefined;
  readonly select?: Record<string, unknown> | undefined;
  readonly defaultOrderBy?: readonly TOrderBy[] | undefined;
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
 * Execute a Prisma list query directly against a model delegate with findMany, count,
 * and optional groupBy aggregations.
 */
export async function executePrismaList<
  TItem = unknown,
  TWhere = unknown,
  TOrderBy = unknown
>(
  delegate: PrismaListModelDelegate,
  args?: ExecutePrismaListArgs<TWhere, TOrderBy>
): Promise<PaginatedResult<TItem>> {
  const where = args?.where;
  const rawOrderBy = args?.orderBy;
  const orderByArray = rawOrderBy
    ? Array.isArray(rawOrderBy)
      ? rawOrderBy
      : [rawOrderBy]
    : undefined;
  const orderBy = resolveOrderBy(orderByArray, args?.defaultOrderBy);

  const findManyArgs: Record<string, unknown> = {
    where,
    orderBy,
    skip: args?.skip,
    take: args?.take,
  };

  if (args?.include !== undefined) {
    findManyArgs.include = args.include;
  }
  if (args?.select !== undefined) {
    findManyArgs.select = args.select;
  }

  type InternalCaller = {
    findMany(args?: Record<string, unknown>): Promise<TItem[]>;
    count(args?: { where?: unknown }): Promise<number>;
    groupBy?(args?: Record<string, unknown>): Promise<unknown[]>;
  };
  const caller = delegate as unknown as InternalCaller;

  const [data, total, aggregations] = await Promise.all([
    caller.findMany(findManyArgs),
    caller.count({ where }),
    runGroupByAggregations(caller as unknown as PrismaGroupByDelegate, args?.aggregations),
  ]);

  return {
    data,
    total,
    ...(aggregations && { aggregations }),
  };
}

/**
 * Create a reusable list handler that runs `findMany`, `count`, and optional `groupBy`
 * aggregations from {@link createListQuery} params.
 */
export function createPrismaListExecutor<
  TItem = unknown,
  TWhere = unknown,
  TOrderBy = unknown
>(
  config: PrismaListExecutorConfig<TItem, TWhere, TOrderBy>
): (params?: PrismaListQueryParams<TWhere, TOrderBy>) => Promise<PaginatedResult<TItem>> {
  return (params) => {
    const delegate = typeof config.delegate === 'function' ? config.delegate() : config.delegate;
    return executePrismaList<TItem, TWhere, TOrderBy>(delegate, {
      ...params,
      include: config.include,
      select: config.select,
      defaultOrderBy: config.defaultOrderBy,
    });
  };
}

