import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { InferOutput } from 'valibot';
import type { RouteFactory, RouteHandlers } from '../core/types.js';
import { enforceRouteAuthorization } from './route-authorization.js';
import { buildRouteContext } from './route-context.js';
import { buildOpenAPIMiddleware } from './route-openapi.js';
import { getOpenAPIContext } from './route-openapi-context.js';
import { handleResponse } from './route-response.js';
import type {
  BoundRouteFunction,
  RouteConfig,
  RouteContext,
  STATUS_DESCRIPTIONS,
  ValibotSchema,
} from './route-types.js';
import { createValidationMiddleware, hasPaginationFields } from './route-validation.js';

export type { OpenAPIContext } from './route-openapi-context.js';
export { getOpenAPIContext, setOpenAPIContext } from './route-openapi-context.js';
export type {
  BoundRouteFunction,
  RouteConfig,
  RouteContext,
  RouteFactory,
  RouteOpenAPIOptions,
  ValibotSchema,
} from './route-types.js';

/**
 * Create routes with typed service injection and pre-bound route function.
 */
export function createRoutes<TServices = Record<string, unknown>>(
  factory: (router: Hono, services: TServices, route: BoundRouteFunction) => void
): RouteFactory {
  return (router: Hono, services: Record<string, unknown>) => {
    const boundRoute: BoundRouteFunction = (config) => route(router, config);
    factory(router, services as TServices, boundRoute);
  };
}

type InferSchemaType<T> = T extends ValibotSchema ? InferOutput<T> : never;

/**
 * Create a route handler with validation and OpenAPI metadata.
 */
export function route<
  TBody extends ValibotSchema | undefined = undefined,
  TQuery extends ValibotSchema | undefined = undefined,
  TParams extends ValibotSchema | undefined = undefined,
  TResponses extends Partial<
    Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>
  > = Record<never, never>,
  TPublic extends boolean = false,
  TStrictTypes extends boolean = false,
>(
  router: Hono,
  config: RouteConfig<TBody, TQuery, TParams, TResponses, TPublic, TStrictTypes>
): RouteHandlers {
  const middlewares: MiddlewareHandler[] = [];
  const openAPIContext = getOpenAPIContext(router);
  const hasPagination = hasPaginationFields(config.query);

  if (!config.openapi?.exclude) {
    middlewares.push(buildOpenAPIMiddleware(config, openAPIContext, hasPagination));
  }

  if (config.middleware) {
    middlewares.push(...config.middleware);
  }

  if (config.body) {
    middlewares.push(createValidationMiddleware(config.bodyType || 'json', config.body));
  }
  if (config.query) {
    middlewares.push(createValidationMiddleware('query', config.query));
  }
  if (config.params) {
    middlewares.push(createValidationMiddleware('param', config.params));
  }

  middlewares.push(async (c: Context) => {
    const routeContext = buildRouteContext(c, config, openAPIContext);
    if (config.authorize) {
      enforceRouteAuthorization(config.authorize, routeContext);
    }
    const result = await config.handler(
      routeContext as RouteContext<
        TBody extends ValibotSchema ? InferSchemaType<TBody> : never,
        TQuery extends ValibotSchema ? InferSchemaType<TQuery> : Record<string, string>,
        TParams extends ValibotSchema ? InferSchemaType<TParams> : Record<string, string>,
        TPublic extends true ? false : true
      >
    );

    return handleResponse(
      result,
      config.responses,
      config.serialization,
      config.strictTypes,
      config.summary,
      c
    );
  });

  return middlewares as RouteHandlers;
}
