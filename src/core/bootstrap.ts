import type { AwilixContainer } from 'awilix';
import { asClass, asFunction, asValue, createContainer, InjectionMode } from 'awilix';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { defaultErrorHandler } from '../http/error-handler.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { configureOpenAPI } from '../openapi/openapi.js';
import { isLambda } from '../utils/environment.js';
import { createLogger, createPlainLogger } from '../utils/logger.js';
import type {
  BootstrapOptions,
  BootstrapResult,
  Constructor,
  Environment,
  LoggerOptions,
  MiddlewareOptions,
  ModuleConfig,
  OpenAPIOptions,
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
export function bootstrap(
  rootModule: ModuleConfig,
  options: BootstrapOptions = {}
): BootstrapResult {
  const {
    apiBasePath = '/api',
    debug = false,
    environment = detectEnvironment(),
    errorHandler = defaultErrorHandler,
    openapi,
    rateLimit,
    middleware,
    logger,
  } = options;

  // Create logger for bootstrap process
  const bootstrapLogger = createLogger('Glasswork', debug);

  // Create Awilix container with PROXY mode (Lambda-compatible)
  const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  bootstrapLogger.info('Bootstrapping application...');

  // Collect all modules (flatten imports)
  const allModules = collectModules(rootModule);

  bootstrapLogger.info(
    `Found ${allModules.length} modules: ${allModules.map((m) => m.name).join(', ')}`
  );

  // Validate no circular dependencies
  validateNoCycles(allModules);

  // Register all providers
  for (const module of allModules) {
    bootstrapLogger.info(`Registering module: ${module.name}`);
    registerModuleProviders(module, container, bootstrapLogger);
  }

  // Create Hono app and apply middleware
  const app = createApp({
    environment,
    errorHandler,
    openapi,
    rateLimit,
    middleware,
    logger,
    bootstrapLogger,
  });

  // Mount module routes
  mountModuleRoutes({ app, modules: allModules, container, apiBasePath, bootstrapLogger });

  bootstrapLogger.info('Bootstrap complete');
  bootstrapLogger.info(`Environment: ${environment}`);
  bootstrapLogger.info(`Registered ${Object.keys(container.cradle).length} services`);

  return { app, container };
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
  bootstrapLogger: import('../utils/logger.js').Logger;
}): Hono {
  const app = new Hono();

  applyErrorHandler(app, options);
  applySecurityMiddleware(app, options);
  applyLoggingMiddleware(app, options);
  applyRateLimiting(app, options);
  applyOpenAPIDocumentation(app, options);

  return app;
}

/**
 * Apply error handler to the app
 */
function applyErrorHandler(
  app: Hono,
  {
    errorHandler,
    bootstrapLogger,
  }: {
    errorHandler: false | import('hono').ErrorHandler;
    bootstrapLogger: import('../utils/logger.js').Logger;
  }
): void {
  if (errorHandler === false) return;

  bootstrapLogger.info('Applying error handler');
  app.onError(errorHandler);
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
  // Secure headers (default: true in production)
  if (middleware?.secureHeaders !== false && environment === 'production') {
    bootstrapLogger.info('Applying secure headers');
    app.use(secureHeaders());
  }

  // Request ID (default: true)
  if (middleware?.requestId !== false) {
    bootstrapLogger.info('Applying request ID middleware');
    app.use(requestId());
  }

  // CORS
  if (middleware?.cors) {
    bootstrapLogger.info('Applying CORS middleware');
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

  // Auto-detect plain mode based on environment if not specified
  const usePlainLogger = logger?.plain ?? isLambda();

  bootstrapLogger.info(`Applying logger (plain: ${usePlainLogger})`);

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

  bootstrapLogger.info(
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

  bootstrapLogger.info('Configuring OpenAPI');
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
}): void {
  const { app, modules, container, apiBasePath, bootstrapLogger } = options;

  for (const module of modules) {
    if (!module.routes || !module.basePath) {
      continue;
    }

    bootstrapLogger.info(`Mounting routes: ${apiBasePath}/${module.basePath}`);

    const router = new Hono();

    // Call route factory with router and services
    module.routes(router, container.cradle as Record<string, unknown>);

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
 */
export function registerModuleProviders(
  module: ModuleConfig,
  container: AwilixContainer,
  logger: import('../utils/logger.js').Logger
): void {
  if (!module.providers) {
    return;
  }

  for (const provider of module.providers) {
    registerProvider(provider, container, module.name, logger);
  }
}

/**
 * Register a single provider with Awilix
 */
function registerProvider(
  provider: ProviderConfig,
  container: AwilixContainer,
  moduleName: string,
  logger: import('../utils/logger.js').Logger
): void {
  if (typeof provider === 'function') {
    registerClassProvider(provider, container, logger);
    return;
  }

  if ('useClass' in provider) {
    registerExplicitClassProvider(provider, container, logger);
    return;
  }

  if ('useValue' in provider) {
    registerValueProvider(provider, container, logger);
    return;
  }

  if ('useFactory' in provider) {
    registerFactoryProvider(provider, container, logger);
    return;
  }

  throw new Error(`Invalid provider configuration in module "${moduleName}"`);
}

function registerClassProvider(
  provider: Constructor,
  container: AwilixContainer,
  logger: import('../utils/logger.js').Logger
): void {
  const name = camelCase(provider.name);

  logger.info(`  - Registering ${name} (${provider.name})`);

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

  logger.info(`  - Registering ${name} (scope: ${scope})`);

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
  logger.info(`  - Registering ${provider.provide} (value)`);

  container.register({
    [provider.provide]: asValue(provider.useValue),
  });
}

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
): void {
  const scope = provider.scope || 'SINGLETON';
  logger.info(`  - Registering ${provider.provide} (factory, scope: ${scope})`);

  const registration = asFunction(provider.useFactory);

  // Apply dependency injection if specified
  if (provider.inject && provider.inject.length > 0) {
    registration.inject(() => provider.inject as string[]);
  }

  container.register({
    [provider.provide]: applyScopeToRegistration(registration, scope),
  });
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
 * Convert PascalCase to camelCase
 */
function camelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}
