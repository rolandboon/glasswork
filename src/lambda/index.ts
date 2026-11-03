import { handle, type LambdaContext, type LambdaEvent } from 'hono/aws-lambda';
import type { BootstrapResult } from '../core/types.js';
import { flushBudget } from '../utils/lambda-deadline.js';
import { createLogger, type Logger } from '../utils/logger.js';

export interface LambdaHandlerOptions {
  /** Upper bound for waiting on exception reports before returning. Default 2000. */
  flushTimeoutMs?: number;
  /** Time kept free before the invocation's timeout. Default 500. */
  safetyMarginMs?: number;
  logger?: Logger;
}

/**
 * An API Gateway or Function URL handler for an application, with the Lambda lifecycle:
 *
 * - The application initializes once per execution environment: pass the promise from
 *   `bootstrap()`, created at module level, or a function that creates it. Warm invocations
 *   reuse it and its singletons; nothing is stopped between invocations.
 * - When initialization fails, every invocation fails with that error. It is logged once and
 *   is never an unhandled rejection.
 * - Each request has its own scope, disposed when the request ends.
 * - Before returning, the handler waits for exception reports still being sent, at most
 *   `flushTimeoutMs` and never past the invocation's deadline minus `safetyMarginMs`. A
 *   timeout is logged and does not change the response.
 */
export function createLambdaHandler(
  application: Promise<BootstrapResult> | (() => Promise<BootstrapResult>),
  options: LambdaHandlerOptions = {}
) {
  const logger = options.logger ?? createLogger('Glasswork:Lambda');
  const flushTimeoutMs = options.flushTimeoutMs ?? 2000;
  const safetyMarginMs = options.safetyMarginMs ?? 500;
  const ready = typeof application === 'function' ? application() : application;
  ready.catch((error) => {
    try {
      logger.error(
        'Application failed to initialize; every invocation fails with this error',
        error
      );
    } catch {
      // Keep the original init rejection; diagnostics must not create an unhandled one.
    }
  });
  let handler: ReturnType<typeof handle> | undefined;

  return async (event: LambdaEvent, context?: LambdaContext) => {
    const initialized = await ready;
    handler ??= handle(initialized.app);
    try {
      return await handler(event, context);
    } finally {
      const result = await initialized.flush(flushBudget(context, flushTimeoutMs, safetyMarginMs));
      if (!result.completed) {
        try {
          logger.warn('Exception reports were still being sent when the invocation returned', {
            pending: result.pending,
          });
        } catch {
          // Reporting a flush timeout must not replace the business result.
        }
      }
    }
  };
}
