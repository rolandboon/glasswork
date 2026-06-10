import type { AwilixContainer } from 'awilix';
import { createContainer, InjectionMode } from 'awilix';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { createErrorHandler, defaultErrorHandler } from '../http/error-handler.js';
import { type OpenAPIContext, route, setOpenAPIContext } from '../http/route-helpers.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { createPinoHttpMiddleware } from '../observability/pino-logger.js';
import { createRequestContextMiddleware } from '../observability/request-context.js';
import { configureOpenAPI } from '../openapi/openapi.js';
import { createBuiltinProcessors } from '../openapi/openapi-processors.js';
import { isLambda, isTest } from '../utils/environment.js';
import {
  createLogger,
  createPlainLogger,
  getDefaultLogLevel,
  type LogLevel,
} from '../utils/logger.js';
import { executeLifecycleHooks } from './lifecycle.js';
import {
  collectModules,
  registerModuleProviders,
  resolveAsyncFactoryProviders,
  validateNoCycles,
} from './module-graph.js';
import type {
  BootstrapOptions,
  BootstrapResult,
  Environment,
  LoggerOptions,
  MiddlewareOptions,
  ModuleConfig,
  OpenAPIOptions,
  OpenAPIResponseProcessor,
  RateLimitOptions,
  RouteBinder,
} from './types.js';

/**
 * Detect environment from NODE_ENV or AWS Lambda context
 */
function detectEnvironment(): Environment {
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv === 'production') {
    return 'production';
  }

  if (nodeEnv === 'test') {
    return 'test';
  }

  // Check if running in AWS Lambda
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) {
    return 'production';
  }

  return 'development';
}

/**
 * Bootstrap the application with modules.
 *
 * This function:
 * 1. Creates an Awilix container (PROXY mode for Lambda compatibility)
 * 2. Registers all module providers
 * 3. Creates a Hono app
 * 4. Applies rate limiting middleware (if configured)
 * 5. Configures OpenAPI (environment-aware)
 * 6. Mounts module routes
 * 7. Returns both app and container (container remains accessible!)
 *
 * Features:
 * - Automatic environment detection (development/production/test)
 * - OpenAPI generation and serving (environment-aware)
 * - Rate limiting with pluggable storage (memory/DynamoDB)
 * - Module system with dependency injection
 *
 * @example
 * ```typescript
 * const { app, container } = bootstrap(AppModule, {
 *   openapi: {
 *     enabled: true,
 *     documentation: { ... }
 *   },
 *   rateLimit: {
 *     enabled: true,
 *     storage: 'memory'
 *   }
 * });
 *
 * // Container is still accessible for advanced use
 * console.log(container.cradle.authService);
 * container.register({ customService: asClass(CustomService) });
 * ```
 */
export async function bootstrap(
  rootModule: ModuleConfig,
  options: BootstrapOptions = {}
): Promise<BootstrapResult> {
  const {
    apiBasePath = '/api',
    debug = false,
    environment = detectEnvironment(),
    errorHandler = defaultErrorHandler,
    openapi,
    rateLimit,
    middleware,
    logger,
    exceptionTracking,
  } = options;

  // Create logger for bootstrap process
  // Convert debug boolean to log level: debug=true -> 'debug', debug=false -> default level
  // In test mode, use silent unless debug=true is explicitly set (for testing/debugging)
  const bootstrapLogLevel: LogLevel = debug ? 'debug' : isTest() ? 'silent' : getDefaultLogLevel();
  const bootstrapLogger = createLogger('Glasswork', bootstrapLogLevel);

  // Create Awilix container with PROXY mode (Lambda-compatible)
  const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  bootstrapLogger.debug('Bootstrapping application...');

  // Collect all modules (flatten imports)
  const allModules = collectModules(rootModule);

  bootstrapLogger.debug(
    `Found ${allModules.length} modules: ${allModules.map((m) => m.name).join(', ')}`
  );

  // Validate no circular dependencies
  validateNoCycles(allModules);

  // Register all providers and collect async factory names
  const asyncFactoryNames: string[] = [];
  for (const module of allModules) {
    bootstrapLogger.debug(`Registering module: ${module.name}`);
    const moduleAsyncFactories = registerModuleProviders(module, container, bootstrapLogger);
    asyncFactoryNames.push(...moduleAsyncFactories);
  }

  // Resolve async factories and re-register them as values
  // This ensures all async providers are fully initialized before bootstrap completes
  if (asyncFactoryNames.length > 0) {
    bootstrapLogger.debug(`Resolving ${asyncFactoryNames.length} async factory providers...`);
    await resolveAsyncFactoryProviders(container, asyncFactoryNames, bootstrapLogger);
  }

  // Create Hono app and apply middleware
  const { app, openAPIContext } = createApp({
    environment,
    errorHandler,
    openapi,
    rateLimit,
    middleware,
    logger,
    exceptionTracking,
    bootstrapLogger,
  });

  // Mount module routes
  mountModuleRoutes({
    app,
    modules: allModules,
    container,
    apiBasePath,
    bootstrapLogger,
    openAPIContext,
  });

  bootstrapLogger.debug('Bootstrap complete');
  bootstrapLogger.debug(`Environment: ${environment}`);
  bootstrapLogger.debug(`Registered ${Object.keys(container.cradle).length} services`);

  // State tracking for idempotency
  let isStarted = false;
  let isStopped = false;

  // Define start and stop functions
  const start = async () => {
    if (isStarted) {
      bootstrapLogger.debug('Application already started, skipping onModuleInit');
      return;
    }
    isStarted = true;
    bootstrapLogger.debug('Starting application (running onModuleInit)...');
    await executeLifecycleHooks(container, 'onModuleInit', bootstrapLogger);
    bootstrapLogger.debug('Application started successfully');
  };

  const stop = async () => {
    if (isStopped) {
      bootstrapLogger.debug('Application already stopped, skipping onModuleDestroy');
      return;
    }
    isStopped = true;
    bootstrapLogger.debug('Stopping application (running onModuleDestroy)...');
    await executeLifecycleHooks(container, 'onModuleDestroy', bootstrapLogger);
    bootstrapLogger.debug('Application stopped successfully');
  };

  // Auto-start in production/development (but not test)
  // This ensures providers are initialized before requests come in
  if (environment !== 'test') {
    await start();
  }

  return { app, container, start, stop };
}

/**
 * Create Hono app and apply middleware
 */
function createApp(options: {
  environment: Environment;
  errorHandler: false | import('hono').ErrorHandler;
  openapi?: OpenAPIOptions;
  rateLimit?: RateLimitOptions;
  middleware?: MiddlewareOptions;
  logger?: LoggerOptions;
  exceptionTracking?: import('./types.js').ExceptionTrackingOptions;
  bootstrapLogger: import('../utils/logger.js').Logger;
}): { app: Hono; openAPIContext: OpenAPIContext } {
  const app = new Hono();

  // Build OpenAPI context with processors
  const openAPIContext = buildOpenAPIContext(options);
  setOpenAPIContext(app, openAPIContext);

  applyErrorHandler(app, options);
  applySecurityMiddleware(app, options);
  applyLoggingMiddleware(app, options);
  applyRateLimiting(app, options);
  applyOpenAPIDocumentation(app, options);

  return { app, openAPIContext };
}

/**
 * Build the OpenAPI context with processors and security schemes
 */
function buildOpenAPIContext(options: {
  openapi?: OpenAPIOptions;
  rateLimit?: RateLimitOptions;
  middleware?: MiddlewareOptions;
  logger?: LoggerOptions;
}): OpenAPIContext {
  const { openapi, rateLimit, middleware, logger } = options;

  // Create built-in processors based on config
  const builtinProcessors = createBuiltinProcessors({
    corsEnabled: !!middleware?.cors,
    rateLimitEnabled: !!rateLimit?.enabled,
  });

  // Combine with user-provided processors
  const userProcessors: OpenAPIResponseProcessor[] = openapi?.responseProcessors ?? [];
  const processors = [...builtinProcessors, ...userProcessors];

  // Extract security scheme names from documentation
  const securitySchemes: string[] = [];
  const components = openapi?.documentation?.components as
    | { securitySchemes?: Record<string, unknown> }
    | undefined;

  if (components?.securitySchemes) {
    securitySchemes.push(...Object.keys(components.securitySchemes));
  }

  return { processors, securitySchemes, pino: logger?.pino };
}

/**
 * Apply error handler to the app
 */
function applyErrorHandler(
  app: Hono,
  {
    errorHandler,
    exceptionTracking,
    bootstrapLogger,
  }: {
    errorHandler: false | import('hono').ErrorHandler;
    exceptionTracking?: import('./types.js').ExceptionTrackingOptions;
    bootstrapLogger: import('../utils/logger.js').Logger;
  }
): void {
  if (errorHandler === false) return;

  // If using default error handler and exception tracking is configured, create custom handler
  if (errorHandler === defaultErrorHandler && exceptionTracking) {
    bootstrapLogger.debug('Applying error handler with exception tracking');
    const customErrorHandler = createErrorHandler({
      exceptionTracker: exceptionTracking.tracker,
      trackingConfig: {
        trackStatusCodes: exceptionTracking.trackStatusCodes ?? ((status) => status >= 500),
      },
    });
    app.onError(customErrorHandler);
  } else {
    bootstrapLogger.debug('Applying error handler');
    app.onError(errorHandler);
  }
}

/**
 * Apply security-related middleware (secure headers, request ID, CORS)
 */
function applySecurityMiddleware(
  app: Hono,
  {
    environment,
    middleware,
    bootstrapLogger,
  }: {
    environment: Environment;
    middleware?: MiddlewareOptions;
    bootstrapLogger: import('../utils/logger.js').Logger;
  }
): void {
  // Expose trustProxy flag for downstream utilities (getClientIp, rate limiter)
  app.use('*', async (c, next) => {
    c.set('trustProxy', middleware?.trustProxy === true);
    await next();
  });

  // Secure headers (default: true in production)
  if (middleware?.secureHeaders !== false && environment === 'production') {
    bootstrapLogger.debug('Applying secure headers');
    app.use(secureHeaders());
  }

  // Request ID (default: true)
  if (middleware?.requestId !== false) {
    bootstrapLogger.debug('Applying request ID middleware');
    app.use(requestId());
  }

  // CORS
  if (middleware?.cors) {
    bootstrapLogger.debug('Applying CORS middleware');
    app.use(cors(middleware.cors));
  }
}

/**
 * Apply logging middleware
 */
function applyLoggingMiddleware(
  app: Hono,
  {
    logger,
    bootstrapLogger,
  }: { logger?: LoggerOptions; bootstrapLogger: import('../utils/logger.js').Logger }
): void {
  if (logger?.enabled === false) return;

  // If Pino logger instance provided, use structured logging with request context
  if (logger?.pino) {
    bootstrapLogger.debug('Applying Pino logger with request context (AsyncLocalStorage)');

    // Apply request context middleware first (sets up AsyncLocalStorage)
    app.use(createRequestContextMiddleware());

    // Apply Pino HTTP logging middleware
    app.use(createPinoHttpMiddleware(logger.pino));
    return;
  }

  // In test mode, skip HTTP logging unless explicitly enabled
  if (isTest()) {
    return;
  }

  // Default: Use plain logger for Lambda or colored logger for development
  const usePlainLogger = isLambda();
  bootstrapLogger.debug(`Applying built-in logger (plain: ${usePlainLogger})`);
  app.use(usePlainLogger ? createPlainLogger() : honoLogger());
}

/**
 * Apply rate limiting middleware
 */
function applyRateLimiting(
  app: Hono,
  {
    rateLimit,
    bootstrapLogger,
  }: { rateLimit?: RateLimitOptions; bootstrapLogger: import('../utils/logger.js').Logger }
): void {
  if (!rateLimit?.enabled) return;

  bootstrapLogger.debug(
    `Rate limiting enabled (${rateLimit.storage} storage, ${rateLimit.maxRequests || 100} req/${rateLimit.windowMs || 60000}ms)`
  );
  app.use(createRateLimitMiddleware(rateLimit));
}

/**
 * Apply OpenAPI documentation
 */
function applyOpenAPIDocumentation(
  app: Hono,
  options: {
    environment: Environment;
    openapi?: OpenAPIOptions;
    rateLimit?: RateLimitOptions;
    middleware?: MiddlewareOptions;
    bootstrapLogger: import('../utils/logger.js').Logger;
  }
): void {
  const { environment, openapi, rateLimit, middleware, bootstrapLogger } = options;

  if (!openapi?.enabled) return;

  bootstrapLogger.debug('Configuring OpenAPI');
  configureOpenAPI({ app, environment, openapi, rateLimit, middleware });
}

/**
 * Mount module routes to the app
 */
function mountModuleRoutes(options: {
  app: Hono;
  modules: ModuleConfig[];
  container: AwilixContainer;
  apiBasePath: string;
  bootstrapLogger: import('../utils/logger.js').Logger;
  openAPIContext: OpenAPIContext;
}): void {
  const { app, modules, container, apiBasePath, bootstrapLogger, openAPIContext } = options;

  for (const module of modules) {
    if (!module.routes || !module.basePath) {
      continue;
    }

    bootstrapLogger.debug(`Mounting routes: ${apiBasePath}/${module.basePath}`);

    const router = new Hono();

    // Set OpenAPI context on the router so routes can access it
    setOpenAPIContext(router, openAPIContext);

    // Create a bound route function for this router
    const boundRoute = <T extends Parameters<typeof route>[1]>(config: T) => route(router, config);

    // Normalize routes to array and call each factory
    const routeFactories = Array.isArray(module.routes) ? module.routes : [module.routes];
    for (const routeFactory of routeFactories) {
      routeFactory(router, container.cradle as Record<string, unknown>, boundRoute as RouteBinder);
    }

    // Mount at base path
    app.route(`${apiBasePath}/${module.basePath}`, router);
  }
}
