import type { AwilixContainer } from 'awilix';
import { asClass, asFunction, asValue, createContainer, InjectionMode } from 'awilix';
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
import type { Logger } from '../utils/logger.js';
import {
  createLogger,
  createPlainLogger,
  getDefaultLogLevel,
  type LogLevel,
} from '../utils/logger.js';
import type {
  BootstrapOptions,
  BootstrapResult,
  Constructor,
  Environment,
  LoggerOptions,
  MiddlewareOptions,
  ModuleConfig,
  OpenAPIOptions,
  OpenAPIResponseProcessor,
  ProviderConfig,
  RateLimitOptions,
  ServiceScope,
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
    await resolveAsyncFactories(container, asyncFactoryNames, bootstrapLogger);
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

    // Call route factory with router, services, and bound route function
    module.routes(router, container.cradle as Record<string, unknown>, boundRoute);

    // Mount at base path
    app.route(`${apiBasePath}/${module.basePath}`, router);
  }
}

/**
 * Collect all modules (flatten imports recursively)
 * @internal - exported for testing utilities
 */
export function collectModules(rootModule: ModuleConfig): ModuleConfig[] {
  const modules = new Map<string, ModuleConfig>();
  const visited = new Set<string>();

  function collect(module: ModuleConfig): void {
    if (visited.has(module.name)) {
      return;
    }

    visited.add(module.name);
    modules.set(module.name, module);

    // Recursively collect imports
    if (module.imports) {
      for (const importedModule of module.imports) {
        collect(importedModule);
      }
    }
  }

  collect(rootModule);

  return Array.from(modules.values());
}

/**
 * Validate no circular dependencies between modules
 * @internal - exported for testing utilities
 */
export function validateNoCycles(modules: ModuleConfig[]): void {
  const graph = new Map<string, Set<string>>();

  // Build dependency graph
  for (const module of modules) {
    if (!graph.has(module.name)) {
      graph.set(module.name, new Set());
    }

    if (module.imports) {
      for (const importedModule of module.imports) {
        graph.get(module.name)?.add(importedModule.name);
      }
    }
  }

  // Detect cycles using DFS
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string, path: string[]): void {
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected: ${[...path, name].join(' -> ')}`);
    }

    if (visited.has(name)) {
      return;
    }

    visiting.add(name);

    const dependencies = graph.get(name) || new Set();
    for (const dep of dependencies) {
      visit(dep, [...path, name]);
    }

    visiting.delete(name);
    visited.add(name);
  }

  for (const module of modules) {
    visit(module.name, []);
  }
}

/**
 * Register module providers with Awilix container
 * @internal - exported for testing utilities
 * @returns Array of async factory provider names that need to be resolved
 */
export function registerModuleProviders(
  module: ModuleConfig,
  container: AwilixContainer,
  logger: import('../utils/logger.js').Logger
): string[] {
  const asyncFactoryNames: string[] = [];

  if (!module.providers) {
    return asyncFactoryNames;
  }

  for (const provider of module.providers) {
    const asyncFactoryName = registerProvider(provider, container, module.name, logger);
    if (asyncFactoryName) {
      asyncFactoryNames.push(asyncFactoryName);
    }
  }

  return asyncFactoryNames;
}

/**
 * Register a single provider with Awilix
 * @returns The provider name if it's an async factory, undefined otherwise
 */
function registerProvider(
  provider: ProviderConfig,
  container: AwilixContainer,
  moduleName: string,
  logger: import('../utils/logger.js').Logger
): string | undefined {
  if (typeof provider === 'function') {
    registerClassProvider(provider, container, logger);
    return undefined;
  }

  if ('useClass' in provider) {
    registerExplicitClassProvider(provider, container, logger);
    return undefined;
  }

  if ('useValue' in provider) {
    registerValueProvider(provider, container, logger);
    return undefined;
  }

  if ('useFactory' in provider) {
    return registerFactoryProvider(provider, container, logger);
  }

  throw new Error(`Invalid provider configuration in module "${moduleName}"`);
}

function registerClassProvider(
  provider: Constructor,
  container: AwilixContainer,
  logger: import('../utils/logger.js').Logger
): void {
  const name = camelCase(provider.name);

  logger.debug(`  - Registering ${name} (${provider.name})`);

  container.register({
    [name]: asClass(provider).singleton(),
  });
}

function registerExplicitClassProvider(
  provider: { provide: string | Constructor; useClass: Constructor; scope?: ServiceScope },
  container: AwilixContainer,
  logger: import('../utils/logger.js').Logger
): void {
  const name =
    typeof provider.provide === 'string' ? provider.provide : camelCase(provider.provide.name);

  const scope = provider.scope || 'SINGLETON';

  logger.debug(`  - Registering ${name} (scope: ${scope})`);

  const registration = asClass(provider.useClass);

  container.register({
    [name]: applyScopeToRegistration(registration, scope),
  });
}

function registerValueProvider(
  provider: { provide: string; useValue: unknown },
  container: AwilixContainer,
  logger: import('../utils/logger.js').Logger
): void {
  logger.debug(`  - Registering ${provider.provide} (value)`);

  container.register({
    [provider.provide]: asValue(provider.useValue),
  });
}

/**
 * Register a factory provider with Awilix
 * @returns The provider name if it's an async factory, undefined otherwise
 */
function registerFactoryProvider(
  provider: {
    provide: string;
    // biome-ignore lint/suspicious/noExplicitAny: DI requires dynamic argument resolution
    useFactory: (dependencies: any) => unknown;
    inject?: string[];
    scope?: ServiceScope;
  },
  container: AwilixContainer,
  logger: import('../utils/logger.js').Logger
): string | undefined {
  const scope = provider.scope || 'SINGLETON';
  const isAsync = isAsyncFunction(provider.useFactory);
  logger.debug(
    `  - Registering ${provider.provide} (factory${isAsync ? ' async' : ''}, scope: ${scope})`
  );

  const registration = asFunction(provider.useFactory);

  // Apply dependency injection if specified
  if (provider.inject && provider.inject.length > 0) {
    registration.inject(() => provider.inject as string[]);
  }

  container.register({
    [provider.provide]: applyScopeToRegistration(registration, scope),
  });

  // Return the name if this is an async factory so it can be resolved during bootstrap
  return isAsync ? provider.provide : undefined;
}

/**
 * Check if a function is async (returns a Promise)
 */
function isAsyncFunction(fn: (...args: unknown[]) => unknown): boolean {
  return fn.constructor.name === 'AsyncFunction';
}

/**
 * Resolve async factory providers and re-register them as values.
 * This ensures all async providers are fully initialized before bootstrap completes.
 */
async function resolveAsyncFactories(
  container: AwilixContainer,
  names: string[],
  logger: import('../utils/logger.js').Logger
): Promise<void> {
  for (const name of names) {
    logger.debug(`  - Resolving async factory: ${name}`);
    const resolved = container.resolve(name);

    // If the resolved value is a Promise, await it and re-register as a value
    if (resolved instanceof Promise) {
      const value = await resolved;
      container.register({
        [name]: asValue(value),
      });
      logger.debug(`  - Resolved ${name} (async factory → value)`);
    }
  }
}

function applyScopeToRegistration(
  registration: ReturnType<typeof asClass>,
  scope: ServiceScope
): ReturnType<typeof asClass> {
  if (scope === 'SCOPED') {
    return registration.scoped();
  }
  if (scope === 'TRANSIENT') {
    return registration.transient();
  }
  return registration.singleton();
}

/**
 * Type guard to check if a service implements a specific lifecycle hook.
 * Uses duck typing to detect the presence of the hook method.
 *
 * @param service - The service instance to check
 * @param hook - The lifecycle hook name to check for
 * @returns True if the service has the hook method
 */
function hasHook(
  service: unknown,
  hook: 'onModuleInit' | 'onModuleDestroy'
): service is { [K in typeof hook]: () => void | Promise<void> } {
  return (
    service !== null &&
    typeof service === 'object' &&
    hook in service &&
    typeof (service as Record<string, unknown>)[hook] === 'function'
  );
}

/**
 * Execute lifecycle hooks on all registered services in parallel.
 *
 * This function:
 * - Iterates through all services in the DI container
 * - Checks if each service implements the specified hook (duck typing)
 * - Executes all hooks in parallel using Promise.all()
 * - Fails fast if any hook throws an error
 *
 * @param container - Awilix DI container with registered services
 * @param hook - Which lifecycle hook to execute ('onModuleInit' | 'onModuleDestroy')
 * @param logger - Logger instance for debugging and error reporting
 * @throws {Error} If any service's lifecycle hook throws an error
 * @internal
 *
 * @example
 * ```typescript
 * await executeLifecycleHooks(container, 'onModuleInit', logger);
 * ```
 */
async function executeLifecycleHooks(
  container: AwilixContainer,
  hook: 'onModuleInit' | 'onModuleDestroy',
  logger: Logger
): Promise<void> {
  const cradle = container.cradle;
  const serviceNames = Object.keys(cradle);

  const promises: Promise<void>[] = [];

  for (const name of serviceNames) {
    const service = cradle[name];

    // Check if service implements the hook using type guard
    if (hasHook(service, hook)) {
      logger.debug(`Executing ${hook} for ${name}`);
      // Wrap in Promise.resolve().then() to normalize both sync and async hooks
      // This ensures consistent error handling regardless of whether the hook returns a Promise
      promises.push(
        Promise.resolve()
          .then(() => service[hook]())
          .catch((err) => {
            logger.error(`Error in ${hook} for ${name}`, err);
            throw err;
          })
      );
    }
  }

  // Execute all hooks in parallel
  await Promise.all(promises);
}

/**
 * Convert PascalCase to camelCase
 */
function camelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}
