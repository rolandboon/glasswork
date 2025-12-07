import type { Context } from 'hono';
import type { BaseIssue, BaseSchema, InferOutput } from 'valibot';
import { buildGlobalSearchWhere } from './global-search.js';
import { parseQueryParams } from './parser.js';
import { buildPrismaParams } from './prisma-builder.js';
import type {
  AggregationConfig,
  AggregationResult,
  ParsedQueryParams,
  PrismaAggregationParams,
  PrismaListParams,
  RawQueryParams,
  SearchFieldInput,
} from './types.js';
import type { SchemaValidationConfig, ValidatedListParams } from './validator.js';
import { validateListParams } from './validator.js';

export interface PaginatedResult<T> {
  readonly data: T[];
  readonly total: number;
  readonly aggregations?: Record<string, AggregationResult>;
}

export interface ListQueryConfig<
  TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> {
  readonly filter?: TWhereSchema;
  readonly sort?: TOrderBySchema;
  readonly search?: readonly SearchFieldInput[];
  readonly aggregations?: Record<string, AggregationConfig>;
}

export class ListQueryBuilder<
  TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> {
  private parsedQuery?: ParsedQueryParams;
  private prismaParams?: PrismaListParams;
  private paginationEnabled = true;
  private context?: Context;
  private whereConditions: Record<string, unknown>[] = [];
  private transformFn?: (
    params: ValidatedListParams<TWhereSchema, TOrderBySchema>
  ) => ValidatedListParams<TWhereSchema, TOrderBySchema>;

  constructor(
    private config: ListQueryConfig<TWhereSchema, TOrderBySchema>,
    private validationConfig?: SchemaValidationConfig<TWhereSchema, TOrderBySchema>
  ) {}

  parse(query: RawQueryParams, context?: Context): this {
    this.parsedQuery = parseQueryParams(query);
    this.prismaParams = buildPrismaParams(this.parsedQuery);
    this.context = context;

    // Apply global search if configured
    if (this.config.search && this.parsedQuery?.search) {
      const searchWhere = buildGlobalSearchWhere(this.config.search, this.parsedQuery.search);
      if (Object.keys(searchWhere).length > 0) {
        this.whereConditions.push(searchWhere);
      }
    }

    return this;
  }

  scope(conditions: InferOutput<TWhereSchema> | Record<string, unknown>): this {
    if (conditions && Object.keys(conditions).length > 0) {
      this.whereConditions.push(conditions as Record<string, unknown>);
    }
    return this;
  }

  paginate(): this {
    this.paginationEnabled = true;
    return this;
  }

  /**
   * Explicitly disable pagination for this query.
   * Use sparingly for internal/admin use cases where full result sets are required.
   */
  disablePagination(): this {
    this.paginationEnabled = false;
    return this;
  }

  transform(
    fn: (
      params: ValidatedListParams<TWhereSchema, TOrderBySchema>
    ) => ValidatedListParams<TWhereSchema, TOrderBySchema>
  ): this {
    this.transformFn = fn;
    return this;
  }

  build(): ValidatedListParams<TWhereSchema, TOrderBySchema> {
    if (!this.prismaParams) {
      throw new Error('Must call .parse() before .build()');
    }

    // Validate user input first (before merging with application conditions)
    let validatedWhere: Record<string, unknown>;
    let validatedOrderBy: InferOutput<TOrderBySchema>[];

    if (this.validationConfig) {
      const validated = validateListParams(
        this.prismaParams.where,
        this.prismaParams.orderBy,
        this.paginationEnabled ? this.prismaParams.skip : 0,
        this.paginationEnabled ? this.prismaParams.take : undefined,
        this.validationConfig
      );
      validatedWhere = validated.where as Record<string, unknown>;
      validatedOrderBy = validated.orderBy;
    } else {
      validatedWhere = this.prismaParams.where;
      validatedOrderBy = this.prismaParams.orderBy as InferOutput<TOrderBySchema>[];
    }

    // Now merge with application-controlled conditions (global search, scope)
    let mergedWhere = validatedWhere;
    if (this.whereConditions.length > 0) {
      mergedWhere = this.mergeWhereConditions([validatedWhere, ...this.whereConditions]);
    }

    // Deep copy for params.where to prevent any potential mutation
    // buildAggregationParams uses mergedWhere directly since removeFieldFromWhere is immutable
    const whereForParams = JSON.parse(JSON.stringify(mergedWhere)) as Record<string, unknown>;

    let params: ValidatedListParams<TWhereSchema, TOrderBySchema> = {
      where: whereForParams as InferOutput<TWhereSchema>,
      orderBy: validatedOrderBy,
      skip: this.paginationEnabled ? this.prismaParams.skip : 0,
      take: this.paginationEnabled ? this.prismaParams.take : undefined,
      aggregations: this.buildAggregationParams(mergedWhere),
    };

    // Apply transform if configured
    if (this.transformFn) {
      params = this.transformFn(params);
    }

    return params;
  }

  private buildAggregationParams(
    mergedWhere: Record<string, unknown>
  ): Record<string, PrismaAggregationParams> | undefined {
    if (!this.config.aggregations || !this.prismaParams) {
      return undefined;
    }

    const aggregationParams: Record<string, PrismaAggregationParams> = {};

    for (const [key, config] of Object.entries(this.config.aggregations)) {
      const fieldPath = Array.isArray(config.field) ? config.field : [config.field];
      const lastField = fieldPath[fieldPath.length - 1];
      if (!lastField) {
        throw new Error(`Invalid field path for aggregation: ${key}`);
      }

      // Remove filter on the aggregation field to get counts across all values
      const whereWithoutAggregationField = this.removeFieldFromWhere(mergedWhere, fieldPath);

      aggregationParams[key] = {
        by: fieldPath as string[],
        _count: { [lastField]: true },
        where: whereWithoutAggregationField,
      };
    }

    return aggregationParams;
  }

  private removeFieldFromWhere(
    where: Record<string, unknown>,
    fieldPath: readonly string[]
  ): Record<string, unknown> {
    if (fieldPath.length === 0) {
      return { ...where };
    }

    // Handle AND/OR arrays - recursively process each condition
    if ('AND' in where && Array.isArray(where.AND)) {
      return this.processLogicalArray(where.AND as Record<string, unknown>[], fieldPath, 'AND');
    }

    if ('OR' in where && Array.isArray(where.OR)) {
      return this.processLogicalArray(where.OR as Record<string, unknown>[], fieldPath, 'OR');
    }

    // For simple field (e.g., ['status']), remove it from root
    if (fieldPath.length === 1) {
      return this.removeSimpleField(where, fieldPath[0]);
    }

    // For nested fields (e.g., ['organization', 'name']), recursively remove
    return this.removeNestedField(where, fieldPath);
  }

  private processLogicalArray(
    conditions: Record<string, unknown>[],
    fieldPath: readonly string[],
    operator: 'AND' | 'OR'
  ): Record<string, unknown> {
    const updated = conditions
      .map((condition) => this.removeFieldFromWhere(condition, fieldPath))
      .filter((condition) => Object.keys(condition).length > 0);

    if (updated.length === 0) {
      return {};
    }
    if (updated.length === 1) {
      return updated[0];
    }
    return { [operator]: updated };
  }

  private removeSimpleField(
    where: Record<string, unknown>,
    field: string
  ): Record<string, unknown> {
    const { [field]: _, ...rest } = where;
    return rest;
  }

  private removeNestedField(
    where: Record<string, unknown>,
    fieldPath: readonly string[]
  ): Record<string, unknown> {
    const [firstField, ...restPath] = fieldPath;
    if (!firstField || !(firstField in where)) {
      return { ...where };
    }

    const nestedValue = where[firstField];
    if (typeof nestedValue !== 'object' || nestedValue === null) {
      return { ...where };
    }

    const nestedObj = nestedValue as Record<string, unknown>;

    const relationHandled = this.handleRelationWrapper(where, firstField, nestedObj, restPath);
    if (relationHandled) {
      return relationHandled;
    }

    // Create a copy of nested value to avoid mutation
    const nestedCopy = { ...nestedObj };
    const updatedNested = this.removeFieldFromWhere(nestedCopy, restPath);

    // If the nested object is now empty, remove the parent field too
    if (Object.keys(updatedNested).length === 0) {
      const { [firstField]: _, ...rest } = where;
      return rest;
    }

    return {
      ...where,
      [firstField]: updatedNested,
    };
  }

  /**
   * Handle Prisma relation filter wrappers (is, isNot, some, none, every).
   * Returns an updated where object when a wrapper was processed, otherwise undefined.
   */
  private handleRelationWrapper(
    where: Record<string, unknown>,
    firstField: string,
    nestedObj: Record<string, unknown>,
    restPath: readonly string[]
  ): Record<string, unknown> | undefined {
    const relationKeys: readonly string[] = ['is', 'isNot', 'some', 'none', 'every'];
    for (const key of relationKeys) {
      if (!(key in nestedObj) || typeof nestedObj[key] !== 'object' || nestedObj[key] === null) {
        continue;
      }

      const wrapperObj = nestedObj[key] as Record<string, unknown>;
      const updatedWrapper = this.removeFieldFromWhere(wrapperObj, restPath);
      const nestedWithoutKey = { ...nestedObj };
      delete nestedWithoutKey[key];

      if (Object.keys(updatedWrapper).length === 0) {
        if (Object.keys(nestedWithoutKey).length > 0) {
          return { ...where, [firstField]: nestedWithoutKey };
        }
        const { [firstField]: _, ...rest } = where;
        return rest;
      }

      return {
        ...where,
        [firstField]: { ...nestedObj, [key]: updatedWrapper },
      };
    }
    return undefined;
  }

  async execute<T>(
    callback: (
      params: ValidatedListParams<TWhereSchema, TOrderBySchema>
    ) => Promise<PaginatedResult<T>>
  ): Promise<PaginatedResult<T>> {
    const params = this.build();
    const result = await callback(params);

    // Set pagination headers if enabled and context available
    if (this.paginationEnabled && this.context && this.parsedQuery) {
      const totalPages = Math.ceil(result.total / this.parsedQuery.pageSize);
      this.context.header('X-Total-Count', result.total.toString());
      this.context.header('X-Total-Pages', totalPages.toString());
      this.context.header('X-Current-Page', this.parsedQuery.page.toString());
      this.context.header('X-Page-Size', this.parsedQuery.pageSize.toString());
    }

    return result;
  }

  private mergeWhereConditions(conditions: Record<string, unknown>[]): Record<string, unknown> {
    const nonEmpty = conditions.filter((c) => Object.keys(c).length > 0);
    if (nonEmpty.length === 0) return {};
    if (nonEmpty.length === 1) return nonEmpty[0];
    return { AND: nonEmpty };
  }
}

export function createListQuery<
  TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(config: ListQueryConfig<TWhereSchema, TOrderBySchema>) {
  const validationConfig =
    config.filter && config.sort
      ? { whereSchema: config.filter, orderBySchema: config.sort }
      : undefined;

  return new ListQueryBuilder(config, validationConfig);
}
