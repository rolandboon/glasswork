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

export interface ConfigureOpenAPIOptions {
  app: Hono;
  environment: Environment;
  openapi: OpenAPIOptions;
  rateLimit?: RateLimitOptions;
  middleware?: MiddlewareOptions;
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
 */
export function configureOpenAPI(options: ConfigureOpenAPIOptions): void {
  const { app, environment, openapi, rateLimit, middleware } = options;

  if (!openapi.enabled) {
    return;
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

  // Write OpenAPI spec to file (optional)
  if (openapi.writeToFile) {
    const filePath = openapi.writeToFile;
    // Generate spec and write to file
    // This happens after routes are registered
    setTimeout(async () => {
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
    }, 1000); // Wait for routes to be registered
  }
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
