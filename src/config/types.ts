/**
 * Type definitions for configuration management.
 *
 * @module config/types
 */

import type { BaseIssue, BaseSchema, InferOutput } from 'valibot';

/**
 * A config provider loads configuration from a specific source.
 *
 * Providers are executed in order, with later providers overwriting
 * earlier ones. This allows for flexible precedence (e.g., SSM -> env -> .env).
 *
 * @example
 * ```typescript
 * const myProvider: ConfigProvider = async () => {
 *   return {
 *     apiKey: 'from-custom-source',
 *   };
 * };
 * ```
 */
export type ConfigProvider = () => Promise<Record<string, unknown>>;

/**
 * Options for creating a config service.
 *
 * @template TSchema - Valibot schema for config validation
 */
export interface ConfigOptions<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>> {
  /**
   * Valibot schema to validate the configuration.
   * The validated config will be fully typed based on this schema.
   */
  schema: TSchema;

  /**
   * Array of config providers to load from.
   * Providers are executed in order, with later providers taking precedence.
   *
   * @default [envProvider()]
   */
  providers?: ConfigProvider[];

  /**
   * Optional function to transform keys (e.g., convert to camelCase).
   *
   * @default undefined (no transformation)
   *
   * @example
   * ```typescript
   * // Convert SNAKE_CASE to camelCase
   * const transformKey = (key: string) =>
   *   key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
   * ```
   */
  transformKey?: (key: string) => string;

  /**
   * Whether to allow unknown keys in the config.
   * If false, validation will fail if extra keys are present.
   *
   * @default true
   */
  allowUnknownKeys?: boolean;
}

/**
 * A validated, type-safe configuration object.
 *
 * @template TSchema - Valibot schema used for validation
 */
export interface Config<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>> {
  /**
   * The validated configuration, fully typed based on the schema.
   */
  readonly data: InferOutput<TSchema>;

  /**
   * Get a config value by key with type safety.
   *
   * @param key - The config key to retrieve
   * @returns The config value
   *
   * @example
   * ```typescript
   * const dbUrl = config.get('databaseUrl');
   * ```
   */
  get<K extends keyof InferOutput<TSchema>>(key: K): InferOutput<TSchema>[K];

  /**
   * Get a config value by key with a fallback.
   *
   * @param key - The config key to retrieve
   * @param defaultValue - Value to return if key doesn't exist
   * @returns The config value or default
   *
   * @example
   * ```typescript
   * const port = config.getOrDefault('port', 3000);
   * ```
   */
  getOrDefault<K extends keyof InferOutput<TSchema>>(
    key: K,
    defaultValue: InferOutput<TSchema>[K]
  ): InferOutput<TSchema>[K];
}
