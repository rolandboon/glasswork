import type { Context } from 'hono';
import { createContextAwarePinoLogger } from '../observability/pino-logger.js';
import { getClientIp } from '../utils/get-client-ip.js';
import { createLogger, type Logger } from '../utils/logger.js';
import type { OpenAPIContext } from './route-openapi-context.js';
import type {
  RouteConfig,
  RouteContext,
  STATUS_DESCRIPTIONS,
  ValibotSchema,
} from './route-types.js';

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
>(
  c: Context,
  config: RouteConfig<TBody, TQuery, TParams, TResponses, TPublic, TStrictTypes>,
  openAPIContext: OpenAPIContext
): RouteContext<unknown, unknown, unknown, false> {
  interface ValidatedRequest {
    valid(target: 'json' | 'form' | 'query' | 'param'): unknown;
  }

  const req = c.req as unknown as ValidatedRequest;
  const serviceName = config.tags?.[0] || config.operationId || 'Route';
  const routeLogger: Logger = openAPIContext.pino
    ? createContextAwarePinoLogger({ pino: openAPIContext.pino, service: serviceName })
    : createLogger(serviceName);

  return {
    ...c.var,
    body: req.valid(config.bodyType || 'json'),
    query: req.valid('query') as Record<string, string>,
    params: req.valid('param') as Record<string, string>,
    services: c.get('services') || {},
    session: c.get('session'),
    ip: getClientIp(c),
    userAgent: c.req.header('user-agent'),
    logger: routeLogger,
    context: c,
  };
}
