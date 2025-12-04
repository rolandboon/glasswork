import type { MiddlewareHandler } from 'hono';
import type { RLSMiddlewareOptions, TenantContext } from './types.js';
import { assertTenantContext, isTenantContext } from './utils.js';

function defaultExtractor(context: Parameters<MiddlewareHandler>[0]): TenantContext | undefined {
  const auth = context.get('auth');
  if (isTenantContext(auth)) {
    return auth;
  }

  return undefined;
}

/**
 * Hono middleware that extracts tenant context and stores it for DI.
 */
export function rlsMiddleware(options: RLSMiddlewareOptions = {}): MiddlewareHandler {
  const {
    contextKey = 'tenantContext',
    extractTenant = defaultExtractor,
    allowUnauthenticated = true,
  } = options;

  return async (context, next) => {
    const existing = context.get(contextKey);
    if (existing) {
      return next();
    }

    const tenantContext = await Promise.resolve(extractTenant(context));

    if (!tenantContext) {
      if (allowUnauthenticated) {
        return next();
      }
      throw new Error('Tenant context is required but was not found');
    }

    const validated = assertTenantContext(tenantContext, contextKey);
    context.set(contextKey, validated);
    return next();
  };
}
