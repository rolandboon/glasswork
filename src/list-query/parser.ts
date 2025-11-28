import type {
  FieldPath,
  FilterOperator,
  ParsedFilter,
  ParsedQueryParams,
  ParsedSort,
  RawQueryParams,
} from './types.js';

/**
 * Parse a field path string (e.g., 'organization.name') into a FieldPath array
 */
function parseFieldPath(fieldPathString: string): FieldPath {
  return fieldPathString.split('.') as FieldPath;
}

/**
 * Parse a sort string into a ParsedSort
 * Format: field (ascending) or -field (descending)
 * Supports nested fields: organization.name or -organization.name
 */
function parseSort(sortString: string): ParsedSort {
  const trimmed = sortString.trim();
  if (trimmed.startsWith('-')) {
    const fieldPath = parseFieldPath(trimmed.slice(1));
    return {
      fieldPath,
      direction: 'desc',
    };
  }
  const fieldPath = parseFieldPath(trimmed);
  return {
    fieldPath,
    direction: 'asc',
  };
}

/**
 * Parse sorts string into array of ParsedSort
 * Format: field1,-field2,field3
 */
export function parseSorts(sortsString?: string): readonly ParsedSort[] {
  if (!sortsString || sortsString.trim() === '') {
    return [];
  }
  return sortsString.split(',').map((s) => parseSort(s.trim()));
}

/**
 * Sieve operator patterns (longest first to avoid partial matches)
 * Order matters: check longer operators before shorter ones
 */
const OPERATOR_PATTERNS: readonly FilterOperator[] = [
  '!@=|*',
  '!_-=*',
  '!@=|',
  '!_-=',
  '!_=*',
  '!_=',
  '!@=*',
  '!@=',
  '@=|*',
  '_-=*',
  '_-=',
  '_=*',
  '_=',
  '@=|',
  '@=*',
  '@=',
  '==*',
  '!=*',
  '>=',
  '<=',
  '==',
  '!=',
  '>',
  '<',
] as const;

/**
 * Find the operator in a filter string
 * Returns the operator and its index
 */
function findOperator(filterString: string): { operator: FilterOperator; index: number } | null {
  for (const operator of OPERATOR_PATTERNS) {
    const index = filterString.indexOf(operator);
    if (index > 0) {
      return { operator, index };
    }
  }
  return null;
}

/**
 * Unescape a value string
 * Handles: \, (comma), \| (pipe), \null (literal null string)
 */
function unescapeValue(value: string): string {
  return value
    .replace(/\\,/g, ',')
    .replace(/\\\|/g, '|')
    .replace(/\\null/g, 'null');
}

/**
 * Parse a filter string into a ParsedFilter
 * Format: field{operator}value
 * Example: name@=value, organization.name==Acme
 */
function parseFilter(filterString: string): ParsedFilter {
  const trimmed = filterString.trim();
  const operatorMatch = findOperator(trimmed);
  if (!operatorMatch) {
    throw new Error(`Invalid filter format: ${trimmed}. Missing operator.`);
  }
  const { operator, index } = operatorMatch;
  const fieldPathString = trimmed.slice(0, index).trim();
  const valueString = trimmed.slice(index + operator.length).trim();
  if (!fieldPathString || !valueString) {
    throw new Error(`Invalid filter format: ${trimmed}. Missing field or value.`);
  }
  const fieldPath = parseFieldPath(fieldPathString);
  const value = unescapeValue(valueString);
  return {
    fieldPath,
    operator,
    value,
  };
}

/**
 * Parse filters string into array of ParsedFilter
 * Format: field1==value1,field2@=value2
 * Handles escaped commas in values (e.g., field@=value\,with\,commas)
 */
export function parseFilters(filtersString?: string): readonly ParsedFilter[] {
  if (!filtersString || filtersString.trim() === '') {
    return [];
  }
  const filters: string[] = [];
  let current = '';
  let escaped = false;
  for (let i = 0; i < filtersString.length; i++) {
    const char = filtersString[i];
    if (char === '\\' && !escaped) {
      escaped = true;
      current += char;
    } else if (char === ',' && !escaped) {
      if (current.trim()) {
        filters.push(current.trim());
      }
      current = '';
    } else {
      current += char;
      escaped = false;
    }
  }
  if (current.trim()) {
    filters.push(current.trim());
  }
  return filters.map((f) => parseFilter(f));
}

/**
 * Parse raw query parameters into structured ParsedQueryParams
 */
export function parseQueryParams(raw: RawQueryParams): ParsedQueryParams {
  const sorts = parseSorts(raw.sorts);
  const filters = parseFilters(raw.filters);
  const page = raw.page && raw.page > 0 ? raw.page : 1;
  const pageSize = raw.pageSize && raw.pageSize > 0 ? Math.min(raw.pageSize, 100) : 10;
  const search = raw.search?.trim() || undefined;
  return {
    sorts,
    filters,
    page,
    pageSize,
    search,
  };
}
