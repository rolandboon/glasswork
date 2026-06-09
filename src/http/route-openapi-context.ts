import type { Hono } from 'hono';
import type { OpenAPIResponseProcessor } from '../core/types.js';
import type { PinoLogger } from '../observability/pino-logger.js';

/**
 * OpenAPI context stored in Hono app context.
 * Set during bootstrap and used when defining routes.
 */
export interface OpenAPIContext {
  processors: OpenAPIResponseProcessor[];
  securitySchemes: string[];
  /**
   * Pino logger instance for creating context-aware loggers in route handlers.
   * When set, enables `logger` property in RouteContext.
   */
  pino?: PinoLogger;
}

const openAPIContextMap = new WeakMap<Hono, OpenAPIContext>();

/**
 * Set the OpenAPI context for a Hono app instance.
 * @internal
 */
export function setOpenAPIContext(app: Hono, context: OpenAPIContext): void {
  openAPIContextMap.set(app, context);
}

/**
 * Get the OpenAPI context for a Hono app instance.
 * @internal
 */
export function getOpenAPIContext(app: Hono): OpenAPIContext {
  return openAPIContextMap.get(app) ?? { processors: [], securitySchemes: [], pino: undefined };
}
