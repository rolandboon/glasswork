import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createLogger } from '../utils/logger.js';
import { DomainException, getStatusCodeFromErrorCode } from './errors.js';

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
 * Create an error handler middleware for Hono
 *
 * Handles:
 * - DomainException (custom business logic exceptions)
 * - HTTPException (Hono's built-in HTTP exceptions)
 * - Validation errors (returns 422)
 * - Generic errors (returns 500)
 */
export function createErrorHandler(options: ErrorHandlerOptions = {}): ErrorHandler {
  const { logErrors = process.env.NODE_ENV !== 'test', responseHandler = defaultResponseHandler } =
    options;

  return (err, context) => {
    let error: FormattedError;

    if (err instanceof DomainException) {
      const statusCode = getStatusCodeFromErrorCode(err.code);
      error = { message: err.message, statusCode: statusCode as ContentfulStatusCode };

      if (logErrors && statusCode === 500) {
        logger.error('DomainException with unknown code:', err);
      }
    } else if (err instanceof HTTPException) {
      error = {
        message: err.message,
        statusCode: err.status,
      };
    } else {
      if (logErrors) {
        logger.error('Unhandled error:', err);
      }
      error = {
        message: 'Internal server error',
        statusCode: 500,
      };
    }

    return responseHandler(error, context);
  };
}

/**
 * Default error handler instance
 */
export const defaultErrorHandler = createErrorHandler();
