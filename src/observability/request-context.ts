import { AsyncLocalStorage } from 'node:async_hooks';
import type { MiddlewareHandler } from 'hono';

/**
 * Request context stored in AsyncLocalStorage.
 * Available anywhere in your code during a request lifecycle.
 */
export interface RequestContext {
  /** Unique request identifier for correlation */
  requestId: string;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Optional user ID (set via setUser) */
  userId?: string;
  /** Custom context data */
  custom: Record<string, unknown>;
}

/**
 * AsyncLocalStorage instance for request context.
 * @internal
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context.
 * Returns undefined if called outside a request lifecycle.
 *
 * @returns Current request context or undefined
 *
 * @example
 * ```typescript
 * import { getRequestContext } from 'glasswork';
 *
 * function someUtility() {
 *   const ctx = getRequestContext();
 *   if (ctx) {
 *     console.log('Request ID:', ctx.requestId);
 *   }
 * }
 * ```
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Get the current request ID.
 * Returns undefined if called outside a request lifecycle.
 *
 * This is a convenience function for the common case of just needing the request ID.
 *
 * @returns Current request ID or undefined
 *
 * @example
 * ```typescript
 * import { getRequestId } from 'glasswork';
 *
 * class UserService {
 *   async create(data: CreateUserDto) {
 *     const requestId = getRequestId();
 *     this.logger.info({ requestId, email: data.email }, 'Creating user');
 *     // ...
 *   }
 * }
 * ```
 */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

/**
 * Set user information in the current request context.
 * Useful for correlating logs and errors with users after authentication.
 *
 * @param userId - User identifier
 *
 * @example
 * ```typescript
 * import { setRequestUser } from 'glasswork';
 *
 * // In auth middleware
 * const user = await validateToken(token);
 * setRequestUser(user.id);
 * ```
 */
export function setRequestUser(userId: string): void {
  const store = requestContextStorage.getStore();
  if (store) {
    store.userId = userId;
  }
}

/**
 * Set custom context data for the current request.
 * Useful for adding business-specific context to logs.
 *
 * @param key - Context key
 * @param value - Context value
 *
 * @example
 * ```typescript
 * import { setRequestContext } from 'glasswork';
 *
 * // Add tenant ID for multi-tenant apps
 * setRequestContext('tenantId', tenant.id);
 * ```
 */
export function setRequestContextValue(key: string, value: unknown): void {
  const store = requestContextStorage.getStore();
  if (store) {
    store.custom[key] = value;
  }
}

/**
 * Middleware that initializes AsyncLocalStorage request context.
 * Applied automatically by bootstrap when using the built-in logger.
 *
 * @returns Hono middleware handler
 * @internal
 */
export function createRequestContextMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.get('requestId') || crypto.randomUUID();

    const context: RequestContext = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      custom: {},
    };

    await requestContextStorage.run(context, async () => {
      await next();
    });
  };
}
