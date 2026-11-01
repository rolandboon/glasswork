import type { MiddlewareHandler } from 'hono';

/** The shape `createAuthMiddleware` returns, without its ability-specific types. */
export type AuthMiddlewareFactory = () => MiddlewareHandler;
