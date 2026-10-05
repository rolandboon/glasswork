import {
  check,
  exactOptional,
  type InferOutput,
  integer,
  maxLength,
  maxValue,
  minValue,
  pipe,
  regex,
  strictObject,
  string,
  transform,
} from 'valibot';
import { LIST_QUERY_LIMITS } from './protocol.js';

/**
 * Strict, bounded HTTP contract for list-query parameters.
 * Field, operator, and value validation happens against the configured
 * filter and sort schemas when the list query is built.
 */
const positiveIntegerQuery = (maximum: number) =>
  pipe(
    string(),
    regex(/^[1-9]\d*$/),
    check((value) => value.length <= 10, 'Expected at most 10 digits'),
    transform(Number),
    integer(),
    minValue(1),
    maxValue(maximum)
  );

export const ListQuerySchema = strictObject({
  sorts: exactOptional(pipe(string(), maxLength(LIST_QUERY_LIMITS.sorts))),
  filters: exactOptional(pipe(string(), maxLength(LIST_QUERY_LIMITS.filters))),
  page: exactOptional(positiveIntegerQuery(LIST_QUERY_LIMITS.page)),
  pageSize: exactOptional(positiveIntegerQuery(LIST_QUERY_LIMITS.pageSize)),
  search: exactOptional(pipe(string(), maxLength(LIST_QUERY_LIMITS.search))),
});

export type ListQueryParams = InferOutput<typeof ListQuerySchema>;
