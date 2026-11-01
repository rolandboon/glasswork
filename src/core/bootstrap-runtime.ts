import type { AwilixContainer } from 'awilix';
import { detectEnvironment } from '../utils/environment.js';
import {
  createApplicationRuntime,
  createBootstrapLogger,
  startOrRelease,
} from './application-runtime.js';
import { disposeScope } from './lifecycle.js';
import type {
  Environment,
  ExceptionTrackingOptions,
  LoggerOptions,
  ModuleConfig,
  ProviderOverride,
} from './types.js';

export interface RuntimeBootstrapOptions {
  providerOverrides?: ProviderOverride[];
  /** Outside `test`, the runtime starts before it is returned, like `bootstrap()`. */
  environment?: Environment;
  logger?: LoggerOptions;
  debug?: boolean;
  /** Flushed when the runtime stops. */
  exceptionTracking?: ExceptionTrackingOptions;
}

export interface RuntimeBootstrapResult {
  /** The root module's view: its own providers and the exports of its imports. */
  container: AwilixContainer;
  /** Runs `onModuleInit` hooks once. */
  start(): Promise<void>;
  /** Runs destroy hooks and disposers once, then flushes the exception tracker. */
  stop(): Promise<void>;
  /**
   * Runs `work` with the services of a new scope of the root module, and disposes the scope
   * afterwards, also when `work` fails. Use one scope per use case execution.
   */
  withScope<T>(work: (services: Record<string, unknown>) => T | Promise<T>): Promise<T>;
}

/**
 * Bootstraps the modules and providers of an application without HTTP, for command-line
 * tasks, scripts and other entry points that call use cases directly. It builds the same
 * runtime as `bootstrap()` and `bootstrapWorker()`: module boundaries, provider overrides,
 * async factories and the lifecycle behave identically.
 *
 * When start-up fails, the providers it created are released and the error is rethrown;
 * values passed in through `providerOverrides` stay open. After a successful start, call
 * `stop()` when the task ends.
 *
 * @experimental The shape of this API may change in a minor release.
 */
export async function bootstrapRuntime(
  rootModule: ModuleConfig,
  options: RuntimeBootstrapOptions = {}
): Promise<RuntimeBootstrapResult> {
  const environment = options.environment ?? detectEnvironment();
  const runtime = await createApplicationRuntime(rootModule, {
    logger: createBootstrapLogger(options.logger, options.debug),
    providerOverrides: options.providerOverrides,
    exceptionTracking: options.exceptionTracking,
  });
  if (environment !== 'test') await startOrRelease(runtime);

  return {
    container: runtime.container,
    start: runtime.start,
    stop: runtime.stop,
    async withScope(work) {
      const scope = runtime.container.createScope();
      try {
        return await work(scope.cradle as Record<string, unknown>);
      } finally {
        await disposeScope(scope);
      }
    },
  };
}
