import { asValue } from 'awilix';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { createErrorHandler, defaultErrorHandler } from '../http/error-handler.js';
import { type OpenAPIContext, route, setOpenAPIContext } from '../http/route-helpers.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { flushExceptionTracker } from '../observability/exception-tracking.js';
import {
  createContextAwarePinoLogger,
  createPinoHttpMiddleware,
} from '../observability/pino-logger.js';
import { createRequestContextMiddleware } from '../observability/request-context.js';
import {
  createSanitizedExceptionTracker,
  createSanitizedLogger,
} from '../observability/sanitizers.js';
import { configureOpenAPI } from '../openapi/openapi.js';
import { createBuiltinProcessors } from '../openapi/openapi-processors.js';
import { detectEnvironment, isLambda, isTest } from '../utils/environment.js';
import {
  createLogger,
  createPlainLogger,
  getDefaultLogLevel,
  type LogLevel,
} from '../utils/logger.js';
import {
  createApplicationLifecycle,
  executeLifecycleHooks,
  shutdownContainer,
} from './lifecycle.js';
import { getProviderName } from './module.js';
import {
  collectModules,
  registerModuleProviders,
  resolveAsyncFactoryProviders,
  validateNoCycles,
} from './module-graph.js';
import { ModuleRuntime } from './module-runtime.js';
import { HttpRequestScope } from './request-scope.js';
import type {
  BootstrapOptions,
  BootstrapResult,
  Environment,
  LoggerOptions,
  MiddlewareOptions,
  ModuleConfig,
  OpenAPIOptions,
  OpenAPIResponseProcessor,
  ProviderConfig,
  ProviderOverride,
  RateLimitOptions,
  RouteBinder,
} from './types.js';

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
    mode = 'runtime',
    providerOverrides = [],
  } = options;

  // Create logger for bootstrap process
  // Convert debug boolean to log level: debug=true -> 'debug', debug=false -> default level
  // In test mode, use silent unless debug=true is explicitly set (for testing/debugging)
  const bootstrapLogLevel: LogLevel = debug ? 'debug' : isTest() ? 'silent' : getDefaultLogLevel();
  const baseLogger =
    logger?.instance ??
    (logger?.pino
      ? createContextAwarePinoLogger({ pino: logger.pino, service: 'Glasswork' })
      : createLogger('Glasswork', bootstrapLogLevel));
  const bootstrapLogger = createSanitizedLogger(baseLogger, logger?.sanitizers);

  bootstrapLogger.debug('Bootstrapping application...');

  // Collect all modules (flatten imports)
  const allModules = collectModules(rootModule);

  bootstrapLogger.debug(
    `Found ${allModules.length} modules: ${allModules.map((m) => m.name).join(', ')}`
  );

  // Validate no circular dependencies
  validateNoCycles(allModules);

  const runtime = new ModuleRuntime(allModules, bootstrapLogger);
  const container = runtime.container;
  const asyncFactoryNames = runtime.asyncFactories;

  try {
    const activeAsyncFactories = applyProviderOverrides(
      runtime,
      asyncFactoryNames,
      providerOverrides,
      mode,
      bootstrapLogger
    );

    // Resolve async factories before mounting runtime routes.
    if (mode === 'runtime' && activeAsyncFactories.length > 0) {
      await resolveAsyncFactoryProviders(container, activeAsyncFactories, bootstrapLogger);
    }

    return await finishBootstrap(allModules, runtime, bootstrapLogger, {
      environment,
      apiBasePath,
      mode,
      errorHandler,
      openapi,
      rateLimit,
      middleware,
      logger,
      exceptionTracking,
    });
  } catch (error) {
    await releaseFailedBootstrap(container, mode, bootstrapLogger);
    throw error;
  }
}

/**
 * The caller of a failed bootstrap never receives stop(), so release what was created so
 * far: destroy hooks and disposers of resolved providers. Cleanup errors are logged and the
 * original error is rethrown.
 */
async function releaseFailedBootstrap(
  container: import('awilix').AwilixContainer,
  mode: 'runtime' | 'contract',
  bootstrapLogger: import('../utils/logger.js').Logger
): Promise<void> {
  try {
    if (mode === 'contract') await container.dispose();
    else await shutdownContainer(container, bootstrapLogger);
  } catch (cleanupError) {
    bootstrapLogger.error('Cleanup after failed bootstrap failed', cleanupError);
  }
}

function applyProviderOverrides(
  runtime: ModuleRuntime,
  asyncFactoryNames: string[],
  providerOverrides: ProviderOverride[],
  mode: 'runtime' | 'contract',
  bootstrapLogger: import('../utils/logger.js').Logger
): string[] {
  validateProviderOverrides(runtime, providerOverrides, bootstrapLogger);
  const declares = (module: ModuleConfig, name: string) =>
    module.providers?.some((local) => getProviderName(local) === name) ?? false;
  const container = runtime.container;
  const originalRegistrations = { ...container.registrations };
  const overrideAsyncFactories: string[] = [];
  for (const module of runtime.modules) {
    const applies = (override: ProviderOverride) => {
      const target = overrideTarget(override);
      return (
        (target === undefined || target === module.name) &&
        declares(module, getProviderName(override))
      );
    };
    // Module-specific overrides register last, so they win over overrides for every module.
    const providers = [
      ...providerOverrides.filter((override) => !overrideTarget(override) && applies(override)),
      ...providerOverrides.filter((override) => overrideTarget(override) && applies(override)),
    ].map(withoutTarget);
    const names = registerModuleProviders(
      {
        name: module.name,
        providers: [
          ...new Map(providers.map((provider) => [getProviderName(provider), provider])).values(),
        ],
      },
      runtime.forModule(module),
      bootstrapLogger
    );
    overrideAsyncFactories.push(...names.map((name) => `${module.name}/${name}`));
  }
  const overriddenNames = new Set(
    Object.entries(container.registrations)
      .filter(([name, registration]) => registration !== originalRegistrations[name])
      .map(([name]) => name)
  );
  const activeAsyncFactories = [
    ...new Set([
      ...asyncFactoryNames.filter((name) => !overriddenNames.has(name)),
      ...overrideAsyncFactories,
    ]),
  ];
  if (mode === 'contract') {
    if (
      providerOverrides.some(
        (provider) => typeof provider === 'function' || !('useValue' in provider)
      )
    ) {
      throw new Error('Contract providerOverrides must use explicit values');
    }
    for (const name of Object.keys(container.registrations)) {
      if (!overriddenNames.has(name))
        container.register({ [name]: asValue(createContractPlaceholder(name)) });
    }
  }

  return activeAsyncFactories;
}

async function finishBootstrap(
  allModules: ModuleConfig[],
  runtime: ModuleRuntime,
  bootstrapLogger: import('../utils/logger.js').Logger,
  resolved: {
    environment: Environment;
    apiBasePath: string;
    mode: 'runtime' | 'contract';
    errorHandler: false | import('hono').ErrorHandler;
    openapi?: OpenAPIOptions;
    rateLimit?: RateLimitOptions;
    middleware?: MiddlewareOptions;
    logger?: LoggerOptions;
    exceptionTracking?: import('./types.js').ExceptionTrackingOptions;
  }
): Promise<BootstrapResult> {
  const {
    environment,
    apiBasePath,
    mode,
    errorHandler,
    openapi,
    rateLimit,
    middleware,
    logger,
    exceptionTracking,
  } = resolved;

  const container = runtime.container;

  // Create Hono app and apply middleware
  const { app, openAPIContext, writeOpenAPISpec, generateOpenAPI } = createApp({
    mode,
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
    runtime,
    apiBasePath,
    bootstrapLogger,
    openAPIContext,
  });

  // Export only after every module route has been registered. The writer uses
  // the route registry directly and does not add a public endpoint.
  await writeOpenAPISpec?.();

  bootstrapLogger.debug('Bootstrap complete');
  bootstrapLogger.debug(`Environment: ${environment}`);
  bootstrapLogger.debug(`Registered ${Object.keys(container.registrations).length} services`);

  const lifecycle = createApplicationLifecycle({
    start: async () => {
      bootstrapLogger.debug('Starting application (running onModuleInit)...');
      await executeLifecycleHooks(container, 'onModuleInit', bootstrapLogger);
      bootstrapLogger.debug('Application started successfully');
    },
    stop: async () => {
      bootstrapLogger.debug('Stopping application (running onModuleDestroy and disposers)...');
      try {
        await shutdownContainer(container, bootstrapLogger);
      } finally {
        await flushTracker(exceptionTracking, bootstrapLogger);
      }
      bootstrapLogger.debug('Application stopped successfully');
    },
  });
  const start = async () => {
    if (mode === 'contract') throw new Error('Contract bootstrap has no runtime lifecycle');
    await lifecycle.start();
  };
  const stop = async () => {
    if (mode === 'contract') throw new Error('Contract bootstrap has no runtime lifecycle');
    await lifecycle.stop();
  };

  // Auto-start in production/development (but not test)
  // This ensures providers are initialized before requests come in
  if (mode === 'runtime' && environment !== 'test') {
    await start();
  }

  return { app, container: runtime.forModule(allModules[0]), start, stop, generateOpenAPI };
}

/** Rejects overrides that match nothing, and warns when one replaces several providers. */
function validateProviderOverrides(
  runtime: ModuleRuntime,
  providerOverrides: ProviderOverride[],
  bootstrapLogger: import('../utils/logger.js').Logger
): void {
  const declares = (module: ModuleConfig, name: string) =>
    module.providers?.some((local) => getProviderName(local) === name) ?? false;
  for (const override of providerOverrides) {
    const name = getProviderName(override);
    const target = overrideTarget(override);
    if (target === undefined) {
      const owners = runtime.modules.filter((module) => declares(module, name));
      if (owners.length === 0) {
        throw new Error(`Provider override "${name}" does not match a registered provider`);
      }
      if (owners.length > 1) {
        bootstrapLogger.warn(
          `Provider override "${name}" replaces the provider in modules ${owners
            .map((module) => `"${module.name}"`)
            .join(', ')}. Set module to replace it in one module only.`
        );
      }
      continue;
    }
    const module = runtime.modules.find((candidate) => candidate.name === target);
    if (!module) {
      throw new Error(`Provider override "${name}" targets unknown module "${target}"`);
    }
    if (!declares(module, name)) {
      throw new Error(
        `Provider override "${name}" does not match a provider declared in module "${target}"`
      );
    }
  }
}

function overrideTarget(override: ProviderOverride): string | undefined {
  if (typeof override === 'function' || !('module' in override)) return undefined;
  return typeof override.module === 'string' ? override.module : override.module.name;
}

function withoutTarget(override: ProviderOverride): ProviderConfig {
  if (typeof override === 'function' || !('module' in override)) return override;
  const { module: _module, ...provider } = override;
  return provider as ProviderConfig;
}

/** Errors reported during shutdown should still reach the tracker; never fails stop(). */
async function flushTracker(
  exceptionTracking: import('./types.js').ExceptionTrackingOptions | undefined,
  bootstrapLogger: import('../utils/logger.js').Logger
): Promise<void> {
  if (!exceptionTracking) return;
  const result = await flushExceptionTracker(
    exceptionTracking.tracker,
    exceptionTracking.flushTimeoutMs ?? 2000,
    bootstrapLogger
  );
  if (!result.completed) {
    bootstrapLogger.warn(
      `Exception tracker did not finish sending before stop() (${result.pending} pending)`
    );
  }
}

function createContractPlaceholder(name: string): unknown {
  const fail = () => {
    throw new Error(
      `Contract route registration used provider "${name}". Supply an explicit providerOverride for metadata construction.`
    );
  };
  return new Proxy(fail, { get: fail, set: fail });
}

/**
 * Create Hono app and apply middleware
 */
function createApp(options: {
  mode: 'runtime' | 'contract';
  environment: Environment;
  errorHandler: false | import('hono').ErrorHandler;
  openapi?: OpenAPIOptions;
  rateLimit?: RateLimitOptions;
  middleware?: MiddlewareOptions;
  logger?: LoggerOptions;
  exceptionTracking?: import('./types.js').ExceptionTrackingOptions;
  bootstrapLogger: import('../utils/logger.js').Logger;
}): {
  app: Hono;
  openAPIContext: OpenAPIContext;
  writeOpenAPISpec?: () => Promise<void>;
  generateOpenAPI?: import('../openapi/openapi.js').ConfigureOpenAPIResult['generateSpec'];
} {
  const app = new Hono();
  if (options.mode === 'contract') {
    app.use('*', async (c) =>
      c.json({ error: 'Contract bootstrap cannot handle HTTP requests' }, 503)
    );
  }

  // Build OpenAPI context with processors
  const openAPIContext = buildOpenAPIContext(options);
  setOpenAPIContext(app, openAPIContext);

  applyErrorHandler(app, options);
  applySecurityMiddleware(app, options);
  applyLoggingMiddleware(app, options);
  applyRateLimiting(app, options);
  const { writeSpec: writeOpenAPISpec, generateSpec: generateOpenAPI } = applyOpenAPIDocumentation(
    app,
    options
  );

  return { app, openAPIContext, writeOpenAPISpec, generateOpenAPI };
}

/**
 * Build the OpenAPI context with processors and security schemes
 */
function buildOpenAPIContext(options: {
  environment: Environment;
  openapi?: OpenAPIOptions;
  rateLimit?: RateLimitOptions;
  middleware?: MiddlewareOptions;
  logger?: LoggerOptions;
}): OpenAPIContext {
  const { environment, openapi, rateLimit, middleware, logger } = options;

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

  return {
    processors,
    securitySchemes,
    pino: logger?.pino,
    sanitizers: logger?.sanitizers,
    logger: logger?.instance,
    environment,
  };
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
    logger,
  }: {
    errorHandler: false | import('hono').ErrorHandler;
    exceptionTracking?: import('./types.js').ExceptionTrackingOptions;
    bootstrapLogger: import('../utils/logger.js').Logger;
    logger?: LoggerOptions;
  }
): void {
  if (errorHandler === false) return;

  // If using default error handler and exception tracking is configured, create custom handler
  if (errorHandler === defaultErrorHandler) {
    bootstrapLogger.debug(
      exceptionTracking
        ? 'Applying error handler with exception tracking'
        : 'Applying framework error handler'
    );
    const customErrorHandler = createErrorHandler({
      logger: bootstrapLogger,
      exceptionTracker: exceptionTracking
        ? createSanitizedExceptionTracker(exceptionTracking.tracker, logger?.sanitizers)
        : undefined,
      trackingConfig: {
        trackStatusCodes: exceptionTracking?.trackStatusCodes ?? ((status) => status >= 500),
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
  app.use(createRequestContextMiddleware());
  if (logger?.enabled === false) return;

  // If Pino logger instance provided, use structured logging with request context
  if (logger?.pino) {
    bootstrapLogger.debug('Applying Pino logger with request context (AsyncLocalStorage)');

    // Apply Pino HTTP logging middleware
    app.use(createPinoHttpMiddleware(logger.pino, logger.sanitizers));
    return;
  }

  if (logger?.instance || logger?.sanitizers) {
    app.use(async (c, next) => {
      const start = Date.now();
      await next();
      const level = c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info';
      bootstrapLogger[level]('HTTP Request', {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration: Date.now() - start,
      });
    });
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
  app.use(createRateLimitMiddleware({ ...rateLimit, logger: bootstrapLogger }));
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
): import('../openapi/openapi.js').ConfigureOpenAPIResult {
  const { environment, openapi, rateLimit, middleware, bootstrapLogger } = options;

  if (!openapi?.enabled) return {};

  bootstrapLogger.debug('Configuring OpenAPI');
  return configureOpenAPI({
    app,
    environment,
    openapi,
    rateLimit,
    middleware,
    logger: bootstrapLogger,
  });
}

/**
 * Mount module routes to the app
 */
function mountModuleRoutes(options: {
  app: Hono;
  modules: ModuleConfig[];
  runtime: ModuleRuntime;
  apiBasePath: string;
  bootstrapLogger: import('../utils/logger.js').Logger;
  openAPIContext: OpenAPIContext;
}): void {
  const { app, modules, runtime, apiBasePath, bootstrapLogger, openAPIContext } = options;

  const requestScope = new HttpRequestScope();
  app.use('*', requestScope.middleware(runtime.container));

  for (const module of modules) {
    if (!module.routes || !module.basePath) {
      continue;
    }

    bootstrapLogger.debug(`Mounting routes: ${apiBasePath}/${module.basePath}`);

    const container = runtime.forModule(module);
    const router = new Hono();

    // Set OpenAPI context on the router so routes can access it
    setOpenAPIContext(router, openAPIContext);

    // Create a bound route function for this router
    const boundRoute = <T extends Parameters<typeof route>[1]>(config: T) => route(router, config);

    // Normalize routes to array and call each factory
    const routeFactories = Array.isArray(module.routes) ? module.routes : [module.routes];
    const services = requestScope.routeServices(container, (scope) =>
      runtime.forModule(module, scope)
    );
    for (const routeFactory of routeFactories) {
      routeFactory(router, services, boundRoute as RouteBinder);
    }

    // Mount at base path
    app.route(`${apiBasePath}/${module.basePath}`, router);
  }
}
