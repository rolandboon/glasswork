import {
  array,
  type BaseIssue,
  type BaseSchema,
  literal,
  object,
  optional,
  picklist,
  string,
  union,
} from 'valibot';

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
  object({
    equals: optional(union([string(), literal(true), literal(false)])),
    not: optional(union([string(), literal(true), literal(false)])),
    lt: optional(union([string(), literal(true), literal(false)])),
    lte: optional(union([string(), literal(true), literal(false)])),
    gt: optional(union([string(), literal(true), literal(false)])),
    gte: optional(union([string(), literal(true), literal(false)])),
  });

/**
 * Schema for Prisma DateTimeFilter operations
 * Supports date comparison operations
 */
export const dateFilterSchema = () =>
  object({
    equals: optional(string()),
    not: optional(string()),
    lt: optional(string()),
    lte: optional(string()),
    gt: optional(string()),
    gte: optional(string()),
  });

/**
 * Schema for Prisma BoolFilter operations
 * Only supports equals and not operations
 */
export const booleanFilterSchema = () =>
  object({
    equals: optional(union([literal(true), literal(false)])),
    not: optional(union([literal(true), literal(false)])),
  });

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

/**
 * Helper to create a sort schema for a model
 * Pass an object with field names as keys and sortDirectionSchema() as values
 */
export function createSortSchema(fields: Record<string, ReturnType<typeof sortDirectionSchema>>) {
  return object(
    Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, optional(schema)]))
  );
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
      [K in keyof T]: ReturnType<typeof optional>;
    }
  );
}
