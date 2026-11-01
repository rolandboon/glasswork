import type { Context } from 'hono';
import { createContextAwarePinoLogger } from '../observability/pino-logger.js';
import { createSanitizedLogger } from '../observability/sanitizers.js';
import { getClientIp } from '../utils/get-client-ip.js';
import { createLogger, type Logger } from '../utils/logger.js';
import type { OpenAPIContext } from './route-openapi-context.js';
import type {
  InferSchemaType,
  RequiresAuthentication,
  RouteAuthorization,
  RouteConfig,
  RouteContext,
  STATUS_DESCRIPTIONS,
  ValibotSchema,
} from './route-types.js';

type SchemaOutput<TSchema, TFallback> = TSchema extends ValibotSchema
  ? InferSchemaType<TSchema>
  : TFallback;

/**
 * Build the route context for a handler.
 */
export function buildRouteContext<
  TBody extends ValibotSchema | undefined,
  TQuery extends ValibotSchema | undefined,
  TParams extends ValibotSchema | undefined,
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
  TPublic extends boolean,
  TStrictTypes extends boolean,
  TContextVariables extends object,
  TAuthorize extends RouteAuthorization | undefined,
>(
  c: Context,
  config: RouteConfig<
    TBody,
    TQuery,
    TParams,
    TResponses,
    TPublic,
    TStrictTypes,
    TContextVariables,
    TAuthorize
  >,
  openAPIContext: OpenAPIContext
): RouteContext<
  SchemaOutput<TBody, never>,
  SchemaOutput<TQuery, Record<string, string>>,
  SchemaOutput<TParams, Record<string, string>>,
  RequiresAuthentication<TAuthorize>,
  TContextVariables
> {
  interface ValidatedRequest<TBodyOutput, TQueryOutput, TParamsOutput> {
    valid(target: 'json' | 'form'): TBodyOutput;
    valid(target: 'query'): TQueryOutput;
    valid(target: 'param'): TParamsOutput;
  }

  const req = c.req as unknown as ValidatedRequest<
    SchemaOutput<TBody, never>,
    SchemaOutput<TQuery, Record<string, string>>,
    SchemaOutput<TParams, Record<string, string>>
  >;
  const serviceName = config.tags?.[0] || config.operationId || 'Route';
  const routeLogger: Logger = openAPIContext.pino
    ? createContextAwarePinoLogger({
        pino: openAPIContext.pino,
        service: serviceName,
        sanitizers: openAPIContext.sanitizers,
      })
    : createSanitizedLogger(
        openAPIContext.logger ?? createLogger(serviceName),
        openAPIContext.sanitizers
      );

  const contextVariables = c.var as TContextVariables;
  // The session is only narrowed when `authorize` rejected unauthenticated requests before
  // this point. Other guarantees come from the application's own AuthenticatedAuthContext.
  const session = c.get('session') as RouteContext<
    never,
    never,
    never,
    RequiresAuthentication<TAuthorize>,
    TContextVariables
  >['session'];

  return {
    ...contextVariables,
    body: req.valid(config.bodyType || 'json'),
    query: req.valid('query'),
    params: req.valid('param'),
    services: c.get('services') || {},
    session,
    ip: getClientIp(c),
    userAgent: c.req.header('user-agent'),
    logger: routeLogger,
    context: c,
  };
}
