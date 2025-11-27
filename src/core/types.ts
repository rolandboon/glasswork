import type { AwilixContainer } from 'awilix';
import type { ErrorHandler, Hono } from 'hono';

/**
 * Service lifetime scope for dependency injection
 */
export type ServiceScope = 'SINGLETON' | 'SCOPED' | 'TRANSIENT';

/**
 * Constructor type for class providers
 *
 * We use `any[]` for constructor arguments because in dependency injection,
 * we can't know at compile time what arguments will be injected - that's
 * determined by the DI container at runtime. This is a legitimate use of `any`.
 */
// biome-ignore lint/suspicious/noExplicitAny: DI requires dynamic argument resolution
export type Constructor<T = unknown> = new (...args: any[]) => T;

/**
 * Interface for modules/services that need to run initialization logic.
 *
 * **Lifecycle:**
 * - Called after all providers are registered in the DI container
 * - Called before the application starts accepting requests
 * - Executed in parallel with other services' onModuleInit hooks
 *
 * **Error Handling:**
 * - If this hook throws an error, the application will fail to start
 * - Errors are logged with the service name for debugging
 *
 * **Use Cases:**
 * - Establishing database connections
 * - Initializing cache connections (Redis, Memcached)
 * - Loading configuration from remote sources
 * - Subscribing to event streams
 *
 * @example
 * ```typescript
 * export class DatabaseService implements OnModuleInit {
 *   private connection: Connection | null = null;
 *
 *   async onModuleInit() {
 *     this.connection = await createConnection({
 *       host: process.env.DB_HOST,
 *     });
 *   }
 * }
 * ```
 */
export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}

/**
 * Interface for modules/services that need to run cleanup logic.
 *
 * **Lifecycle:**
 * - Called when the application is shutting down (via app.stop())
 * - Executed in parallel with other services' onModuleDestroy hooks
 *
 * **Error Handling:**
 * - Errors are logged but do not prevent other services from cleaning up
 * - Best practice: Use try-catch within your hook to prevent errors
 *
 * **Use Cases:**
 * - Closing database connections
 * - Disconnecting from cache services
 * - Flushing queued data
 * - Gracefully shutting down background workers
 *
 * @example
 * ```typescript
 * export class DatabaseService implements OnModuleDestroy {
 *   async onModuleDestroy() {
 *     await this.connection?.close();
 *   }
 * }
 * ```
 */
export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>;
}

/**
 * Provider configuration for dependency injection
 */
export type ProviderConfig =
  | Constructor
  | {
      provide: string | Constructor;
      useClass: Constructor;
      scope?: ServiceScope;
    }
  | {
      provide: string;
      useValue: unknown;
    }
  | {
      provide: string;
      // biome-ignore lint/suspicious/noExplicitAny: DI requires dynamic argument resolution
      useFactory: (dependencies: any) => unknown;
      inject?: string[];
      scope?: ServiceScope;
    };

/**
 * Route factory function that receives Hono router, services, and optionally a bound route function.
 *
 * The `route` parameter is a pre-bound route function that knows about the router's
 * OpenAPI context, so you don't need to pass the router to every route call.
 *
 * When using `createRoutes`, the route function is automatically provided.
 * When using `defineModule` with inline routes, the route function is also provided.
 */
export type RouteFactory = (
  router: Hono,
  services: Record<string, unknown>,
  // biome-ignore lint/suspicious/noExplicitAny: route function type is defined in route-helpers.ts
  route?: any
) => void;

/**
 * Module configuration
 */
export interface ModuleConfig {
  /**
   * Unique module name
   */
  name: string;

  /**
   * Base path for routes (e.g., 'auth' becomes /api/auth)
   */
  basePath?: string;

  /**
   * Service providers to register
   */
  providers?: ProviderConfig[];

  /**
   * Modules to import (access their exported providers)
   */
  imports?: ModuleConfig[];

  /**
   * Providers to export (available to importing modules)
   */
  exports?: (Constructor | string)[];

  /**
   * Route factory function
   */
  routes?: RouteFactory;
}

/**
 * Environment type for conditional behavior
 */
export type Environment = 'development' | 'production' | 'test';

/**
 * OpenAPI documentation configuration
 */
export interface OpenAPIDocumentation {
  info: {
    title: string;
    version: string;
    description?: string;
    contact?: {
      name?: string;
      email?: string;
      url?: string;
    };
  };
  tags?: Array<{ name: string; description?: string }>;
  servers?: Array<{ url: string; description?: string }>;
  components?: Record<string, unknown>;
}

/**
 * OpenAPI response object structure
 */
export interface OpenAPIResponseObject {
  description: string;
  headers?: Record<string, { $ref: string }>;
  content?: Record<string, unknown>;
}

/**
 * Context passed to OpenAPI response processors
 */
export interface OpenAPIProcessorContext {
  statusCode: string;
  routeConfig: RouteConfigExtensions & {
    public?: boolean;
    tags?: string[];
    summary?: string;
    openapi?: {
      responseHeaders?: string[] | Record<string, string[]>;
    };
  };
  /** Whether the route query schema includes pagination fields (page, pageSize) */
  hasPagination: boolean;
}

/**
 * Processor function for customizing OpenAPI responses
 *
 * Receives the response object and context, returns modified response.
 * Processors are applied in order to each response object.
 * Use this to add custom headers, modify descriptions, etc.
 *
 * @example
 * ```typescript
 * // Custom processor for Server-Timing header
 * const serverTimingProcessor: OpenAPIResponseProcessor = (response, context) => {
 *   if (context.routeConfig.serverTiming) {
 *     return {
 *       ...response,
 *       headers: {
 *         ...response.headers,
 *         'Server-Timing': { $ref: '#/components/headers/Server-Timing' }
 *       }
 *     };
 *   }
 *   return response;
 * };
 * ```
 */
export type OpenAPIResponseProcessor = (
  response: OpenAPIResponseObject,
  context: OpenAPIProcessorContext
) => OpenAPIResponseObject;

/**
 * Extension interface for custom route configuration properties.
 *
 * Framework users can augment this interface to add custom flags
 * that can be processed by custom OpenAPI response processors.
 *
 * @example
 * ```typescript
 * // In your application's type declarations
 * declare module 'glasswork' {
 *   interface RouteConfigExtensions {
 *     serverTiming?: boolean;
 *     apiVersion?: string;
 *   }
 * }
 *
 * // Then use in routes
 * route({
 *   serverTiming: true,
 *   apiVersion: '2.0',
 *   handler: ...
 * });
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Designed for module augmentation
export interface RouteConfigExtensions {}

/**
 * OpenAPI configuration options
 */
export interface OpenAPIOptions {
  /**
   * Whether to enable OpenAPI generation
   */
  enabled?: boolean;

  /**
   * Serve OpenAPI specs at /api/openapi.json (default: true in development)
   */
  serveSpecs?: boolean;

  /**
   * Serve Swagger UI at /api (default: true in development)
   */
  serveUI?: boolean;

  /**
   * Write OpenAPI specs to file (path relative to cwd)
   */
  writeToFile?: string;

  /**
   * OpenAPI documentation
   */
  documentation?: OpenAPIDocumentation;

  /**
   * Response processors for customizing OpenAPI responses.
   *
   * Processors are applied in order to each response object after built-in processors.
   * Use this to add custom headers based on custom route config flags.
   *
   * Built-in processors (auto-enabled based on config):
   * - CORS headers: Added when middleware.cors is configured
   * - Rate limit headers: Added when rateLimit.enabled is true
   * - Pagination headers: Added when route query schema has pagination fields
   * - Response headers: Added when route has openapi.responseHeaders
   *
   * @example
   * ```typescript
   * // Custom processor for Server-Timing header
   * responseProcessors: [
   *   (response, { routeConfig }) => {
   *     if (routeConfig.serverTiming) {
   *       return {
   *         ...response,
   *         headers: {
   *           ...response.headers,
   *           'Server-Timing': { $ref: '#/components/headers/Server-Timing' }
   *         }
   *       };
   *     }
   *     return response;
   *   }
   * ]
   * ```
   */
  responseProcessors?: OpenAPIResponseProcessor[];
}

/**
 * Rate limiting storage backend
 */
export type RateLimitStorage = 'memory' | 'dynamodb';

/**
 * Rate limiting configuration
 */
export interface RateLimitOptions {
  /**
   * Whether rate limiting is enabled
   */
  enabled: boolean;

  /**
   * Storage backend
   */
  storage: RateLimitStorage;

  /**
   * Rate limit window in milliseconds (default: 60000 = 1 minute)
   */
  windowMs?: number;

  /**
   * Maximum requests per window (default: 100)
   */
  maxRequests?: number;

  /**
   * DynamoDB configuration (required if storage is 'dynamodb')
   */
  dynamodb?: {
    tableName: string;
    region?: string;
  };
}

/**
 * Middleware configuration options
 */
export interface MiddlewareOptions {
  /**
   * Enable request ID middleware
   * @default true
   */
  requestId?: boolean;

  /**
   * Enable secure headers middleware
   * @default true in production
   */
  secureHeaders?: boolean;

  /**
   * CORS configuration
   */
  cors?: {
    origin: string | string[];
    credentials?: boolean;
  };
}

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /**
   * Enable HTTP request logging
   * @default true
   */
  enabled?: boolean;

  /**
   * Use plain logger (no ANSI colors) for Lambda/CloudWatch
   * Auto-detected based on environment if not specified
   */
  plain?: boolean;
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  /**
   * Environment (auto-detected from NODE_ENV if not provided)
   */
  environment?: Environment;

  /**
   * API base path (default: '/api')
   */
  apiBasePath?: string;

  /**
   * Error handler middleware
   * Set to false to disable default error handler
   * Provide a custom ErrorHandler to override
   * @default Glasswork's default error handler
   */
  errorHandler?: ErrorHandler | false;

  /**
   * OpenAPI configuration
   */
  openapi?: OpenAPIOptions;

  /**
   * Rate limiting configuration
   */
  rateLimit?: RateLimitOptions;

  /**
   * Common middleware configuration
   */
  middleware?: MiddlewareOptions;

  /**
   * Logger configuration
   */
  logger?: LoggerOptions;

  /**
   * Enable debug logging
   */
  debug?: boolean;
}

/**
 * Bootstrap result
 */
export interface BootstrapResult {
  /**
   * Hono application instance
   */
  app: Hono;

  /**
   * Awilix container (fully accessible)
   */
  container: AwilixContainer;

  /**
   * Start the application (run lifecycle hooks)
   */
  start: () => Promise<void>;

  /**
   * Stop the application (run lifecycle hooks)
   */
  stop: () => Promise<void>;
}
