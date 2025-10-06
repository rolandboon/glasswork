/**
 * Helper functions for working with configuration.
 *
 * @module config/helpers
 */

/**
 * Transforms a SNAKE_CASE or kebab-case string to camelCase.
 *
 * Useful as a transformKey function when environment variables
 * use UPPER_SNAKE_CASE but your schema uses camelCase.
 *
 * @param key - The key to transform
 * @returns Transformed key in camelCase
 *
 * @example
 * ```typescript
 * toCamelCase('DATABASE_URL') // 'databaseUrl'
 * toCamelCase('api-key') // 'apiKey'
 * toCamelCase('NODE_ENV') // 'nodeEnv'
 * ```
 *
 * @example
 * ```typescript
 * // Use with createConfig
 * const config = await createConfig({
 *   schema,
 *   transformKey: toCamelCase,
 *   providers: [envProvider()],
 * });
 * ```
 */
export function toCamelCase(key: string): string {
  return key.toLowerCase().replace(/[_-]([a-z0-9])/g, (_, char) => char.toUpperCase());
}

/**
 * Transforms a string to UPPER_SNAKE_CASE.
 *
 * Useful for reverse transformation or normalization.
 *
 * @param key - The key to transform
 * @returns Transformed key in UPPER_SNAKE_CASE
 *
 * @example
 * ```typescript
 * toSnakeCase('databaseUrl') // 'DATABASE_URL'
 * toSnakeCase('apiKey') // 'API_KEY'
 * ```
 */
export function toSnakeCase(key: string): string {
  return key
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toUpperCase();
}

/**
 * Parses a string value to boolean.
 *
 * Useful for environment variables that come as strings.
 * Recognizes: 'true', '1', 'yes', 'on' as true (case-insensitive).
 *
 * @param value - String value to parse
 * @returns Boolean value
 *
 * @example
 * ```typescript
 * parseBoolean('true') // true
 * parseBoolean('1') // true
 * parseBoolean('yes') // true
 * parseBoolean('on') // true
 * parseBoolean('false') // false
 * parseBoolean('0') // false
 * ```
 */
export function parseBoolean(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

/**
 * Parses a comma-separated string into an array.
 *
 * Useful for environment variables that contain lists.
 *
 * @param value - String value to parse
 * @param trim - Whether to trim whitespace from items
 * @returns Array of strings
 *
 * @example
 * ```typescript
 * parseArray('a,b,c') // ['a', 'b', 'c']
 * parseArray('a, b, c', true) // ['a', 'b', 'c']
 * parseArray('') // []
 * ```
 */
export function parseArray(value: string, trim = true): string[] {
  if (!value) return [];
  return value.split(',').map((item) => (trim ? item.trim() : item));
}

/**
 * Parses a JSON string safely.
 *
 * Useful for environment variables that contain JSON objects.
 * Returns undefined if parsing fails instead of throwing.
 *
 * @param value - JSON string to parse
 * @returns Parsed object or undefined
 *
 * @example
 * ```typescript
 * parseJson('{"key": "value"}') // { key: 'value' }
 * parseJson('invalid') // undefined
 * ```
 */
export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
