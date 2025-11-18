/**
 * Field path as an array of strings for nested fields
 * Example: ['organization', 'name'] represents 'organization.name'
 */
export type FieldPath = readonly string[];

/**
 * Search field input - accepts either a simple string for flat fields
 * or an array for nested fields
 * Example: 'name' or ['organization', 'name']
 */
export type SearchFieldInput = string | readonly string[];

/**
 * Sieve filter operators
 * Based on https://github.com/Biarity/Sieve
 */
export type FilterOperator =
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | '@='
  | '_='
  | '_-='
  | '!@='
  | '!_='
  | '!_-='
  | '==*'
  | '!=*'
  | '@=*'
  | '_=*'
  | '_-=*'
  | '!@=*'
  | '!_=*'
  | '!_-=*';

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Parsed filter condition
 */
export interface ParsedFilter {
  readonly fieldPath: FieldPath;
  readonly operator: FilterOperator;
  readonly value: string;
}

/**
 * Parsed sort condition
 */
export interface ParsedSort {
  readonly fieldPath: FieldPath;
  readonly direction: SortDirection;
}

/**
 * Raw query parameters from HTTP request
 */
export interface RawQueryParams {
  readonly sorts?: string;
  readonly filters?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string;
}

/**
 * Parsed query parameters
 */
export interface ParsedQueryParams {
  readonly sorts: readonly ParsedSort[];
  readonly filters: readonly ParsedFilter[];
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
}

/**
 * Prisma-ready query parameters for list operations
 * Generic type parameter should be the Prisma WhereInput and OrderByInput types
 */
export interface PrismaListParams<
  TWhere = Record<string, unknown>,
  TOrderBy = Record<string, unknown>,
> {
  readonly where: TWhere;
  readonly orderBy: readonly TOrderBy[];
  readonly skip: number;
  readonly take: number;
}

/**
 * Aggregation type
 */
export type AggregationType = 'groupBy';

/**
 * Configuration for a single aggregation
 */
export interface AggregationConfig {
  readonly field: FieldPath | string;
  readonly type: AggregationType;
}

/**
 * Result of an aggregation (field value -> count)
 * Example: { PENDING: 5, CONFIRMED: 3 }
 */
export interface AggregationResult {
  readonly [key: string]: number;
}

/**
 * Prisma groupBy parameters for computing aggregations
 */
export interface PrismaAggregationParams {
  readonly by: string[];
  readonly _count: Record<string, true>;
  readonly where: Record<string, unknown>;
}
