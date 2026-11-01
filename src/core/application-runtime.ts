import { type AwilixContainer, asValue } from 'awilix';
import { type FlushResult, flushExceptionTracker } from '../observability/exception-tracking.js';
import { createContextAwarePinoLogger } from '../observability/pino-logger.js';
import { createSanitizedLogger } from '../observability/sanitizers.js';
import { isTest } from '../utils/environment.js';
import { createLogger, getDefaultLogLevel, type Logger, type LogLevel } from '../utils/logger.js';
import {
  type ApplicationLifecycle,
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
import type {
  ExceptionTrackingOptions,
  LoggerOptions,
  ModuleConfig,
  ProviderConfig,
  ProviderOverride,
} from './types.js';

export interface ApplicationRuntimeOptions {
  logger: Logger;
  /** `contract` replaces providers with placeholders and has no lifecycle. Default `runtime`. */
  mode?: 'runtime' | 'contract';
  providerOverrides?: ProviderOverride[];
  /** Flushed when the application stops. */
  exceptionTracking?: ExceptionTrackingOptions;
}

/**
 * Modules, providers and lifecycle of an application, without HTTP. `bootstrap()`,
 * `bootstrapWorker()` and `bootstrapRuntime()` build on it.
 * @internal
 */
export interface ApplicationRuntime {
  readonly modules: ModuleConfig[];
  readonly moduleRuntime: ModuleRuntime;
  /** The root module's view: its own providers and the exports of its imports. */
  readonly container: AwilixContainer;
  /** Runs `onModuleInit` hooks once; concurrent calls share the result. */
  start(): Promise<void>;
  /** Runs destroy hooks and disposers once, then flushes the exception tracker. */
  stop(): Promise<void>;
  /**
   * Waits up to `timeoutMs` (default `exceptionTracking.flushTimeoutMs`, else 2000) for
   * exception reports that are still being sent. Never throws; `completed: false` reports a
   * timeout or failure, which is also logged.
   */
  flush(timeoutMs?: number): Promise<FlushResult>;
  /**
   * Releases what an application that failed to start created: destroy hooks and disposers
   * of resolved providers. Borrowed values have no disposer and stay open. Never throws.
   */
  release(): Promise<void>;
}

/**
 * Collects the modules, registers their providers with the overrides, resolves async
 * factories and prepares the lifecycle. A failure while resolving releases what was
 * created before it rethrows.
 * @internal
 */
export async function createApplicationRuntime(
  rootModule: ModuleConfig,
  options: ApplicationRuntimeOptions
): Promise<ApplicationRuntime> {
  const { logger, mode = 'runtime', providerOverrides = [], exceptionTracking } = options;
  const modules = collectModules(rootModule);
  logger.debug(`Found ${modules.length} modules: ${modules.map((m) => m.name).join(', ')}`);
  validateNoCycles(modules);

  const moduleRuntime = new ModuleRuntime(modules, logger);
  const container = moduleRuntime.container;
  const release = () => releaseFailedBootstrap(container, mode, logger);

  try {
    const activeAsyncFactories = applyProviderOverrides(
      moduleRuntime,
      moduleRuntime.asyncFactories,
      providerOverrides,
      mode,
      logger
    );
    if (mode === 'runtime' && activeAsyncFactories.length > 0) {
      await resolveAsyncFactoryProviders(container, activeAsyncFactories, logger);
    }
  } catch (error) {
    await release();
    throw error;
  }

  const lifecycle = createApplicationLifecycle({
    start: async () => {
      logger.debug('Starting application (running onModuleInit)...');
      await executeLifecycleHooks(container, 'onModuleInit', logger);
      logger.debug('Application started successfully');
    },
    stop: async () => {
      logger.debug('Stopping application (running onModuleDestroy and disposers)...');
      try {
        await shutdownContainer(container, logger);
      } finally {
        await flushTracker(exceptionTracking, logger);
      }
      logger.debug('Application stopped successfully');
    },
  });

  return {
    modules,
    moduleRuntime,
    container: moduleRuntime.forModule(rootModule),
    start: runtimeOnly(mode, lifecycle, 'start'),
    stop: runtimeOnly(mode, lifecycle, 'stop'),
    release,
    async flush(timeoutMs) {
      if (!exceptionTracking) return { completed: true, pending: 0 };
      return flushExceptionTracker(
        exceptionTracking.tracker,
        timeoutMs ?? exceptionTracking.flushTimeoutMs ?? 2000,
        logger
      );
    },
  };
}

/** Starts the runtime; when that fails, releases what it created and rethrows. @internal */
export async function startOrRelease(runtime: ApplicationRuntime): Promise<void> {
  try {
    await runtime.start();
  } catch (error) {
    await runtime.release();
    throw error;
  }
}

/**
 * The logger bootstrap reports through: the configured instance or Pino logger, sanitized,
 * silent in tests unless `debug` is set.
 * @internal
 */
export function createBootstrapLogger(logger: LoggerOptions | undefined, debug = false): Logger {
  const level: LogLevel = debug ? 'debug' : isTest() ? 'silent' : getDefaultLogLevel();
  const baseLogger =
    logger?.instance ??
    (logger?.pino
      ? createContextAwarePinoLogger({ pino: logger.pino, service: 'Glasswork' })
      : createLogger('Glasswork', level));
  return createSanitizedLogger(baseLogger, logger?.sanitizers);
}

function runtimeOnly(
  mode: 'runtime' | 'contract',
  lifecycle: ApplicationLifecycle,
  step: 'start' | 'stop'
): () => Promise<void> {
  return async () => {
    if (mode === 'contract') throw new Error('Contract bootstrap has no runtime lifecycle');
    await lifecycle[step]();
  };
}

/**
 * The caller of a failed bootstrap never receives stop(), so release what was created so
 * far: destroy hooks and disposers of resolved providers. Cleanup errors are logged and the
 * original error is rethrown.
 */
async function releaseFailedBootstrap(
  container: AwilixContainer,
  mode: 'runtime' | 'contract',
  bootstrapLogger: Logger
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
  bootstrapLogger: Logger
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

/** Errors reported during shutdown should still reach the tracker; never fails stop(). */
async function flushTracker(
  exceptionTracking: ExceptionTrackingOptions | undefined,
  bootstrapLogger: Logger
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

/** Rejects overrides that match nothing, and warns when one replaces several providers. */
function validateProviderOverrides(
  runtime: ModuleRuntime,
  providerOverrides: ProviderOverride[],
  bootstrapLogger: Logger
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

function createContractPlaceholder(name: string): unknown {
  const fail = () => {
    throw new Error(
      `Contract route registration used provider "${name}". Supply an explicit providerOverride for metadata construction.`
    );
  };
  return new Proxy(fail, { get: fail, set: fail });
}
