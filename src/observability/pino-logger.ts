import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../utils/logger.js';
import { getRequestContext } from './request-context.js';

/**
 * Pino logger interface - subset of pino.Logger for type compatibility.
 * This allows the framework to work with Pino without a hard dependency.
 */
export interface PinoLogger {
  level: string;
  debug: (obj: object, msg?: string) => void;
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => PinoLogger;
  flush?: () => void | Promise<void>;
}

/**
 * Options for creating a context-aware Pino logger.
 */
export interface ContextAwarePinoOptions {
  /**
   * Base Pino logger instance.
   * Create with: `pino({ level: 'info' })`
   */
  pino: PinoLogger;

  /**
   * Service name to include in all logs.
   * Useful for filtering logs by service in CloudWatch.
   */
  service?: string;
}

/**
 * Create a context-aware logger that automatically includes request context.
 *
 * This logger wraps a Pino instance and automatically injects:
 * - requestId (from AsyncLocalStorage)
 * - userId (if set via setRequestUser)
 * - service name
 *
 * The logger uses Pino's structured logging format, optimized for CloudWatch Logs Insights.
 *
 * @param options - Configuration options
 * @returns Logger instance compatible with Glasswork's Logger interface
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { createContextAwarePinoLogger } from 'glasswork';
 *
 * const logger = createContextAwarePinoLogger({
 *   pino: pino({ level: 'info' }),
 *   service: 'user-service',
 * });
 *
 * // In your service (requestId automatically included!)
 * logger.info('Creating user', { email: 'test@example.com' });
 * // Output: {"level":"info","requestId":"abc-123","service":"user-service","msg":"Creating user","email":"test@example.com"}
 * ```
 */
export function createContextAwarePinoLogger(options: ContextAwarePinoOptions): Logger {
  const { pino, service } = options;

  function getBindings(): Record<string, unknown> {
    const ctx = getRequestContext();
    const bindings: Record<string, unknown> = {};

    if (ctx?.requestId) {
      bindings.requestId = ctx.requestId;
    }
    if (ctx?.userId) {
      bindings.userId = ctx.userId;
    }
    if (service) {
      bindings.service = service;
    }

    // Include custom context
    if (ctx?.custom) {
      Object.assign(bindings, ctx.custom);
    }

    return bindings;
  }

  function createLogObject(_msg: string, meta: unknown[]): object {
    const bindings = getBindings();
    let obj: Record<string, unknown> = { ...bindings };

    // Handle meta arguments
    for (const item of meta) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        obj = { ...obj, ...(item as Record<string, unknown>) };
      }
    }

    return obj;
  }

  return {
    debug(msg: string, ...meta: unknown[]) {
      pino.debug(createLogObject(msg, meta), msg);
    },
    info(msg: string, ...meta: unknown[]) {
      pino.info(createLogObject(msg, meta), msg);
    },
    warn(msg: string, ...meta: unknown[]) {
      pino.warn(createLogObject(msg, meta), msg);
    },
    error(msg: string, ...meta: unknown[]) {
      pino.error(createLogObject(msg, meta), msg);
    },
    child(bindings: Record<string, unknown>) {
      return createContextAwarePinoLogger({
        pino: pino.child(bindings),
        service,
      });
    },
  };
}

/**
 * Create HTTP request logging middleware for Pino.
 *
 * This middleware logs HTTP requests with:
 * - requestId
 * - method, path, status
 * - duration (ms)
 * - userId (if authenticated)
 *
 * @param pino - Pino logger instance
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { createPinoHttpMiddleware } from 'glasswork';
 *
 * const logger = pino({ level: 'info' });
 * app.use(createPinoHttpMiddleware(logger));
 * ```
 */
export function createPinoHttpMiddleware(pino: PinoLogger): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();

    await next();

    const duration = Date.now() - start;
    const ctx = getRequestContext();

    const logObject: Record<string, unknown> = {
      requestId: ctx?.requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration,
    };

    if (ctx?.userId) {
      logObject.userId = ctx.userId;
    }

    // Use appropriate log level based on status
    if (c.res.status >= 500) {
      pino.error(logObject, 'HTTP Request');
    } else if (c.res.status >= 400) {
      pino.warn(logObject, 'HTTP Request');
    } else {
      pino.info(logObject, 'HTTP Request');
    }
  };
}

/**
 * Default Pino configuration optimized for AWS Lambda.
 *
 * Features:
 * - JSON output (CloudWatch Logs Insights compatible)
 * - Minimal formatting overhead
 * - Fast serialization
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { lambdaPinoConfig } from 'glasswork';
 *
 * const logger = pino(lambdaPinoConfig);
 * ```
 */
export const lambdaPinoConfig = {
  level: process.env.LOG_LEVEL || 'info',
  // Use safe formatters that work in Lambda
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  // Disable pretty printing
  transport: undefined,
  // Disable pid/hostname for smaller logs
  base: undefined,
};
