import {
  check,
  exactOptional,
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
  sorts: exactOptional(pipe(string(), maxLength(100))),
  filters: exactOptional(pipe(string(), maxLength(1_000))),
  page: exactOptional(positiveIntegerQuery(1_000_000)),
  pageSize: exactOptional(positiveIntegerQuery(100)),
  search: exactOptional(pipe(string(), maxLength(255))),
});
