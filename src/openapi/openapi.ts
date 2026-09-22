import { writeFile } from 'node:fs/promises';
import type { Hono, MiddlewareHandler } from 'hono';
import { generateSpecs, openAPIRouteHandler } from 'hono-openapi';
import type { OpenAPIV3 } from 'openapi-types';
import type {
  Environment,
  MiddlewareOptions,
  OpenAPIOptions,
  RateLimitOptions,
} from '../core/types.js';
import { deepMerge } from '../utils/deep-merge.js';
import { createLogger } from '../utils/logger.js';
import { defaultOpenAPIComponents } from './defaults.js';

export interface ConfigureOpenAPIOptions {
  app: Hono;
  environment: Environment;
  openapi: OpenAPIOptions;
  rateLimit?: RateLimitOptions;
  middleware?: MiddlewareOptions;
}

/**
 * Result from configuring OpenAPI, includes optional write function.
 */
export interface ConfigureOpenAPIResult {
  /**
   * Write the OpenAPI spec to a file.
   * Call this after all routes have been registered.
   *
   * @returns Promise that resolves when the file has been written
   *
   * @example
   * ```typescript
   * const app = await bootstrap(config);
   * const { writeSpec } = configureOpenAPI({ app, ... });
   *
   * // After all routes are registered:
   * await writeSpec?.();
   * ```
   */
  writeSpec?: () => Promise<void>;
}

/**
 * Configure OpenAPI documentation for the application.
 *
 * Behavior by environment:
 * - development: Serve specs and UI at /api and /api/openapi.json
 * - production: No serving by default
 * - test: Disabled by default
 *
 * Note: Response processors are now configured in bootstrap.ts and stored
 * per-app instance via setOpenAPIContext. This eliminates global state.
 *
 * @param options - Configuration options
 * @returns Object with optional `writeSpec` function for writing the spec to file
 *
 * @example
 * ```typescript
 * // Configure first, then explicitly write after routes are registered.
 * const { writeSpec } = configureOpenAPI({ app, environment, openapi });
 * // ... register all routes ...
 * await writeSpec?.();
 * ```
 */
export function configureOpenAPI(options: ConfigureOpenAPIOptions): ConfigureOpenAPIResult {
  const { app, environment, openapi, rateLimit, middleware } = options;

  if (!openapi.enabled) {
    return {};
  }

  // Use 'error' level so errors are always logged (even in test mode)
  // This ensures OpenAPI spec writing errors are visible
  const logger = createLogger('Glasswork:OpenAPI', 'error');

  const shouldServeSpecs = openapi.serveSpecs ?? environment === 'development';
  const shouldServeUI = openapi.serveUI ?? environment === 'development';

  // Filter components based on enabled features (only include headers that are actually used)
  const filteredComponents = filterComponentsByFeatures(defaultOpenAPIComponents, {
    rateLimitEnabled: rateLimit?.enabled ?? false,
    corsEnabled: !!middleware?.cors,
  });

  // Merge application documentation with filtered Glasswork defaults
  const mergedDocumentation = deepMerge(
    { components: filteredComponents },
    openapi.documentation || {}
  );

  // Serve OpenAPI spec endpoint (development only by default)
  if (shouldServeSpecs) {
    app.get('/api/openapi.json', openAPIRouteHandler(app, { documentation: mergedDocumentation }));
  }

  // Serve Swagger UI (development only by default)
  if (shouldServeUI) {
    let handlerPromise: Promise<MiddlewareHandler> | undefined;
    app.get('/api', async (c, next) => {
      handlerPromise ??= import('@hono/swagger-ui')
        .then(({ swaggerUI }) => swaggerUI({ url: '/api/openapi.json' }))
        .catch((cause: unknown) => {
          throw new Error(
            'Unable to load Swagger UI. Install the optional peer with: npm install @hono/swagger-ui',
            { cause }
          );
        });
      const handler = await handlerPromise;
      return handler(c, next);
    });
  }

  // Create writeSpec function if file writing is configured
  let writeSpec: (() => Promise<void>) | undefined;

  if (openapi.writeToFile) {
    const filePath = openapi.writeToFile;

    writeSpec = async () => {
      const spec = await generateSpecs(app, { documentation: mergedDocumentation });
      await writeFile(filePath, JSON.stringify(spec, null, 2), 'utf-8');
      logger.info(`OpenAPI spec written to ${filePath}`);
    };
  }

  return { writeSpec };
}

/**
 * Filter component headers based on enabled features.
 * This removes header definitions from the components schema that won't be used.
 */
function filterComponentsByFeatures(
  components: OpenAPIV3.ComponentsObject,
  features: { rateLimitEnabled: boolean; corsEnabled: boolean }
): OpenAPIV3.ComponentsObject {
  if (!components.headers) {
    return components;
  }

  const filteredHeaders = Object.fromEntries(
    Object.entries(components.headers).filter(([name]) => shouldIncludeHeader(name, features))
  );

  return {
    ...components,
    headers: filteredHeaders,
  };
}

/**
 * Determine if a header should be included based on feature configuration
 */
function shouldIncludeHeader(
  headerName: string,
  { rateLimitEnabled, corsEnabled }: { rateLimitEnabled: boolean; corsEnabled: boolean }
): boolean {
  // Always include pagination headers (they're route-specific, not feature-gated)
  if (headerName.startsWith('X-')) {
    return true;
  }

  // Include CORS headers only if CORS is enabled
  if (headerName === 'Access-Control-Allow-Origin') {
    return corsEnabled;
  }

  // Include rate limit headers only if rate limiting is enabled
  if (headerName.startsWith('RateLimit-') || headerName === 'Retry-After') {
    return rateLimitEnabled;
  }

  // Include other headers by default
  return true;
}
