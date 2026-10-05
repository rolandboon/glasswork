import type { Logger } from '../utils/logger.js';
import type { ExceptionTracker } from './exception-tracking.js';

/** Explicit application policy applied before diagnostics reach a logger or tracker. */
export interface ObservabilitySanitizers {
  path?: (path: string) => string;
  message?: (message: string) => string;
  error?: (error: Error) => Error;
  metadata?: (metadata: Record<string, unknown>) => Record<string, unknown>;
}

export function sanitizeLogMetadata(
  metadata: Record<string, unknown>,
  sanitizers: ObservabilitySanitizers = {}
): Record<string, unknown> {
  const result = { ...metadata };
  if (typeof result.path === 'string' && sanitizers.path) {
    result.path = sanitizers.path(result.path);
  }
  return sanitizers.metadata?.(result) ?? result;
}

/** Preserves the native logger and its children without registering global policy. */
export function createSanitizedLogger(
  logger: Logger,
  sanitizers: ObservabilitySanitizers = {}
): Logger {
  const sanitizeValue = (value: unknown): unknown => {
    if (value instanceof Error) return sanitizers.error?.(value) ?? value;
    if (typeof value === 'string') return sanitizers.message?.(value) ?? value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return sanitizeLogMetadata(value as Record<string, unknown>, sanitizers);
    }
    return value;
  };
  const write = (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    values: unknown[]
  ) => {
    logger[level](sanitizers.message?.(message) ?? message, ...values.map(sanitizeValue));
  };
  return {
    debug: (message, ...values) => write('debug', message, values),
    info: (message, ...values) => write('info', message, values),
    warn: (message, ...values) => write('warn', message, values),
    error: (message, ...values) => write('error', message, values),
    child: (bindings) => {
      const safe = sanitizeLogMetadata(bindings, sanitizers);
      const child = logger.child?.(safe) ?? {
        debug: (message: string, ...values: unknown[]) => logger.debug(message, safe, ...values),
        info: (message: string, ...values: unknown[]) => logger.info(message, safe, ...values),
        warn: (message: string, ...values: unknown[]) => logger.warn(message, safe, ...values),
        error: (message: string, ...values: unknown[]) => logger.error(message, safe, ...values),
      };
      return createSanitizedLogger(child, sanitizers);
    },
  };
}

export function createSanitizedExceptionTracker(
  tracker: ExceptionTracker,
  sanitizers: ObservabilitySanitizers = {}
): ExceptionTracker {
  return {
    captureException: (error, context) =>
      tracker.captureException(
        sanitizers.error?.(error) ?? error,
        context ? sanitizeLogMetadata(context, sanitizers) : undefined
      ),
    captureMessage: (message, level, context) =>
      tracker.captureMessage(
        sanitizers.message?.(message) ?? message,
        level,
        context ? sanitizeLogMetadata(context, sanitizers) : undefined
      ),
    setUser: (user) => {
      const safe = sanitizeLogMetadata(user, sanitizers);
      if (typeof safe.id === 'string') tracker.setUser({ ...safe, id: safe.id });
    },
    setContext: (key, data) => tracker.setContext(key, sanitizeLogMetadata(data, sanitizers)),
  };
}
