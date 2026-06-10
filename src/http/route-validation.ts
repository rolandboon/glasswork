import type { Context, MiddlewareHandler } from 'hono';
import { validator } from 'hono-openapi';
import type { ValibotSchema } from './route-types.js';

/**
 * Detect if a query schema includes pagination fields (page, pageSize).
 */
export function hasPaginationFields(schema: ValibotSchema | undefined): boolean {
  if (!schema) return false;

  const schemaAny = schema as { entries?: Record<string, unknown> };
  if (schemaAny.entries) {
    return 'page' in schemaAny.entries || 'pageSize' in schemaAny.entries;
  }

  return false;
}

/**
 * Create a validation middleware for request validation (422 on failure).
 */
export function createValidationMiddleware(
  type: 'json' | 'form' | 'query' | 'param',
  schema: ValibotSchema
): MiddlewareHandler {
  return validator(type, schema, (result: { success: boolean; error?: unknown }, c: Context) => {
    if (!result.success) {
      return c.json({ error: 'Validation failed', issues: result.error }, 422);
    }
  });
}
