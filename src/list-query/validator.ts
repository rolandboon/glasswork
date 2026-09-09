import { type BaseIssue, type BaseSchema, type InferOutput, parse } from 'valibot';
import { ValidationException } from '../http/errors.js';
import type { PrismaAggregationParams } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasSameKeys(input: unknown, output: unknown): boolean {
  if (!isRecord(input) || !isRecord(output)) {
    return true;
  }
  return Object.entries(input).every(
    ([key, value]) => Object.hasOwn(output, key) && hasSameKeys(value, output[key])
  );
}

/**
 * Schema-based validation configuration
 * Defines Valibot schemas for validating Prisma where and orderBy clauses
 */
export interface SchemaValidationConfig<
  TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> {
  readonly whereSchema: TWhereSchema;
  readonly orderBySchema: TOrderBySchema;
}

/**
 * Validated list params with proper typing from Valibot schemas
 * Note: orderBy is not readonly to match Prisma's expected type
 */
export interface ValidatedListParams<
  TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> {
  readonly where?: InferOutput<TWhereSchema>;
  readonly orderBy?: InferOutput<TOrderBySchema>[];
  readonly skip?: number;
  readonly take?: number;
  readonly aggregations?: Record<string, PrismaAggregationParams>;
}

/**
 * Validate and parse Prisma where clause against schema
 * Returns the validated and typed result
 */
export function validateWhere<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
  where: Record<string, unknown>,
  schema: TSchema
): InferOutput<TSchema> {
  try {
    const validated = parse(schema, where);
    if (!hasSameKeys(where, validated)) {
      throw new ValidationException('Invalid filter query.');
    }
    return validated;
  } catch (error) {
    if (error instanceof ValidationException) throw error;
    throw new ValidationException('Invalid filter query.');
  }
}

/**
 * Validate and parse Prisma orderBy clause against schema
 * Returns the validated and typed results as a mutable array (not readonly) to match Prisma's expectations
 */
export function validateOrderBy<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
  orderBy: readonly Record<string, unknown>[],
  schema: TSchema
): InferOutput<TSchema>[] {
  try {
    return orderBy.map((order) => {
      const validated = parse(schema, order);
      if (!hasSameKeys(order, validated)) {
        throw new ValidationException('Invalid sort query.');
      }
      return validated;
    });
  } catch (error) {
    if (error instanceof ValidationException) throw error;
    throw new ValidationException('Invalid sort query.');
  }
}

/**
 * Validate Prisma list params against schemas
 * Returns validated and properly typed params
 */
export function validateListParams<
  TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(
  where: Record<string, unknown>,
  orderBy: readonly Record<string, unknown>[],
  skip: number | undefined,
  take: number | undefined,
  config: SchemaValidationConfig<TWhereSchema, TOrderBySchema>
): ValidatedListParams<TWhereSchema, TOrderBySchema> {
  return {
    where: validateWhere(where, config.whereSchema),
    orderBy: validateOrderBy(orderBy, config.orderBySchema),
    skip,
    take,
  };
}
