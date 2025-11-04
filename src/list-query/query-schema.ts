import { object, optional, pipe, string, transform } from 'valibot';

/**
 * Valibot schema for list query parameters
 * Used in route definitions for OpenAPI generation and basic validation
 *
 * Note: Query parameters are always strings, so we transform them to numbers
 * Valibot correctly infers the output type as number after transformation
 */
export const ListQuerySchema = object({
  sorts: optional(string()),
  filters: optional(string()),
  page: optional(
    pipe(
      string(),
      transform((value) => Math.max(1, Math.floor(Number(value))))
    )
  ),
  pageSize: optional(
    pipe(
      string(),
      transform((value) => Math.max(1, Math.min(100, Math.floor(Number(value)))))
    )
  ),
  search: optional(string()),
});
