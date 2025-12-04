/**
 * Augment Hono's context with Glasswork-specific variables
 */
import type { TenantContext } from './rls/types.js';
import type { OpenAPIResponseHook } from './types.js';

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}

declare module 'hono' {
  interface ContextVariableMap {
    session?: Session;
    openapiResponseHooks?: OpenAPIResponseHook[];
    tenantContext?: TenantContext;
  }
}
