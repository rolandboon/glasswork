import { logger as honoLogger } from 'hono/logger';
import { isTest } from './environment.js';

/**
 * Log levels matching Pino's level system.
 * Lower numbers = more verbose, higher numbers = less verbose.
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/**
 * Log level numeric values (matching Pino).
 * Used for level comparison.
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
};

/**
 * Get the default log level based on environment.
 * - test: silent (no logs)
 * - development/production: info
 */
export function getDefaultLogLevel(): LogLevel {
  return isTest() ? 'silent' : 'info';
}

/**
 * Logger interface for framework and application logging.
 *
 * This interface is compatible with popular logging libraries like Pino.
 * The optional `child()` method enables request-scoped logging with automatic context binding.
 *
 * @example
 * ```typescript
 * // Console-based logger
 * const logger = createLogger('MyService');
 * logger.info('Hello', { userId: '123' });
 *
 * // Pino logger (recommended for Lambda)
 * import pino from 'pino';
 * const logger = pino({ level: 'info' });
 * ```
 */
export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;

  /**
   * Create a child logger with bound context (Pino-compatible).
   * @param bindings - Context to bind to all log messages
   */
  child?(bindings: Record<string, unknown>): Logger;
}

/**
 * Default console logger (used by framework internally).
 * Respects LOG_LEVEL environment variable or defaults to info.
 */
const defaultLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || getDefaultLogLevel();

export const defaultLogger: Logger = (() => {
  const level = LOG_LEVELS[defaultLevel];
  const noop = () => {};

  return {
    debug: level <= LOG_LEVELS.debug ? console.debug.bind(console) : noop,
    info: level <= LOG_LEVELS.info ? console.log.bind(console) : noop,
    warn: level <= LOG_LEVELS.warn ? console.warn.bind(console) : noop,
    error: level <= LOG_LEVELS.error ? console.error.bind(console) : noop,
  };
})();

/**
 * Create a logger with a prefix for namespacing.
 *
 * This is a simple console-based logger suitable for development.
 * For production Lambda deployments, use Pino with `createContextAwarePinoLogger`.
 *
 * @param prefix - Prefix to add to all log messages
 * @param level - Log level (default: 'silent' in test, 'info' otherwise)
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger('UserService');
 * logger.info('Creating user'); // [UserService] Creating user
 *
 * // Silent logger for tests
 * const testLogger = createLogger('TestService', 'silent');
 * testLogger.info('This will not log'); // No output
 * ```
 */
export function createLogger(prefix: string, level?: LogLevel): Logger {
  const logLevel = level ?? getDefaultLogLevel();
  const levelValue = LOG_LEVELS[logLevel];

  // Silent logger - all methods are no-ops
  if (logLevel === 'silent') {
    const noop = () => {};
    return { debug: noop, info: noop, warn: noop, error: noop };
  }

  return {
    debug:
      levelValue <= LOG_LEVELS.debug
        ? (msg, ...meta) => console.debug(`[${prefix}] ${msg}`, ...meta)
        : () => {},
    info:
      levelValue <= LOG_LEVELS.info
        ? (msg, ...meta) => console.log(`[${prefix}] ${msg}`, ...meta)
        : () => {},
    warn:
      levelValue <= LOG_LEVELS.warn
        ? (msg, ...meta) => console.warn(`[${prefix}] ${msg}`, ...meta)
        : () => {},
    error:
      levelValue <= LOG_LEVELS.error
        ? (msg, ...meta) => console.error(`[${prefix}] ${msg}`, ...meta)
        : () => {},
  };
}

/**
 * Create a plain logger middleware for Lambda (strips ANSI color codes).
 *
 * CloudWatch Logs doesn't render ANSI colors well, so this middleware
 * strips them for cleaner logs in production.
 *
 * @returns Hono logger middleware with ANSI codes stripped
 */
export function createPlainLogger() {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: we want to strip ANSI color codes
  const stripAnsi = (input: string): string => input.replace(/\u001B\[[0-9;]*m/g, '');

  return honoLogger((str: string, ...rest: string[]) => {
    const message = [str, ...rest].join(' ');
    console.log(stripAnsi(message));
  });
}
