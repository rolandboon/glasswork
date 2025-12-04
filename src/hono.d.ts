/**
 * Augment Hono's context with Glasswork-specific variables.
 */
import type { PureAbility } from '@casl/ability';
import type { AuthSession, AuthUser } from './auth/types.js';
import type { OpenAPIResponseHook } from './types.js';

export type Session = AuthSession;

declare module 'hono' {
  interface ContextVariableMap {
    session?: AuthSession;
    user?: AuthUser | null;
    ability?: PureAbility;
    isAuthenticated?: boolean;
    openapiResponseHooks?: OpenAPIResponseHook[];
  }
}
