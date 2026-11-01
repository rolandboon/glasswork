import type { Context, MiddlewareHandler } from 'hono';
import { validator } from 'hono-openapi';
import type { ValidationIssue } from './error-response.dto.js';
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
      return c.json(
        {
          error: 'Validation failed',
          code: 'validation-failed',
          issues: toValidationIssues(result.error),
        },
        422
      );
    }
  });
}

interface SchemaIssue {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

/**
 * Reduce schema issues to `{ message, path }`, as `ValidationIssueDto` documents. Raw issues
 * also hold the received input, which would echo the request body, such as a password,
 * back to the client.
 */
function toValidationIssues(issues: unknown): ValidationIssue[] {
  if (!Array.isArray(issues)) return [];
  return (issues as SchemaIssue[]).map((issue) => ({
    message: issue.message,
    path: (issue.path ?? []).map((segment) => {
      const key = typeof segment === 'object' && segment !== null ? segment.key : segment;
      return typeof key === 'number' ? key : String(key);
    }),
  }));
}
