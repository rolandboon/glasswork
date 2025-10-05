import type { Context } from 'hono';

/**
 * Pagination input parameters
 */
export interface PaginationInput {
  page: number;
  limit: number;
}

/**
 * Paginated output structure
 */
export interface PaginatedOutput<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Execute a paginated query and set response headers.
 *
 * This helper extracts pagination parameters from the query string,
 * executes the provided function, and sets the appropriate response headers.
 *
 * @template T - The type of items in the result
 * @param c - Hono context
 * @param fn - Function that executes the paginated query
 * @returns Array of items (headers are set as side effect)
 *
 * @example
 * ```typescript
 * router.get('/users', route({
 *   paginate: true,
 *   handler: async ({ context }) => {
 *     return await paginate(context, (p) => userService.getUsers(p));
 *   }
 * }));
 * ```
 */
export async function paginate<T>(
  c: Context,
  fn: (p: PaginationInput) => Promise<PaginatedOutput<T>>
): Promise<T[]> {
  const pagination = paginationInput(c);
  const result = await fn(pagination);

  c.header('X-Total-Count', result.total.toString());
  c.header('X-Page', result.page.toString());
  c.header('X-Limit', result.limit.toString());

  return result.data;
}

/**
 * Extract pagination parameters from Hono context.
 *
 * @param c - Hono context
 * @param defaultLimit - Default limit if not provided (default: 100)
 * @returns Pagination input with page and limit
 */
export function paginationInput(c: Context, defaultLimit = 100): PaginationInput {
  const page = Number.parseInt(c.req.query('page') ?? '1', 10);
  const limit = Number.parseInt(c.req.query('limit') ?? defaultLimit.toString(), 10);
  return { page, limit };
}
