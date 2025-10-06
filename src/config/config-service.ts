/**
 * Core configuration service implementation.
 *
 * @module config/config-service
 */

import { type BaseIssue, type BaseSchema, type InferOutput, parse, safeParse } from 'valibot';
import { deepMerge } from '../utils/deep-merge.js';
import { envProvider } from './providers.js';
import type { Config, ConfigOptions } from './types.js';

/**
 * Exception thrown when config validation fails.
 */
export class ConfigValidationException extends Error {
  constructor(
    message: string,
    public readonly issues: unknown[]
  ) {
    super(message);
    this.name = 'ConfigValidationException';
  }
}

/**
 * Implementation of the Config interface.
 */
class ConfigImpl<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>
  implements Config<TSchema>
{
  constructor(public readonly data: InferOutput<TSchema>) {}

  get<K extends keyof InferOutput<TSchema>>(key: K): InferOutput<TSchema>[K] {
    return this.data[key];
  }

  getOrDefault<K extends keyof InferOutput<TSchema>>(
    key: K,
    defaultValue: InferOutput<TSchema>[K]
  ): InferOutput<TSchema>[K] {
    const value = this.data[key];
    return value !== undefined ? value : defaultValue;
  }
}

/**
 * Creates a configuration service that loads from multiple providers
 * and validates with Valibot.
 *
 * Providers are executed in order and their results are merged together,
 * with later providers taking precedence. The merged config is then
 * validated against the provided Valibot schema.
 *
 * @template TSchema - Valibot schema for validation
 * @param options - Configuration options
 * @returns Promise resolving to validated Config
 *
 * @throws {ConfigValidationException} If validation fails
 *
 * @example
 * ```typescript
 * import { object, string, number } from 'valibot';
 *
 * const schema = object({
 *   nodeEnv: string(),
 *   port: number(),
 *   databaseUrl: string(),
 * });
 *
 * const config = await createConfig({
 *   schema,
 *   providers: [
 *     dotenvProvider({ path: '.env' }),
 *     envProvider(), // env vars override .env
 *   ],
 * });
 *
 * // Fully typed access
 * const port = config.get('port'); // number
 * const dbUrl = config.get('databaseUrl'); // string
 * ```
 *
 * @example
 * ```typescript
 * // With key transformation (SNAKE_CASE -> camelCase)
 * const config = await createConfig({
 *   schema,
 *   providers: [envProvider()],
 *   transformKey: (key) =>
 *     key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Register as DI service
 * export const AppModule = defineModule({
 *   name: 'app',
 *   providers: [
 *     {
 *       name: 'config',
 *       useFactory: async () =>
 *         await createConfig({
 *           schema: appConfigSchema,
 *           providers: [dotenvProvider(), envProvider()],
 *         }),
 *       lifetime: 'SINGLETON',
 *     },
 *   ],
 * });
 * ```
 */
export async function createConfig<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(options: ConfigOptions<TSchema>): Promise<Config<TSchema>> {
  const { schema, providers = [envProvider()], transformKey, allowUnknownKeys = true } = options;

  // Load config from all providers
  let rawConfig: Record<string, unknown> = {};

  for (const provider of providers) {
    const providerConfig = await provider();
    rawConfig = deepMerge(rawConfig, providerConfig);
  }

  // Transform keys if requested
  if (transformKey) {
    const transformed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawConfig)) {
      transformed[transformKey(key)] = value;
    }
    rawConfig = transformed;
  }

  // Filter unknown keys if requested
  if (!allowUnknownKeys && typeof schema === 'object' && 'entries' in schema) {
    const entries = (schema as { entries: Record<string, unknown> }).entries;
    const schemaKeys = new Set(Object.keys(entries));
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawConfig)) {
      if (schemaKeys.has(key)) {
        filtered[key] = value;
      }
    }
    rawConfig = filtered;
  }

  // Validate with Valibot
  const result = safeParse(schema, rawConfig);

  if (!result.success) {
    throw new ConfigValidationException('Configuration validation failed', result.issues);
  }

  return new ConfigImpl<TSchema>(result.output);
}

/**
 * Synchronously validates config that's already loaded.
 * Useful when you have config in memory and just need validation.
 *
 * @template TSchema - Valibot schema for validation
 * @param schema - Valibot schema
 * @param data - Raw config data to validate
 * @returns Validated Config
 *
 * @throws {ConfigValidationException} If validation fails
 *
 * @example
 * ```typescript
 * const rawConfig = { nodeEnv: 'production', port: 3000 };
 * const config = validateConfig(schema, rawConfig);
 * ```
 */
export function validateConfig<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
  schema: TSchema,
  data: Record<string, unknown>
): Config<TSchema> {
  try {
    const validated = parse(schema, data);
    return new ConfigImpl<TSchema>(validated);
  } catch (error) {
    throw new ConfigValidationException(
      'Configuration validation failed',
      (error as { issues?: unknown[] }).issues || []
    );
  }
}
