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
 * Route factory function that receives Hono router and services
 */
export type RouteFactory = (router: Hono, services: Record<string, unknown>) => void;

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
 * Hook function for customizing OpenAPI responses
 *
 * Receives the response object and context, returns modified response.
 * This allows both framework and applications to add headers, modify
 * descriptions, etc. globally across all routes.
 */
export type OpenAPIResponseHook = (
  response: {
    description: string;
    headers?: Record<string, { $ref: string }>;
    content?: Record<string, unknown>;
  },
  context: {
    statusCode: string;
    routeConfig: {
      public?: boolean;
      paginate?: boolean;
      tags?: string[];
      summary?: string;
    };
  }
) => {
  description: string;
  headers?: Record<string, { $ref: string }>;
  content?: Record<string, unknown>;
};

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
   * Response hooks for customizing OpenAPI responses
   *
   * Hooks are applied in order to each response object.
   * Use this to add custom headers, modify descriptions, etc.
   */
  responseHooks?: OpenAPIResponseHook[];
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
}
