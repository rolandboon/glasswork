import {
  escapeFilterValue,
  FILTER_OPERATORS,
  type FilterOperator,
  LIST_QUERY_LIMITS,
} from './protocol.js';

export type { FilterOperator } from './protocol.js';

export interface ListQueryState<TPageSize extends number = number> {
  page: number;
  pageSize: TPageSize;
  sorts: string;
  filters: string;
  search: string;
}

export interface ListQueryDefaults<TPageSize extends number = number> {
  sorts: string;
  pageSize?: TPageSize | undefined;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  sorts: string;
  filters?: string;
  search?: string;
}

const keys = new Set(['page', 'pageSize', 'sorts', 'filters', 'search']);

/** Browser-safe protocol codec. The application supplies its allowed page sizes. */
export function createListQueryClient<const TPageSize extends number>(options: {
  pageSizes: readonly TPageSize[];
  defaultPageSize: NoInfer<TPageSize>;
}) {
  if (
    !options.pageSizes.includes(options.defaultPageSize) ||
    options.pageSizes.some(
      (size) => !Number.isSafeInteger(size) || size < 1 || size > LIST_QUERY_LIMITS.pageSize
    )
  ) {
    throw new Error('Page sizes must be positive integers within the list-query contract');
  }
  const defaultSize = (defaults: ListQueryDefaults<TPageSize>) =>
    defaults.pageSize ?? options.defaultPageSize;
  const read = (
    params: URLSearchParams,
    defaults: ListQueryDefaults<TPageSize>
  ): ListQueryState<TPageSize> => {
    const page = Number(params.get('page') ?? 1);
    const pageSize = Number(params.get('pageSize') ?? defaultSize(defaults));
    const sorts = params.get('sorts') || defaults.sorts;
    const filters = params.get('filters') ?? '';
    return {
      page: Number.isSafeInteger(page) && page >= 1 && page <= LIST_QUERY_LIMITS.page ? page : 1,
      pageSize: options.pageSizes.find((size) => size === pageSize) ?? defaultSize(defaults),
      sorts: sorts.length <= LIST_QUERY_LIMITS.sorts ? sorts : defaults.sorts,
      filters: filters.length <= LIST_QUERY_LIMITS.filters ? filters : '',
      search: (params.get('search') ?? '').slice(0, LIST_QUERY_LIMITS.search),
    };
  };
  const update = (
    params: URLSearchParams,
    patch: Partial<ListQueryState<TPageSize>>,
    defaults: ListQueryDefaults<TPageSize>
  ): URLSearchParams => {
    const state = { ...read(params, defaults), ...patch };
    if (patch.page === undefined) state.page = 1;
    const next = new URLSearchParams(params);
    for (const key of keys) next.delete(key);
    if (state.page !== 1) next.set('page', String(state.page));
    if (state.pageSize !== defaultSize(defaults)) next.set('pageSize', String(state.pageSize));
    if (state.sorts !== defaults.sorts) next.set('sorts', state.sorts);
    if (state.search) next.set('search', state.search);
    if (state.filters) next.set('filters', state.filters);
    return next;
  };
  return { read, update, query: listQueryFromState };
}

export function listQueryFromState(state: ListQueryState): ListQuery {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sorts: state.sorts,
    ...(state.search ? { search: state.search } : {}),
    ...(state.filters ? { filters: state.filters } : {}),
  };
}

export function toggleListSort(current: string, field: string): string {
  return current === field ? `-${field}` : field;
}

export function listSearchString(params: URLSearchParams): string {
  return params.size ? `?${params}` : '';
}

export function joinFilters(expressions: readonly string[]): string {
  return expressions.filter((expression) => expression.length > 0).join(',');
}

/** Encodes one Sieve comparison. Field allowlists and semantic mapping stay on the server. */
export function encodeFilter(
  field: string,
  operator: FilterOperator,
  value: string | number | boolean
): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(field) || !FILTER_OPERATORS.includes(operator)) {
    throw new Error('Invalid filter field or operator');
  }
  const text = String(value).trim();
  if (!text) throw new Error('Filter values cannot be empty');
  if (operator.includes('|') && text.includes('|'))
    throw new Error('IN comparisons cannot encode literal pipe values');
  return `${field}${operator}${escapeFilterValue(text)}`;
}
