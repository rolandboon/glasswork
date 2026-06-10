import {
  array,
  type BaseIssue,
  type BaseSchema,
  literal,
  number,
  type OptionalSchema,
  object,
  optional,
  picklist,
  string,
  union,
} from 'valibot';
import type { SortFieldsToOrderBy } from './sort-field-types.js';

/** Marks typed filter schemas for schema-aware value parsing in list-query builder. */
export const FILTER_SCHEMA_KIND = Symbol.for('glasswork.list-query.filterSchemaKind');

export type TypedFilterSchemaKind = 'date' | 'int' | 'number' | 'boolean';

function markTypedFilterSchema<T extends object>(
  schema: T,
  kind: TypedFilterSchemaKind
): T {
  Object.defineProperty(schema, FILTER_SCHEMA_KIND, {
    value: kind,
    enumerable: false,
  });
  return schema;
}

/**
 * Schema for Prisma sort direction
 */
export const sortDirectionSchema = () => picklist(['asc', 'desc']);

/**
 * Schema for Prisma StringFilter operations
 * Supports all string-based filter operations
 */
export const stringFilterSchema = () =>
  object({
    equals: optional(string()),
    not: optional(union([string(), object({ equals: optional(string()) })])),
    contains: optional(string()),
    startsWith: optional(string()),
    endsWith: optional(string()),
    in: optional(array(string())),
    notIn: optional(array(string())),
    mode: optional(picklist(['default', 'insensitive'])),
  });

/**
 * Schema for Prisma IntFilter or FloatFilter operations
 * Supports numeric comparison operations
 */
export const numberFilterSchema = () =>
  markTypedFilterSchema(
    object({
      equals: optional(union([string(), literal(true), literal(false)])),
      not: optional(union([string(), literal(true), literal(false)])),
      lt: optional(union([string(), literal(true), literal(false)])),
      lte: optional(union([string(), literal(true), literal(false)])),
      gt: optional(union([string(), literal(true), literal(false)])),
      gte: optional(union([string(), literal(true), literal(false)])),
    }),
    'number'
  );

/**
 * Schema for Prisma IntFilter operations (numeric fields stored as integers).
 */
export const intFilterSchema = () =>
  markTypedFilterSchema(
    object({
      equals: optional(number()),
      not: optional(number()),
      lt: optional(number()),
      lte: optional(number()),
      gt: optional(number()),
      gte: optional(number()),
      in: optional(array(number())),
      notIn: optional(array(number())),
    }),
    'int'
  );

/**
 * Schema for Prisma DateTimeFilter operations
 * Supports date comparison operations
 */
export const dateFilterSchema = () =>
  markTypedFilterSchema(
    object({
      equals: optional(string()),
      not: optional(string()),
      lt: optional(string()),
      lte: optional(string()),
      gt: optional(string()),
      gte: optional(string()),
    }),
    'date'
  );

/**
 * Schema for Prisma BoolFilter operations
 * Only supports equals and not operations
 */
export const booleanFilterSchema = () =>
  markTypedFilterSchema(
    object({
      equals: optional(union([literal(true), literal(false)])),
      not: optional(union([literal(true), literal(false)])),
    }),
    'boolean'
  );

/**
 * Schema for Prisma EnumFilter operations
 * Supports equals and not operations with specific enum values
 * Pass a picklist schema with the allowed enum values
 */
export function enumFilterSchema<TEnum extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
  enumSchema: TEnum
) {
  return object({
    equals: optional(enumSchema),
    not: optional(enumSchema),
    in: optional(array(enumSchema)),
    notIn: optional(array(enumSchema)),
  });
}

/**
 * Schema for nested relation filters
 * Allows validation of nested where conditions
 */
export function relationFilterSchema<T extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
  nestedSchema: T
) {
  return object({
    is: optional(nestedSchema),
    isNot: optional(nestedSchema),
  });
}

type SortDirectionSchema = ReturnType<typeof sortDirectionSchema>;

function isSortDirectionSchema(value: unknown): value is SortDirectionSchema {
  return typeof value === 'object' && value !== null && '~run' in value;
}

function addSortFieldToTree(
  tree: Record<string, unknown>,
  path: string,
  schema: SortDirectionSchema
): void {
  const segments = path.split('.');
  if (segments.some((segment) => segment === '')) {
    throw new Error(`Invalid sort field path: "${path}"`);
  }

  if (segments.length === 1) {
    const field = segments[0] as string;
    const existing = tree[field];
    if (existing !== undefined && !isSortDirectionSchema(existing)) {
      throw new Error(`Sort field path conflict at "${field}"`);
    }
    tree[field] = schema;
    return;
  }

  const [head, ...rest] = segments;
  const field = head as string;
  const existing = tree[field];
  if (existing !== undefined && isSortDirectionSchema(existing)) {
    throw new Error(`Sort field path conflict at "${field}"`);
  }

  const nested = (existing ?? {}) as Record<string, unknown>;
  tree[field] = nested;
  addSortFieldToTree(nested, rest.join('.'), schema);
}

function buildSortObjectSchema(
  fields: Record<string, unknown>
): BaseSchema<unknown, unknown, BaseIssue<unknown>> {
  return object(
    Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        if (isSortDirectionSchema(value)) {
          return [key, optional(value)];
        }
        return [key, optional(buildSortObjectSchema(value as Record<string, unknown>))];
      })
    ) as {
      [K in string]: OptionalSchema<SortDirectionSchema, undefined>;
    }
  );
}

/**
 * Helper to create a sort schema for a model.
 * Pass field names as keys and sortDirectionSchema() as values.
 * Use dot notation for nested relation sorts (e.g. `'organization.name'`).
 */
export function createSortSchema<T extends Record<string, SortDirectionSchema>>(
  fields: T
): BaseSchema<SortFieldsToOrderBy<T>, SortFieldsToOrderBy<T>, BaseIssue<unknown>> {
  const tree: Record<string, unknown> = {};
  for (const [path, schema] of Object.entries(fields)) {
    addSortFieldToTree(tree, path, schema);
  }
  return buildSortObjectSchema(tree) as BaseSchema<
    SortFieldsToOrderBy<T>,
    SortFieldsToOrderBy<T>,
    BaseIssue<unknown>
  >;
}

/**
 * Helper to create a filter schema for a model
 * Pass an object with field names as keys and filter schemas as values
 */
export function createFilterSchema<
  T extends Record<string, BaseSchema<unknown, unknown, BaseIssue<unknown>>>,
>(fields: T) {
  return object(
    Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, optional(schema)])) as {
      [K in keyof T]: OptionalSchema<T[K], undefined>;
    }
  );
}
