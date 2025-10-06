/**
 * Configuration management for Glasswork applications.
 *
 * Provides a flexible, type-safe way to load and validate configuration
 * from multiple sources (environment variables, .env files, AWS SSM, etc.)
 * using Valibot schemas.
 *
 * @module config
 *
 * @example
 * ```typescript
 * import { object, string, number } from 'valibot';
 * import { createConfig, dotenvProvider, envProvider } from 'glasswork';
 *
 * // Define schema
 * const configSchema = object({
 *   nodeEnv: string(),
 *   port: number(),
 *   databaseUrl: string(),
 * });
 *
 * // Create config with multiple providers
 * const config = await createConfig({
 *   schema: configSchema,
 *   providers: [
 *     dotenvProvider({ path: '.env' }),
 *     envProvider(), // Env vars override .env
 *   ],
 * });
 *
 * // Type-safe access
 * const port = config.get('port'); // number
 * ```
 */

// Core
export { ConfigValidationException, createConfig, validateConfig } from './config-service.js';
// Helpers
export {
  parseArray,
  parseBoolean,
  parseJson,
  toCamelCase,
  toSnakeCase,
} from './helpers.js';
// Providers
export {
  type DotenvProviderOptions,
  dotenvProvider,
  type EnvProviderOptions,
  envProvider,
  objectProvider,
  type SsmProviderOptions,
  ssmProvider,
} from './providers.js';
// Types
export type { Config, ConfigOptions, ConfigProvider } from './types.js';
