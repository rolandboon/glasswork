import type { Hono } from 'hono';
import type { RouteConfigExtensions, RouteHandlers } from './types.js';

/**
 * Minimal route config accepted by {@link RouteFactory}'s bound `route` argument.
 * Call sites typically pass {@link BoundRouteFunction} from `glasswork/http`.
 */
export type RouteConfigInput = RouteConfigExtensions & Record<string, unknown>;

/** Pre-bound `route()` helper passed into route factories. */
export type RouteBinder = (config: RouteConfigInput) => RouteHandlers;

/**
 * Route factory function that receives Hono router, services, and optionally a bound route function.
 *
 * The `route` parameter is a pre-bound route function that knows about the router's
 * OpenAPI context, so you don't need to pass the router to every route call.
 *
 * When using `createRoutes`, the route function is automatically provided.
 * When using `defineModule` with inline routes, the route function is also provided.
 */
export type RouteFactory = (
  router: Hono,
  services: Record<string, unknown>,
  route?: RouteBinder
) => void;
