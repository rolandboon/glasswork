import type { BaseIssue, BaseSchema } from 'valibot';
import { FILTER_SCHEMA_KIND, type TypedFilterSchemaKind } from './schema-helpers.js';
import type { FilterOperator } from './types.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_OPERATORS = ['equals', 'not', 'lt', 'lte', 'gt', 'gte', 'in', 'notIn'] as const;
const COMPARISON_OPERATORS = ['lt', 'lte', 'gt', 'gte'] as const;
const RELATION_WRAPPER_KEYS = ['is', 'isNot', 'some', 'none', 'every'] as const;

type SchemaNode = BaseSchema<unknown, unknown, BaseIssue<unknown>>;
export type FilterScalar = string | number | boolean | Date;

/**
 * Parse a single filter literal from a query string token.
 *
 * - `true` / `false` → boolean
 * - Numeric-looking strings → number
 * - Everything else → unchanged string
 *
 * Date literals are not parsed here; use `parseWhereFilterValues` with `dateFilterSchema()`.
 */
export function parseFilterLiteral(value: string): string | number | boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const numValue = Number(value);
  if (!Number.isNaN(numValue) && value.trim() !== '') {
    return numValue;
  }
  return value;
}

function parseDateLiteral(value: string): Date | string {
  if (!DATE_PATTERN.test(value)) {
    return value;
  }
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Parse a filter value for `operator` before building Prisma conditions from query params.
 *
 * Substring and IN operators keep the raw string; equality and comparison operators
 * delegate to `parseFilterLiteral`.
 */
export function parseFilterValue(value: string, operator: FilterOperator): string | number | boolean {
  const baseOperator = operator.replace(/\*$/, '') as FilterOperator;

  if (baseOperator.includes('|')) {
    return value;
  }

  if (
    baseOperator === '@=' ||
    baseOperator === '_=' ||
    baseOperator === '_-=' ||
    baseOperator === '!@=' ||
    baseOperator === '!_=' ||
    baseOperator === '!_-='
  ) {
    return value;
  }

  return parseFilterLiteral(value);
}

function unwrapSchema(schema: unknown): unknown {
  let current = schema;
  while (
    current !== null &&
    typeof current === 'object' &&
    'type' in current &&
    (current.type === 'optional' || current.type === 'nullable') &&
    'wrapped' in current
  ) {
    current = current.wrapped;
  }
  return current;
}

function getFilterSchemaKind(schema: unknown): TypedFilterSchemaKind | undefined {
  const unwrapped = unwrapSchema(schema);
  if (typeof unwrapped !== 'object' || unwrapped === null || !(FILTER_SCHEMA_KIND in unwrapped)) {
    return undefined;
  }
  return (unwrapped as Record<symbol, TypedFilterSchemaKind>)[FILTER_SCHEMA_KIND];
}

function getObjectSchemaEntries(schema: unknown): Record<string, SchemaNode> | undefined {
  const unwrapped = unwrapSchema(schema) as { type?: string; entries?: Record<string, SchemaNode> };
  if (unwrapped.type !== 'object' || !unwrapped.entries) {
    return undefined;
  }
  return unwrapped.entries;
}

function isRelationFilterSchema(schema: unknown): boolean {
  const entries = getObjectSchemaEntries(schema);
  if (!entries) {
    return false;
  }
  const keys = Object.keys(entries);
  return keys.length > 0 && keys.every((key) => key === 'is' || key === 'isNot');
}

function isFilterConditionObject(value: Record<string, unknown>): boolean {
  return FILTER_OPERATORS.some((operator) => operator in value);
}

function parseScalarForKind(value: string, kind: TypedFilterSchemaKind): FilterScalar {
  switch (kind) {
    case 'date':
      return parseDateLiteral(value);
    case 'int':
    case 'number':
    case 'boolean':
      return parseFilterLiteral(value);
  }
}

function parseTypedFilterCondition(
  value: Record<string, unknown>,
  kind: TypedFilterSchemaKind
): Record<string, unknown> {
  const result = { ...value };

  for (const operator of FILTER_OPERATORS) {
    const operatorValue = result[operator];
    if (operatorValue === undefined) {
      continue;
    }

    if (operator === 'in' || operator === 'notIn') {
      if ((kind === 'int' || kind === 'number') && Array.isArray(operatorValue)) {
        result[operator] = operatorValue.map((item) =>
          typeof item === 'string' ? parseFilterLiteral(item) : item
        );
      }
      continue;
    }

    if (typeof operatorValue !== 'string') {
      continue;
    }

    if (kind === 'boolean' && operator !== 'equals' && operator !== 'not') {
      continue;
    }

    result[operator] = parseScalarForKind(operatorValue, kind);
  }

  return result;
}

function parseUnknownComparisonLiteral(value: string): FilterScalar {
  if (DATE_PATTERN.test(value)) {
    return parseDateLiteral(value);
  }
  return parseFilterLiteral(value);
}

function parseUnknownFilterCondition(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  for (const operator of COMPARISON_OPERATORS) {
    const operatorValue = result[operator];
    if (typeof operatorValue === 'string') {
      result[operator] = parseUnknownComparisonLiteral(operatorValue);
    }
  }
  return result;
}

function parseUnknownWhere(where: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR') {
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          item !== null && typeof item === 'object' && !Array.isArray(item)
            ? parseUnknownWhere(item as Record<string, unknown>)
            : item
        );
      } else {
        result[key] = value;
      }
      continue;
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      result[key] = value;
      continue;
    }

    const valueObject = value as Record<string, unknown>;
    if (isFilterConditionObject(valueObject)) {
      result[key] = parseUnknownFilterCondition(valueObject);
      continue;
    }

    result[key] = parseUnknownWhere(valueObject);
  }

  return result;
}

function parseWhereBySchema(
  where: Record<string, unknown>,
  filterSchema: SchemaNode
): Record<string, unknown> {
  const entries = getObjectSchemaEntries(filterSchema);
  if (!entries) {
    return parseUnknownWhere(where);
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR') {
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          item !== null && typeof item === 'object' && !Array.isArray(item)
            ? parseWhereBySchema(item as Record<string, unknown>, filterSchema)
            : item
        );
      } else {
        result[key] = value;
      }
      continue;
    }

    const fieldSchema = entries[key];
    if (!fieldSchema) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = parseUnknownWhere(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
      continue;
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      result[key] = value;
      continue;
    }

    const valueObject = value as Record<string, unknown>;
    const kind = getFilterSchemaKind(fieldSchema);

    if (kind) {
      result[key] = parseTypedFilterCondition(valueObject, kind);
      continue;
    }

    if (isRelationFilterSchema(fieldSchema)) {
      const relationEntries = getObjectSchemaEntries(fieldSchema);
      const nestedFilterSchema = relationEntries?.is ?? relationEntries?.isNot;
      const parsedRelation: Record<string, unknown> = {};

      for (const relKey of RELATION_WRAPPER_KEYS) {
        const nestedValue = valueObject[relKey];
        if (
          nestedFilterSchema &&
          nestedValue !== null &&
          typeof nestedValue === 'object' &&
          !Array.isArray(nestedValue)
        ) {
          parsedRelation[relKey] = parseWhereBySchema(
            nestedValue as Record<string, unknown>,
            nestedFilterSchema
          );
        } else if (relKey in valueObject) {
          parsedRelation[relKey] = nestedValue;
        }
      }

      for (const [relKey, nestedValue] of Object.entries(valueObject)) {
        if (!(relKey in parsedRelation)) {
          parsedRelation[relKey] = nestedValue;
        }
      }

      result[key] = parsedRelation;
      continue;
    }

    if (getObjectSchemaEntries(fieldSchema)) {
      result[key] = parseWhereBySchema(valueObject, fieldSchema);
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * Parse filter values in a Prisma `where` clause using the list-query filter schema.
 *
 * Query params are parsed earlier via `parseFilterValue`; this pass handles typed fields
 * (dates, numbers, booleans) after user filters are merged with scope conditions.
 */
export function parseWhereFilterValues(
  where: Record<string, unknown>,
  filterSchema: SchemaNode
): Record<string, unknown> {
  return parseWhereBySchema(where, filterSchema);
}
