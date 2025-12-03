import type { MiddlewareHandler } from 'hono';
import { isTest } from '../utils/environment.js';
import { getRequestContext, setRequestUser } from './request-context.js';

/**
 * Generic exception tracker interface for integrating with external error tracking services.
 *
 * This interface is implemented by adapters for services like:
 * - AWS CloudWatch (built-in)
 * - Sentry
 * - AppSignal
 *
 * @example
 * ```typescript
 * // Use built-in CloudWatch tracker
 * import { createCloudWatchTracker } from 'glasswork';
 *
 * const tracker = createCloudWatchTracker({
 *   namespace: 'MyApp/Errors',
 * });
 *
 * // Or create custom adapter
 * const sentryTracker: ExceptionTracker = {
 *   captureException(error, context) {
 *     Sentry.captureException(error, { extra: context });
 *   },
 *   // ...
 * };
 * ```
 */
export interface ExceptionTracker {
  /**
   * Capture an exception with optional context
   * @param error - The error to track
   * @param context - Additional context (request ID, user info, etc.)
   */
  captureException(error: Error, context?: Record<string, unknown>): void;

  /**
   * Capture a message with severity level
   * @param message - The message to track
   * @param level - Severity level
   * @param context - Additional context
   */
  captureMessage(
    message: string,
    level: 'info' | 'warning' | 'error',
    context?: Record<string, unknown>
  ): void;

  /**
   * Set user information for the current scope
   * @param user - User information
   */
  setUser(user: { id: string; email?: string; [key: string]: unknown }): void;

  /**
   * Set custom context for the current scope
   * @param key - Context key
   * @param data - Context data
   */
  setContext(key: string, data: Record<string, unknown>): void;
}

/**
 * Configuration for exception tracking behavior
 */
export interface ExceptionTrackingConfig {
  /**
   * Exception tracker instance
   */
  tracker: ExceptionTracker;

  /**
   * Function to determine which HTTP status codes trigger tracking.
   * Default: track only 5xx errors.
   *
   * @param statusCode - HTTP status code
   * @returns true if the error should be tracked
   *
   * @example
   * ```typescript
   * // Track 5xx and 404 errors
   * trackStatusCodes: (status) => status >= 500 || status === 404
   *
   * // Track only 5xx errors (default)
   * trackStatusCodes: (status) => status >= 500
   *
   * // Track all errors
   * trackStatusCodes: () => true
   * ```
   */
  trackStatusCodes: (statusCode: number) => boolean;
}

/**
 * Default exception tracking configuration.
 * Only tracks 5xx server errors by default.
 */
export const defaultTrackStatusCodes = (statusCode: number): boolean => statusCode >= 500;

/**
 * Determine if an exception should be tracked based on explicit flag and status code rules.
 *
 * @param explicitTrack - Explicit track flag from exception (overrides status code rules)
 * @param statusCode - HTTP status code
 * @param config - Tracking configuration
 * @returns true if the exception should be tracked
 *
 * @internal
 */
export function shouldTrackException(
  explicitTrack: boolean | undefined,
  statusCode: number,
  config: ExceptionTrackingConfig
): boolean {
  // Explicit tracking flag takes precedence
  if (explicitTrack !== undefined) {
    return explicitTrack;
  }

  // Otherwise use status code rules
  return config.trackStatusCodes(statusCode);
}

/**
 * Create middleware for exception tracking context setup.
 *
 * This middleware sets up request context for exception tracking.
 * Actual exception capture is handled in the error handler.
 *
 * @param config - Exception tracking configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { createExceptionTrackingMiddleware } from 'glasswork';
 *
 * app.use(createExceptionTrackingMiddleware({
 *   tracker,
 *   trackStatusCodes: (status) => status >= 500,
 * }));
 * ```
 */
export function createExceptionTrackingMiddleware(
  config: ExceptionTrackingConfig
): MiddlewareHandler {
  return async (c, next) => {
    // Get request context from AsyncLocalStorage if available
    const ctx = getRequestContext();
    const requestId = ctx?.requestId ?? c.get('requestId');

    config.tracker.setContext('request', {
      id: requestId,
      method: c.req.method,
      path: c.req.path,
      userAgent: c.req.header('user-agent'),
    });

    await next();
  };
}

// ============================================================================
// Built-in Exception Trackers
// ============================================================================

/**
 * Options for CloudWatch exception tracker
 */
export interface CloudWatchTrackerOptions {
  /**
   * CloudWatch metric namespace.
   * @default 'Application/Errors'
   */
  namespace?: string;

  /**
   * Additional dimensions to include with all metrics.
   * @example { environment: 'production', service: 'user-api' }
   */
  dimensions?: Record<string, string>;

  /**
   * Custom CloudWatch client (for testing or custom config).
   * If not provided, uses default AWS SDK client.
   */
  cloudWatchClient?: CloudWatchClientLike;

  /**
   * Log errors to console in addition to CloudWatch.
   * Useful for Lambda where logs appear in CloudWatch Logs.
   * @default true
   */
  logToConsole?: boolean;
}

/**
 * Minimal CloudWatch client interface for dependency injection.
 * Compatible with @aws-sdk/client-cloudwatch.
 */
export interface CloudWatchClientLike {
  send(command: unknown): Promise<unknown>;
}

/**
 * Create a CloudWatch-based exception tracker.
 *
 * This tracker publishes custom metrics to CloudWatch for error monitoring.
 * It's a zero-dependency option that works natively with AWS infrastructure.
 *
 * **Features:**
 * - Publishes `ErrorCount` metric on each exception
 * - Includes dimensions for path, error type, status code
 * - Optional console logging for CloudWatch Logs visibility
 * - Works without additional dependencies in Lambda
 *
 * **CloudWatch Alarms:**
 * Create alarms on the `ErrorCount` metric to get notified of issues.
 *
 * @param options - Configuration options
 * @returns Exception tracker instance
 *
 * @example
 * ```typescript
 * import { createCloudWatchTracker, bootstrap } from 'glasswork';
 *
 * const tracker = createCloudWatchTracker({
 *   namespace: 'MyApp/Errors',
 *   dimensions: {
 *     environment: process.env.NODE_ENV,
 *     service: 'user-api',
 *   },
 * });
 *
 * const { app } = await bootstrap(AppModule, {
 *   exceptionTracking: { tracker },
 * });
 * ```
 */
export function createCloudWatchTracker(options: CloudWatchTrackerOptions = {}): ExceptionTracker {
  const {
    namespace = 'Application/Errors',
    dimensions = {},
    cloudWatchClient,
    logToConsole = !isTest(),
  } = options;

  // Lazy-load AWS SDK to avoid bundling if not used
  let cwClient: CloudWatchClientLike | null = cloudWatchClient ?? null;

  async function getClient(): Promise<CloudWatchClientLike | null> {
    if (cwClient) return cwClient;

    try {
      // Dynamic import to avoid bundling if not used
      const { CloudWatchClient } = await import('@aws-sdk/client-cloudwatch');
      cwClient = new CloudWatchClient({});
      return cwClient;
    } catch {
      // AWS SDK not available - log only
      return null;
    }
  }

  async function putMetric(
    metricName: string,
    value: number,
    extraDimensions: Record<string, string> = {}
  ): Promise<void> {
    const client = await getClient();
    if (!client) return;

    try {
      const { PutMetricDataCommand } = await import('@aws-sdk/client-cloudwatch');

      const allDimensions = { ...dimensions, ...extraDimensions };
      const dimensionArray = Object.entries(allDimensions).map(([Name, Value]) => ({
        Name,
        Value,
      }));

      await client.send(
        new PutMetricDataCommand({
          Namespace: namespace,
          MetricData: [
            {
              MetricName: metricName,
              Value: value,
              Unit: 'Count',
              Timestamp: new Date(),
              Dimensions: dimensionArray,
            },
          ],
        })
      );
    } catch (err) {
      // Don't throw - exception tracking should never break the app
      if (logToConsole) {
        console.error('[CloudWatchTracker] Failed to put metric:', err);
      }
    }
  }

  const contextStore: Record<string, Record<string, unknown>> = {};

  return {
    captureException(error: Error, context?: Record<string, unknown>) {
      const ctx = getRequestContext();

      if (logToConsole) {
        console.error('[Exception]', {
          error: error.message,
          stack: error.stack,
          requestId: ctx?.requestId ?? context?.requestId,
          userId: ctx?.userId,
          ...context,
        });
      }

      // Publish metric to CloudWatch
      void putMetric('ErrorCount', 1, {
        ErrorType: error.name || 'Error',
        Path: String(context?.path ?? ctx?.path ?? 'unknown'),
        StatusCode: String(context?.statusCode ?? 500),
      });
    },

    captureMessage(
      message: string,
      level: 'info' | 'warning' | 'error',
      context?: Record<string, unknown>
    ) {
      const ctx = getRequestContext();

      if (logToConsole) {
        const logFn =
          level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
        logFn(`[${level.toUpperCase()}]`, message, {
          requestId: ctx?.requestId,
          userId: ctx?.userId,
          ...context,
        });
      }

      if (level === 'error') {
        void putMetric('ErrorCount', 1, {
          ErrorType: 'Message',
          Path: String(context?.path ?? ctx?.path ?? 'unknown'),
        });
      }
    },

    setUser(user: { id: string; email?: string; [key: string]: unknown }) {
      // Set user in request context (preferred method)
      // User info will be available via getRequestContext() for logging and tracking
      setRequestUser(user.id);
    },

    setContext(key: string, data: Record<string, unknown>) {
      contextStore[key] = data;
    },
  };
}

/**
 * Create a console-only exception tracker for development.
 *
 * This tracker logs exceptions to the console without sending to external services.
 * Useful for local development and testing.
 *
 * @returns Exception tracker instance
 *
 * @example
 * ```typescript
 * import { createConsoleTracker, bootstrap, isDevelopment } from 'glasswork';
 *
 * const tracker = isDevelopment()
 *   ? createConsoleTracker()
 *   : createCloudWatchTracker({ namespace: 'MyApp/Errors' });
 *
 * const { app } = await bootstrap(AppModule, {
 *   exceptionTracking: { tracker },
 * });
 * ```
 */
export function createConsoleTracker(): ExceptionTracker {
  return {
    captureException(error: Error, context?: Record<string, unknown>) {
      const ctx = getRequestContext();
      console.error('[Exception]', {
        error: error.message,
        stack: error.stack,
        requestId: ctx?.requestId ?? context?.requestId,
        ...context,
      });
    },

    captureMessage(
      message: string,
      level: 'info' | 'warning' | 'error',
      context?: Record<string, unknown>
    ) {
      const ctx = getRequestContext();
      const logFn =
        level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
      logFn(`[${level.toUpperCase()}]`, message, {
        requestId: ctx?.requestId,
        ...context,
      });
    },

    setUser() {
      // No-op for console tracker
    },

    setContext() {
      // No-op for console tracker
    },
  };
}
