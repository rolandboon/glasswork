/** Bounds shared by the HTTP schema and browser URL codec. */
export const LIST_QUERY_LIMITS = {
  page: 1_000_000,
  pageSize: 100,
  sorts: 100,
  filters: 1_000,
  search: 255,
} as const;

/** Longest operators first, so the parser cannot match only part of an operator. */
export const FILTER_OPERATORS = [
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
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export function escapeFilterValue(value: string | number | boolean): string {
  return String(value).replace(/[\\,|]/g, '\\$&');
}

export function unescapeFilterValue(value: string): string {
  if (value === '\\null') return 'null';
  return value.replace(/\\([\\,|])/g, '$1');
}
