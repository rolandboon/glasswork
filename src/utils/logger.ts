import { logger as honoLogger } from 'hono/logger';

/**
 * Logger interface for framework and application logging
 */
export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/**
 * Default console logger (used by framework internally)
 */
export const defaultLogger: Logger = {
  debug: console.debug.bind(console),
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

/**
 * Create a logger with a prefix for namespacing
 *
 * @param prefix - Prefix to add to all log messages
 * @param enabled - Whether logging is enabled (default: true)
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger('MyService', debug);
 * logger.info('Starting service'); // [MyService] Starting service
 * ```
 */
export function createLogger(prefix: string, enabled = true): Logger {
  if (!enabled) {
    const noop = () => {};
    return { debug: noop, info: noop, warn: noop, error: noop };
  }

  return {
    debug: (msg, ...meta) => console.debug(`[${prefix}] ${msg}`, ...meta),
    info: (msg, ...meta) => console.log(`[${prefix}] ${msg}`, ...meta),
    warn: (msg, ...meta) => console.warn(`[${prefix}] ${msg}`, ...meta),
    error: (msg, ...meta) => console.error(`[${prefix}] ${msg}`, ...meta),
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
