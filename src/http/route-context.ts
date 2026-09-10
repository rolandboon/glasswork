import type { Context } from 'hono';
import { createContextAwarePinoLogger } from '../observability/pino-logger.js';
import { getClientIp } from '../utils/get-client-ip.js';
import { createLogger, type Logger } from '../utils/logger.js';
import type { OpenAPIContext } from './route-openapi-context.js';
import type {
  InferSchemaType,
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
>(
  c: Context,
  config: RouteConfig<TBody, TQuery, TParams, TResponses, TPublic, TStrictTypes, TContextVariables>,
  openAPIContext: OpenAPIContext
): RouteContext<
  SchemaOutput<TBody, never>,
  SchemaOutput<TQuery, Record<string, string>>,
  SchemaOutput<TParams, Record<string, string>>,
  TPublic extends true ? false : true,
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
    ? createContextAwarePinoLogger({ pino: openAPIContext.pino, service: serviceName })
    : createLogger(serviceName);

  const contextVariables = c.var as TContextVariables;
  // RouteContext has historically treated session as required unless public is true.
  // Auth-specific user state is not narrowed here; applications must supply an
  // AuthenticatedAuthContext only when their middleware enforces that guarantee.
  const session = c.get('session') as RouteContext<
    never,
    never,
    never,
    TPublic extends true ? false : true,
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
