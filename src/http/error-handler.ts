import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createLogger, getDefaultLogLevel, type Logger, type LogLevel } from '../utils/logger.js';
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

// Logger will be created per-handler instance with appropriate level
// This allows tests to control logging via logLevel option

interface FormattedError {
  message: string;
  statusCode: ContentfulStatusCode;
}

interface ErrorHandlerOptions {
  /**
   * Log level for error logging.
   * Errors are logged if level allows (error level or lower).
   * @default Uses default log level (silent in test, info otherwise)
   */
  logLevel?: LogLevel;

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
  logLevel: LogLevel,
  exceptionTracker: ExceptionTracker | undefined,
  trackingConfig: Pick<ExceptionTrackingConfig, 'trackStatusCodes'>,
  logger: Logger
): FormattedError {
  const statusCode = getStatusCodeFromErrorCode(err.code);
  const error: FormattedError = {
    message: err.message,
    statusCode: statusCode as ContentfulStatusCode,
  };

  // Log 5xx errors with stack trace (if log level allows)
  if (logLevel !== 'silent' && statusCode >= 500) {
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
  logLevel: LogLevel,
  exceptionTracker: ExceptionTracker | undefined,
  trackingConfig: Pick<ExceptionTrackingConfig, 'trackStatusCodes'>,
  logger: Logger
): FormattedError {
  const error: FormattedError = {
    message: err.message,
    statusCode: err.status,
  };

  // Log 5xx HTTP errors (if log level allows)
  if (logLevel !== 'silent' && err.status >= 500) {
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
  logLevel: LogLevel,
  exceptionTracker: ExceptionTracker | undefined,
  trackingConfig: Pick<ExceptionTrackingConfig, 'trackStatusCodes'>,
  logger: Logger
): FormattedError {
  // Unexpected errors - log if level allows
  if (logLevel !== 'silent') {
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
    logLevel = getDefaultLogLevel(),
    responseHandler = defaultResponseHandler,
    exceptionTracker,
    trackingConfig = { trackStatusCodes: (status) => status >= 500 },
  } = options;

  // Create logger with the specified log level so it actually logs when level allows
  const logger = createLogger('Glasswork:ErrorHandler', logLevel);

  return (err, context) => {
    let error: FormattedError;

    try {
      if (err instanceof DomainException) {
        error = handleDomainException(
          err,
          context,
          logLevel,
          exceptionTracker,
          trackingConfig,
          logger
        );
      } else if (err instanceof HTTPException) {
        error = handleHTTPException(
          err,
          context,
          logLevel,
          exceptionTracker,
          trackingConfig,
          logger
        );
      } else {
        error = handleUnexpectedError(
          err,
          context,
          logLevel,
          exceptionTracker,
          trackingConfig,
          logger
        );
      }
    } catch (handlerErr) {
      // Error handler itself threw - log and return generic error
      // Use error level logger for this critical error
      const errorLogger = createLogger('Glasswork:ErrorHandler', 'error');
      errorLogger.error('Error in error handler:', handlerErr);
      error = { message: 'Internal server error', statusCode: 500 };
    }

    return responseHandler(error, context);
  };
}

/**
 * Default error handler instance
 */
export const defaultErrorHandler = createErrorHandler();
