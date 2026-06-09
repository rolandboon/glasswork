/**
 * @module glasswork/observability
 * Logging, request context, and exception tracking.
 */

export {
  type CloudWatchClientLike,
  type CloudWatchTrackerOptions,
  createCloudWatchTracker,
  createConsoleTracker,
  createExceptionTrackingMiddleware,
  defaultTrackStatusCodes,
  type ExceptionTracker,
  type ExceptionTrackingConfig,
  shouldTrackException,
} from './exception-tracking.js';

export {
  type ContextAwarePinoOptions,
  createContextAwarePinoLogger,
  createPinoHttpMiddleware,
  lambdaPinoConfig,
  type PinoLogger,
} from './pino-logger.js';

export {
  getRequestContext,
  getRequestId,
  type RequestContext,
  setRequestContextValue,
  setRequestUser,
} from './request-context.js';
