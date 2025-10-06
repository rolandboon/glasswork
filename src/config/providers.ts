/**
 * Built-in configuration providers for common sources.
 *
 * @module config/providers
 */

import type { ConfigProvider } from './types.js';

/**
 * Options for the environment variable provider.
 */
export interface EnvProviderOptions {
  /**
   * Optional prefix to filter environment variables.
   * Only variables starting with this prefix will be included.
   *
   * @example 'APP_' // Only include APP_* variables
   */
  prefix?: string;

  /**
   * Whether to remove the prefix from the key names.
   * Only applies if prefix is set.
   *
   * @default true
   */
  removePrefix?: boolean;
}

/**
 * Creates a provider that loads configuration from process.env.
 *
 * @param options - Options for filtering/transforming env vars
 * @returns ConfigProvider
 *
 * @example
 * ```typescript
 * // Load all env vars
 * envProvider()
 *
 * // Load only APP_* env vars and remove prefix
 * envProvider({ prefix: 'APP_', removePrefix: true })
 * ```
 */
export function envProvider(options: EnvProviderOptions = {}): ConfigProvider {
  return async () => {
    const { prefix, removePrefix = true } = options;
    const config: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;

      // No prefix filter - include all
      if (!prefix) {
        config[key] = value;
        continue;
      }

      // With prefix filter
      if (key.startsWith(prefix)) {
        const cleanKey = removePrefix ? key.slice(prefix.length) : key;
        config[cleanKey] = value;
      }
    }

    return config;
  };
}

/**
 * Options for the .env file provider.
 */
export interface DotenvProviderOptions {
  /**
   * Path to the .env file to load.
   *
   * @default '.env'
   */
  path?: string;

  /**
   * Whether to override existing environment variables.
   *
   * @default false
   */
  override?: boolean;

  /**
   * Encoding of the .env file.
   *
   * @default 'utf8'
   */
  encoding?: BufferEncoding;
}

/**
 * Creates a provider that loads configuration from a .env file.
 *
 * Uses the classic `dotenv` package for parsing.
 * Install with: npm install dotenv
 *
 * @param options - Options for loading .env file
 * @returns ConfigProvider
 *
 * @example
 * ```typescript
 * // Load from .env
 * dotenvProvider()
 *
 * // Load from specific file
 * dotenvProvider({ path: '.env.local' })
 * ```
 */
export function dotenvProvider(options: DotenvProviderOptions = {}): ConfigProvider {
  return async () => {
    const { path = '.env', encoding = 'utf8' } = options;

    try {
      // Dynamic import to keep it optional
      const fs = await import('node:fs');
      const dotenv = await import('dotenv');

      const content = fs.readFileSync(path, { encoding });
      const parsed = dotenv.parse(content);

      return parsed;
    } catch (error) {
      // If file doesn't exist or dotenv not installed, return empty config
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      if ((error as Error).message?.includes('Cannot find package')) {
        throw new Error('dotenv package not found. Install with: npm install dotenv');
      }
      throw error;
    }
  };
}

/**
 * Options for the AWS SSM Parameter Store provider.
 */
export interface SsmProviderOptions {
  /**
   * Path prefix for parameters to fetch from SSM.
   * If provided, fetches all parameters under this path.
   *
   * @example '/app/config'
   */
  path?: string;

  /**
   * Specific parameter names to fetch.
   * Alternative to using path for fetching individual parameters.
   *
   * @example ['DATABASE_URL', 'API_KEY']
   */
  names?: string[];

  /**
   * AWS region for SSM client.
   *
   * @default process.env.AWS_REGION || 'us-east-1'
   */
  region?: string;

  /**
   * Whether to decrypt SecureString parameters.
   *
   * @default true
   */
  withDecryption?: boolean;

  /**
   * Whether to remove the path prefix from parameter names.
   * Only applies when using path option.
   *
   * @default true
   *
   * @example
   * // With removePrefix: true
   * // /app/config/DATABASE_URL -> DATABASE_URL
   * // With removePrefix: false
   * // /app/config/DATABASE_URL -> /app/config/DATABASE_URL
   */
  removePrefix?: boolean;
}

/**
 * Fetches parameters from SSM by path.
 */
async function fetchParametersByPath(
  client: unknown,
  path: string,
  withDecryption: boolean,
  removePrefix: boolean
): Promise<Record<string, unknown>> {
  const { GetParametersByPathCommand } = await import('@aws-sdk/client-ssm');
  const config: Record<string, unknown> = {};
  let nextToken: string | undefined;

  do {
    const command = new GetParametersByPathCommand({
      Path: path,
      Recursive: true,
      WithDecryption: withDecryption,
      NextToken: nextToken,
    });

    const response = await (
      client as {
        send: (cmd: unknown) => Promise<{
          Parameters?: Array<{ Name?: string; Value?: string }>;
          NextToken?: string;
        }>;
      }
    ).send(command);

    for (const param of response.Parameters || []) {
      if (!param.Name || !param.Value) continue;

      const key = removePrefix ? param.Name.replace(path, '').replace(/^\/+/, '') : param.Name;

      config[key] = param.Value;
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return config;
}

/**
 * Fetches specific parameters from SSM by name.
 */
async function fetchParametersByName(
  client: unknown,
  names: string[],
  withDecryption: boolean
): Promise<Record<string, unknown>> {
  const { GetParametersCommand } = await import('@aws-sdk/client-ssm');
  const config: Record<string, unknown> = {};

  const command = new GetParametersCommand({
    Names: names,
    WithDecryption: withDecryption,
  });

  const response = await (
    client as {
      send: (cmd: unknown) => Promise<{
        Parameters?: Array<{ Name?: string; Value?: string }>;
      }>;
    }
  ).send(command);

  for (const param of response.Parameters || []) {
    if (!param.Name || !param.Value) continue;
    config[param.Name] = param.Value;
  }

  return config;
}

/**
 * Creates a provider that loads configuration from AWS SSM Parameter Store.
 *
 * Requires AWS SDK to be installed:
 * npm install @aws-sdk/client-ssm
 *
 * @param options - Options for fetching SSM parameters
 * @returns ConfigProvider
 *
 * @example
 * ```typescript
 * // Fetch all parameters under a path
 * ssmProvider({ path: '/app/config' })
 *
 * // Fetch specific parameters
 * ssmProvider({ names: ['DATABASE_URL', 'API_KEY'] })
 * ```
 */
export function ssmProvider(options: SsmProviderOptions): ConfigProvider {
  return async () => {
    const {
      path,
      names,
      region = process.env.AWS_REGION || 'us-east-1',
      withDecryption = true,
      removePrefix = true,
    } = options;

    if (!path && !names) {
      throw new Error('ssmProvider requires either "path" or "names" option');
    }

    try {
      // Dynamic import to keep AWS SDK optional
      const { SSMClient } = await import('@aws-sdk/client-ssm');
      const client = new SSMClient({ region });

      if (path) {
        return await fetchParametersByPath(client, path, withDecryption, removePrefix);
      }

      if (names) {
        return await fetchParametersByName(client, names, withDecryption);
      }

      return {};
    } catch (error) {
      if ((error as Error).message?.includes('Cannot find package')) {
        throw new Error(
          '@aws-sdk/client-ssm package not found. Install with: npm install @aws-sdk/client-ssm'
        );
      }
      throw error;
    }
  };
}

/**
 * Creates a provider from a static object.
 * Useful for providing defaults or overrides.
 *
 * @param config - Static configuration object
 * @returns ConfigProvider
 *
 * @example
 * ```typescript
 * objectProvider({
 *   nodeEnv: 'development',
 *   port: 3000,
 * })
 * ```
 */
export function objectProvider(config: Record<string, unknown>): ConfigProvider {
  return async () => config;
}
