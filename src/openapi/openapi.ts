import { writeFile } from 'node:fs/promises';
import { swaggerUI } from '@hono/swagger-ui';
import type { Hono } from 'hono';
import { openAPIRouteHandler } from 'hono-openapi';
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import type {
  Environment,
  MiddlewareOptions,
  OpenAPIOptions,
  RateLimitOptions,
} from '../core/types.js';
import { deepMerge } from '../utils/deep-merge.js';
import { createLogger } from '../utils/logger.js';
import { defaultOpenAPIComponents } from './defaults.js';

/** Default delay before writing OpenAPI spec (ms). Allows routes to register. */
const DEFAULT_WRITE_DELAY_MS = 1000;

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
 * // Basic usage (auto-write with delay)
 * configureOpenAPI({ app, environment, openapi });
 *
 * // Explicit write after routes are registered (recommended)
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

  const logger = createLogger('Glasswork:OpenAPI', true);

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
    app.get('/api', swaggerUI({ url: '/api/openapi.json' }));
  }

  // Create writeSpec function if file writing is configured
  let writeSpec: (() => Promise<void>) | undefined;

  if (openapi.writeToFile) {
    const filePath = openapi.writeToFile;

    writeSpec = async () => {
      try {
        let specContent: string;

        if (shouldServeSpecs) {
          // Use Hono's built-in request method to simulate the request
          const response = await app.request('/api/openapi.json');
          specContent = await response.text();
        } else {
          // If not serving specs, generate manually
          // Mount a temporary internal endpoint
          app.get(
            '/api/openapi-internal.json',
            openAPIRouteHandler(app, { documentation: mergedDocumentation })
          );
          const response = await app.request('/api/openapi-internal.json');
          const spec = (await response.json()) as OpenAPIV3_1.Document;
          specContent = JSON.stringify(spec, null, 2);
        }

        await writeFile(filePath, specContent, 'utf-8');
        logger.info(`OpenAPI spec written to ${filePath}`);
      } catch (error) {
        logger.error('Failed to write OpenAPI spec:', error);
      }
    };

    // Auto-write with delay for backward compatibility
    // NOTE: For more reliable writes, call writeSpec() explicitly after registering routes
    setTimeout(() => {
      writeSpec?.();
    }, DEFAULT_WRITE_DELAY_MS);
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
