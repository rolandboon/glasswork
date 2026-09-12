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
  /** Optional user ID (set via setUser or setRequestAuth) */
  userId?: string;
  /** Physical actor user ID (e.g. Superadmin during impersonation, otherwise same as userId) */
  actorUserId?: string;
  /** Effective target user ID when impersonating */
  effectiveUserId?: string;
  /** Whether the request is being executed via user impersonation */
  isImpersonating?: boolean;
  /** Organization or tenant ID associated with the authenticated user/request */
  tenantId?: string;
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
 * import { getRequestContext } from 'glasswork/observability';
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
 * import { getRequestId } from 'glasswork/observability';
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

export interface RequestAuthContext {
  /** Effective user ID (whose permissions and identity apply) */
  userId: string;
  /** Organization or tenant ID associated with the user/request */
  tenantId?: string | null | undefined;
  /** Impersonator user ID if this request is performed via impersonation */
  impersonatedBy?: string | null | undefined;
}

/**
 * Set user information in the current request context.
 * Useful for correlating logs and errors with users after authentication.
 *
 * @param userId - User identifier
 *
 * @example
 * ```typescript
 * import { setRequestUser } from 'glasswork/observability';
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
    store.actorUserId = store.actorUserId ?? userId;
  }
}

/**
 * Set full authentication and actor context for the current request.
 * Automatically resolves whether impersonation is active:
 * - If impersonatedBy is provided: actorUserId is the impersonator, effectiveUserId is the target user, isImpersonating is true.
 * - Otherwise: actorUserId is the user, effectiveUserId is undefined, isImpersonating is false.
 *
 * @param auth - Authentication context including user ID, tenant ID, and optional impersonator ID
 */
export function setRequestAuth(auth: RequestAuthContext): void {
  const store = requestContextStorage.getStore();
  if (store) {
    store.userId = auth.userId;
    if (typeof auth.tenantId === 'string') {
      store.tenantId = auth.tenantId;
    }
    if (auth.impersonatedBy) {
      store.actorUserId = auth.impersonatedBy;
      store.effectiveUserId = auth.userId;
      store.isImpersonating = true;
    } else {
      store.actorUserId = auth.userId;
      store.effectiveUserId = undefined;
      store.isImpersonating = false;
    }
  }
}

/**
 * Get the current actor context for auditing and security correlation.
 * Returns undefined if called outside a request lifecycle.
 */
export function getRequestActor():
  | {
      actorUserId?: string;
      effectiveUserId?: string;
      isImpersonating: boolean;
      tenantId?: string;
    }
  | undefined {
  const store = requestContextStorage.getStore();
  if (!store) return undefined;
  return {
    actorUserId: store.actorUserId ?? store.userId,
    effectiveUserId: store.effectiveUserId,
    isImpersonating: Boolean(store.isImpersonating),
    tenantId: store.tenantId,
  };
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
 * import { setRequestContext } from 'glasswork/observability';
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
