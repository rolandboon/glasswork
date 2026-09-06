import type { Context, MiddlewareHandler } from 'hono';
import { runWithTenant } from './context.js';
import {
  MissingTenantContextException,
  type RLSMiddlewareOptions,
  type TenantContext,
} from './types.js';

/**
 * Default tenant extractor that checks for `tenantId` in `c.get('user')` or `c.get('auth')`.
 */
function defaultTenantExtractor(c: Context): TenantContext | undefined {
  const user = c.get('user') as Record<string, unknown> | undefined;
  if (user && typeof user.tenantId === 'string' && user.tenantId.length > 0) {
    return {
      tenantId: user.tenantId,
      userId: typeof user.id === 'string' ? user.id : undefined,
      role: typeof user.role === 'string' ? user.role : undefined,
    };
  }

  const auth = c.get('auth') as Record<string, unknown> | undefined;
  if (auth && typeof auth.tenantId === 'string' && auth.tenantId.length > 0) {
    return {
      tenantId: auth.tenantId,
      userId: typeof auth.userId === 'string' ? auth.userId : undefined,
      role: typeof auth.role === 'string' ? auth.role : undefined,
    };
  }

  return undefined;
}

/**
 * Create Hono middleware that resolves the active TenantContext and binds it to AsyncLocalStorage.
 *
 * @param options - Configuration options for tenant extraction and unauthenticated behavior.
 * @returns Hono middleware handler.
 *
 * @example
 * ```typescript
 * app.use('*', createRLSMiddleware({
 *   allowUnauthenticated: true,
 * }));
 * ```
 */
export function createRLSMiddleware(options: RLSMiddlewareOptions = {}): MiddlewareHandler {
  const { extractTenant = defaultTenantExtractor, allowUnauthenticated = true } = options;

  return async (c, next) => {
    const context = await Promise.resolve(extractTenant(c));

    if (!context?.tenantId) {
      if (allowUnauthenticated) {
        return runWithTenant(undefined, () => next());
      }
      throw new MissingTenantContextException();
    }

    return runWithTenant(context, () => next());
  };
}
