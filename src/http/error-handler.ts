import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createLogger } from '../utils/logger.js';
import { DomainException, getStatusCodeFromErrorCode } from './errors.js';

/**
 * Exception tracker interface (duplicated here to avoid import dependency)
 */
interface ExceptionTracker {
  captureException(error: Error, context?: Record<string, unknown>): void;
}

/**
 * Exception tracking configuration
 */
interface ExceptionTrackingConfig {
  trackStatusCodes: (statusCode: number) => boolean;
}

const logger = createLogger('Glasswork:ErrorHandler', true);

interface FormattedError {
  message: string;
  statusCode: ContentfulStatusCode;
}

interface ErrorHandlerOptions {
  /**
   * Whether to log errors to console
   * @default true in development, false in test
   */
  logErrors?: boolean;

  /**
   * Custom error response handler
   */
  responseHandler?: (error: FormattedError, context: Context) => Response | Promise<Response>;

  /**
   * Exception tracker for external error monitoring (Sentry, AppSignal, etc.)
   * @default undefined (no tracking)
   */
  exceptionTracker?: ExceptionTracker;

  /**
   * Exception tracking configuration
   * @default { trackStatusCodes: (status) => status >= 500 }
   */
  trackingConfig?: Pick<ExceptionTrackingConfig, 'trackStatusCodes'>;
}

/**
 * Default response handler - returns JSON error
 */
function defaultResponseHandler(error: FormattedError, context: Context): Response {
  return context.json(
    {
      error: error.message,
    },
    error.statusCode
  );
}

/**
 * Track exception if configured and criteria are met.
 * Centralizes exception tracking logic to avoid duplication.
 */
function trackException(
  error: Error,
  statusCode: number,
  context: Context,
  tracker: ExceptionTracker | undefined,
  trackingConfig: Pick<ExceptionTrackingConfig, 'trackStatusCodes'>,
  options: {
    explicitTrack?: boolean;
    errorCode?: string;
    unexpected?: boolean;
  } = {}
): void {
  if (!tracker) return;

  const { explicitTrack, errorCode, unexpected } = options;

  // Determine if we should track:
  // - Explicit flag takes precedence
  // - Otherwise use status code rules or track unexpected errors
  let shouldTrack: boolean;
  if (explicitTrack !== undefined) {
    shouldTrack = explicitTrack;
  } else {
    shouldTrack = trackingConfig.trackStatusCodes(statusCode) || !!unexpected;
  }

  if (!shouldTrack) return;

  tracker.captureException(error, {
    requestId: context.get('requestId'),
    path: context.req.path,
    method: context.req.method,
    statusCode,
    ...(errorCode && { errorCode }),
    ...(unexpected && { unexpected: true }),
  });
}

/**
 * Handle DomainException errors.
 */
function handleDomainException(
  err: DomainException,
  context: Context,
  logErrors: boolean,
  exceptionTracker: ExceptionTracker | undefined,
  trackingConfig: Pick<ExceptionTrackingConfig, 'trackStatusCodes'>
): FormattedError {
  const statusCode = getStatusCodeFromErrorCode(err.code);
  const error: FormattedError = {
    message: err.message,
    statusCode: statusCode as ContentfulStatusCode,
  };

  // Log 5xx errors with stack trace
  if (logErrors && statusCode >= 500) {
    logger.error(`${err.code}: ${err.message}${err.stack ? `\n${err.stack}` : ''}`);
  }

  trackException(err, statusCode, context, exceptionTracker, trackingConfig, {
    explicitTrack: err.track,
    errorCode: err.code,
  });

  return error;
}

/**
 * Handle HTTPException errors.
 */
function handleHTTPException(
  err: HTTPException,
  context: Context,
  logErrors: boolean,
  exceptionTracker: ExceptionTracker | undefined,
  trackingConfig: Pick<ExceptionTrackingConfig, 'trackStatusCodes'>
): FormattedError {
  const error: FormattedError = {
    message: err.message,
    statusCode: err.status,
  };

  // Log 5xx HTTP errors
  if (logErrors && err.status >= 500) {
    logger.error(`HTTPException ${err.status}: ${err.message}`);
  }

  trackException(err, err.status, context, exceptionTracker, trackingConfig);

  return error;
}

/**
 * Handle unexpected errors.
 */
function handleUnexpectedError(
  err: unknown,
  context: Context,
  logErrors: boolean,
  exceptionTracker: ExceptionTracker | undefined,
  trackingConfig: Pick<ExceptionTrackingConfig, 'trackStatusCodes'>
): FormattedError {
  // Unexpected errors - always log and track
  if (logErrors) {
    logger.error('Unhandled error:', err);
  }

  const normalizedError = err instanceof Error ? err : new Error(String(err));
  trackException(normalizedError, 500, context, exceptionTracker, trackingConfig, {
    unexpected: true,
  });

  return { message: 'Internal server error', statusCode: 500 };
}

/**
 * Create an error handler middleware for Hono
 *
 * Handles:
 * - DomainException (custom business logic exceptions)
 * - HTTPException (Hono's built-in HTTP exceptions)
 * - Validation errors (returns 422)
 * - Generic errors (returns 500)
 * - Exception tracking (optional, via exceptionTracker option)
 */
export function createErrorHandler(options: ErrorHandlerOptions = {}): ErrorHandler {
  const {
    logErrors = process.env.NODE_ENV !== 'test',
    responseHandler = defaultResponseHandler,
    exceptionTracker,
    trackingConfig = { trackStatusCodes: (status) => status >= 500 },
  } = options;

  return (err, context) => {
    let error: FormattedError;

    try {
      if (err instanceof DomainException) {
        error = handleDomainException(err, context, logErrors, exceptionTracker, trackingConfig);
      } else if (err instanceof HTTPException) {
        error = handleHTTPException(err, context, logErrors, exceptionTracker, trackingConfig);
      } else {
        error = handleUnexpectedError(err, context, logErrors, exceptionTracker, trackingConfig);
      }
    } catch (handlerErr) {
      // Error handler itself threw - log and return generic error
      logger.error('Error in error handler:', handlerErr);
      error = { message: 'Internal server error', statusCode: 500 };
    }

    return responseHandler(error, context);
  };
}

/**
 * Default error handler instance
 */
export const defaultErrorHandler = createErrorHandler();
