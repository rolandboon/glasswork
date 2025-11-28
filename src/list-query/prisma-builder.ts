import type {
  FieldPath,
  FilterOperator,
  ParsedFilter,
  ParsedQueryParams,
  ParsedSort,
} from './types.js';

/**
 * Build condition for equality operators
 */
function buildEqualityCondition(
  operator: '==' | '!=',
  value: string | number | boolean,
  isCaseInsensitive: boolean
): Record<string, unknown> {
  if (operator === '==') {
    if (isCaseInsensitive && typeof value === 'string') {
      return { equals: value, mode: 'insensitive' };
    }
    return { equals: value };
  }
  if (isCaseInsensitive && typeof value === 'string') {
    return { not: { equals: value, mode: 'insensitive' } };
  }
  return { not: value };
}

/**
 * Build condition for comparison operators
 */
function buildComparisonCondition(
  operator: '>' | '<' | '>=' | '<=',
  value: string | number | boolean
): Record<string, unknown> {
  switch (operator) {
    case '>':
      return { gt: value };
    case '<':
      return { lt: value };
    case '>=':
      return { gte: value };
    case '<=':
      return { lte: value };
  }
}

/**
 * Build condition for string matching operators
 */
function buildStringCondition(
  operator: '@=' | '_=' | '_-=' | '!@=' | '!_=' | '!_-=',
  value: string | number | boolean,
  isCaseInsensitive: boolean
): Record<string, unknown> {
  if (typeof value !== 'string') {
    throw new Error(`String operator ${operator} requires string value`);
  }
  const baseCondition: Record<string, unknown> = isCaseInsensitive ? { mode: 'insensitive' } : {};
  switch (operator) {
    case '@=':
      return { contains: value, ...baseCondition };
    case '_=':
      return { startsWith: value, ...baseCondition };
    case '_-=':
      return { endsWith: value, ...baseCondition };
    case '!@=':
      return { not: { contains: value, ...baseCondition } };
    case '!_=':
      return { not: { startsWith: value, ...baseCondition } };
    case '!_-=':
      return { not: { endsWith: value, ...baseCondition } };
  }
}

/**
 * Build condition for IN operators
 * Splits pipe-separated values and creates Prisma in/notIn conditions
 */
function buildInCondition(
  operator: '@=|' | '!@=|',
  value: string,
  isCaseInsensitive: boolean
): Record<string, unknown> {
  // Split by pipe and parse each value
  const values = value.split('|').map((v) => parseValue(v.trim()));

  // Check if all values are strings for case-insensitive mode
  const allStrings = values.every((v) => typeof v === 'string');

  if (operator === '@=|') {
    if (isCaseInsensitive && allStrings) {
      return { in: values, mode: 'insensitive' };
    }
    return { in: values };
  }

  // !@=| - NOT IN
  if (isCaseInsensitive && allStrings) {
    return { notIn: values, mode: 'insensitive' };
  }
  return { notIn: values };
}

/**
 * Convert a Sieve operator to Prisma where clause condition
 */
function operatorToPrismaCondition(
  operator: FilterOperator,
  value: string | number | boolean
): Record<string, unknown> {
  const isCaseInsensitive = operator.endsWith('*');
  const baseOperator = operator.replace(/\*$/, '') as FilterOperator;

  // Handle IN operators
  if (baseOperator === '@=|' || baseOperator === '!@=|') {
    if (typeof value !== 'string') {
      throw new Error(`IN operator ${operator} requires string value with pipe-separated items`);
    }
    return buildInCondition(baseOperator, value, isCaseInsensitive);
  }

  if (baseOperator === '==' || baseOperator === '!=') {
    return buildEqualityCondition(baseOperator, value, isCaseInsensitive);
  }
  if (
    baseOperator === '>' ||
    baseOperator === '<' ||
    baseOperator === '>=' ||
    baseOperator === '<='
  ) {
    return buildComparisonCondition(baseOperator, value);
  }
  if (
    baseOperator === '@=' ||
    baseOperator === '_=' ||
    baseOperator === '_-=' ||
    baseOperator === '!@=' ||
    baseOperator === '!_=' ||
    baseOperator === '!_-='
  ) {
    return buildStringCondition(baseOperator, value, isCaseInsensitive);
  }
  throw new Error(`Unsupported operator: ${operator}`);
}

/**
 * Convert a value string to appropriate type for Prisma
 * Attempts to parse as number or boolean, otherwise returns as string
 */
function parseValue(value: string): string | number | boolean {
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

/**
 * Build a nested Prisma where condition from a field path
 * For nested paths (relations), wraps in Prisma's relation filter structure { is: { ... } }
 */
function buildNestedWhereCondition(
  fieldPath: FieldPath,
  condition: Record<string, unknown>
): Record<string, unknown> {
  if (fieldPath.length === 1) {
    const field = fieldPath[0];
    if (!field) {
      throw new Error('Field path cannot be empty');
    }
    return {
      [field]: condition,
    };
  }

  // For nested paths (relations), build the nested structure and wrap in { is: { ... } }
  const [first, ...rest] = fieldPath;
  if (!first) {
    throw new Error('Field path cannot be empty');
  }

  // Build the deeply nested condition recursively
  let nestedCondition: Record<string, unknown> = condition;
  for (let i = rest.length - 1; i >= 0; i--) {
    const field = rest[i];
    if (!field) {
      throw new Error('Field path cannot be empty');
    }
    nestedCondition = {
      [field]: nestedCondition,
    };
  }

  // Wrap in Prisma's relation filter structure
  return {
    [first]: {
      is: nestedCondition,
    },
  };
}

/**
 * Merge two Prisma where conditions, handling nested objects
 */
function mergeWhereConditions(
  existing: Record<string, unknown>,
  newCondition: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(newCondition)) {
    if (key in merged && typeof merged[key] === 'object' && typeof value === 'object') {
      const existingValue = merged[key];
      if (existingValue !== null && !Array.isArray(existingValue) && !Array.isArray(value)) {
        merged[key] = mergeWhereConditions(
          existingValue as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else {
        merged[key] = value;
      }
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Build Prisma where clause from parsed filters
 * Handles nested fields and merges multiple conditions on same relation
 */
export function buildWhereClause(filters: readonly ParsedFilter[]): Record<string, unknown> {
  if (filters.length === 0) {
    return {};
  }
  let where: Record<string, unknown> = {};
  for (const filter of filters) {
    // For IN operators, keep the value as string (pipe-separated)
    // The buildInCondition function will split and parse individual values
    const isInOperator = filter.operator.includes('|');
    const parsedValue = isInOperator ? filter.value : parseValue(filter.value);
    const condition = operatorToPrismaCondition(filter.operator, parsedValue);
    const nestedCondition = buildNestedWhereCondition(filter.fieldPath, condition);
    where = mergeWhereConditions(where, nestedCondition);
  }
  return where;
}

/**
 * Build Prisma orderBy clause from parsed sorts
 * Handles nested fields (relations) properly
 */
export function buildOrderBy(sorts: readonly ParsedSort[]): readonly Record<string, unknown>[] {
  if (sorts.length === 0) {
    return [];
  }
  return sorts.map((sort) => {
    if (sort.fieldPath.length === 1) {
      const field = sort.fieldPath[0];
      if (!field) {
        throw new Error('Field path cannot be empty');
      }
      return {
        [field]: sort.direction,
      };
    }

    // For nested paths, build the structure directly (Prisma doesn't need 'is' for sorting)
    const orderBy: Record<string, unknown> = {};
    let current = orderBy;
    for (let i = 0; i < sort.fieldPath.length - 1; i++) {
      const field = sort.fieldPath[i];
      if (!field) {
        throw new Error('Field path cannot be empty');
      }
      const next: Record<string, unknown> = {};
      current[field] = next;
      current = next;
    }
    const lastField = sort.fieldPath[sort.fieldPath.length - 1];
    if (!lastField) {
      throw new Error('Field path cannot be empty');
    }
    current[lastField] = sort.direction;
    return orderBy;
  });
}

/**
 * Build Prisma query parameters from parsed query params
 */
export function buildPrismaParams(params: ParsedQueryParams): {
  where: Record<string, unknown>;
  orderBy: readonly Record<string, unknown>[];
  skip: number;
  take: number;
} {
  const where = buildWhereClause(params.filters);
  const orderBy = buildOrderBy(params.sorts);
  const skip = (params.page - 1) * params.pageSize;
  const take = params.pageSize;
  return {
    where,
    orderBy,
    skip,
    take,
  };
}
