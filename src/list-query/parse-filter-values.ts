import { type BaseIssue, type BaseSchema, object, optional, parse } from 'valibot';
import { parseFilterLiteral, unknownComparisonValueSchema } from './filter-value-schemas.js';
import { FILTER_SCHEMA_KIND } from './schema-helpers.js';
import type { FilterOperator } from './types.js';

const FILTER_OPERATORS = ['equals', 'not', 'lt', 'lte', 'gt', 'gte', 'in', 'notIn'] as const;
const COMPARISON_OPERATORS = ['lt', 'lte', 'gt', 'gte'] as const;
const RELATION_WRAPPER_KEYS = ['is', 'isNot', 'some', 'none', 'every'] as const;
const LOGICAL_OPERATORS = new Set(['AND', 'OR']);

type SchemaNode = BaseSchema<unknown, unknown, BaseIssue<unknown>>;
type WhereRecord = Record<string, unknown>;
type WhereParser = (where: WhereRecord) => WhereRecord;

export type FilterScalar = string | number | boolean | Date;

export { parseFilterLiteral } from './filter-value-schemas.js';

const unknownComparisonFilterSchema = object({
  gt: optional(unknownComparisonValueSchema()),
  gte: optional(unknownComparisonValueSchema()),
  lt: optional(unknownComparisonValueSchema()),
  lte: optional(unknownComparisonValueSchema()),
});

/**
 * Parse a filter value for `operator` before building Prisma conditions from query params.
 *
 * Substring and IN operators keep the raw string; equality and comparison operators
 * delegate to `parseFilterLiteral`.
 */
export function parseFilterValue(
  value: string,
  operator: FilterOperator
): string | number | boolean {
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

function isWhereRecord(value: unknown): value is WhereRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unwrapSchema(schema: unknown): SchemaNode {
  let current = schema as SchemaNode;
  while (
    current !== null &&
    typeof current === 'object' &&
    'type' in current &&
    (current.type === 'optional' || current.type === 'nullable') &&
    'wrapped' in current
  ) {
    current = current.wrapped as SchemaNode;
  }
  return current;
}

function isTypedFilterSchema(schema: unknown): boolean {
  const unwrapped = unwrapSchema(schema);
  return typeof unwrapped === 'object' && unwrapped !== null && FILTER_SCHEMA_KIND in unwrapped;
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

function isFilterConditionObject(value: WhereRecord): boolean {
  return FILTER_OPERATORS.some((operator) => operator in value);
}

function parseLogicalConditions(value: unknown, parseItem: WhereParser): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((item) => (isWhereRecord(item) ? parseItem(item) : item));
}

function parseTypedFieldValue(fieldSchema: SchemaNode, valueObject: WhereRecord): WhereRecord {
  return parse(fieldSchema, valueObject) as WhereRecord;
}

function parseUnknownFilterCondition(value: WhereRecord): WhereRecord {
  const comparisonOnly: WhereRecord = {};
  for (const operator of COMPARISON_OPERATORS) {
    if (operator in value) {
      comparisonOnly[operator] = value[operator];
    }
  }

  if (Object.keys(comparisonOnly).length === 0) {
    return value;
  }

  const parsedComparisons = parse(unknownComparisonFilterSchema, comparisonOnly) as WhereRecord;
  return { ...value, ...parsedComparisons };
}

function parseUnknownWhereEntry(key: string, value: unknown): unknown {
  if (LOGICAL_OPERATORS.has(key)) {
    return parseLogicalConditions(value, parseUnknownWhere);
  }
  if (!isWhereRecord(value)) {
    return value;
  }
  if (isFilterConditionObject(value)) {
    return parseUnknownFilterCondition(value);
  }
  return parseUnknownWhere(value);
}

function parseUnknownWhere(where: WhereRecord): WhereRecord {
  const result: WhereRecord = {};
  for (const [key, value] of Object.entries(where)) {
    result[key] = parseUnknownWhereEntry(key, value);
  }
  return result;
}

function parseRelationFilterValue(valueObject: WhereRecord, fieldSchema: SchemaNode): WhereRecord {
  const relationEntries = getObjectSchemaEntries(fieldSchema);
  const nestedFilterSchema = relationEntries?.is ?? relationEntries?.isNot;
  const parsedRelation: WhereRecord = {};

  for (const relKey of RELATION_WRAPPER_KEYS) {
    const nestedValue = valueObject[relKey];
    if (nestedFilterSchema && isWhereRecord(nestedValue)) {
      parsedRelation[relKey] = parseWhereBySchema(nestedValue, nestedFilterSchema);
    } else if (relKey in valueObject) {
      parsedRelation[relKey] = nestedValue;
    }
  }

  for (const [relKey, nestedValue] of Object.entries(valueObject)) {
    if (!(relKey in parsedRelation)) {
      parsedRelation[relKey] = nestedValue;
    }
  }

  return parsedRelation;
}

function parseKnownFieldValue(valueObject: WhereRecord, fieldSchema: SchemaNode): WhereRecord {
  if (isTypedFilterSchema(fieldSchema)) {
    return parseTypedFieldValue(fieldSchema, valueObject);
  }
  if (isRelationFilterSchema(fieldSchema)) {
    return parseRelationFilterValue(valueObject, fieldSchema);
  }
  if (getObjectSchemaEntries(fieldSchema)) {
    return parseWhereBySchema(valueObject, fieldSchema);
  }
  return valueObject;
}

function parseSchemaWhereEntry(
  key: string,
  value: unknown,
  fieldSchema: SchemaNode | undefined,
  filterSchema: SchemaNode
): unknown {
  if (LOGICAL_OPERATORS.has(key)) {
    return parseLogicalConditions(value, (item) => parseWhereBySchema(item, filterSchema));
  }
  if (!fieldSchema) {
    return isWhereRecord(value) ? parseUnknownWhere(value) : value;
  }
  if (!isWhereRecord(value)) {
    return value;
  }
  return parseKnownFieldValue(value, fieldSchema);
}

function parseWhereBySchema(where: WhereRecord, filterSchema: SchemaNode): WhereRecord {
  const entries = getObjectSchemaEntries(filterSchema);
  if (!entries) {
    return parseUnknownWhere(where);
  }

  const result: WhereRecord = {};
  for (const [key, value] of Object.entries(where)) {
    result[key] = parseSchemaWhereEntry(key, value, entries[key], filterSchema);
  }
  return result;
}

/**
 * Parse filter values in a Prisma `where` clause using the list-query filter schema.
 *
 * Query params are parsed earlier via `parseFilterValue`; this pass applies Valibot
 * transforms on typed filter fields after user filters are merged with scope conditions.
 */
export function parseWhereFilterValues(where: WhereRecord, filterSchema: SchemaNode): WhereRecord {
  return parseWhereBySchema(where, filterSchema);
}
