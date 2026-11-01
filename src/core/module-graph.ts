import type { AwilixContainer, Resolver } from 'awilix';
import { asClass, asFunction, asValue } from 'awilix';
import type { Logger } from '../utils/logger.js';
import { resolveModule } from './module.js';
import type { Constructor, ModuleConfig, ProviderConfig, ServiceScope } from './types.js';

/**
 * Collect all modules (flatten imports recursively).
 */
export function collectModules(rootModule: ModuleConfig): ModuleConfig[] {
  const modules = new Map<string, ModuleConfig>();
  const visited = new Set<string>();

  function collect(module: ModuleConfig): void {
    if (visited.has(module.name)) {
      if (modules.get(module.name) !== module) {
        throw new Error(`Duplicate module name "${module.name}"`);
      }
      return;
    }

    visited.add(module.name);
    modules.set(module.name, module);

    if (module.imports) {
      for (const importedModule of module.imports) {
        collect(resolveModule(importedModule));
      }
    }
  }

  collect(rootModule);

  return Array.from(modules.values());
}

/**
 * Validate no circular dependencies between modules.
 */
export function validateNoCycles(modules: ModuleConfig[]): void {
  const graph = new Map<string, Set<string>>();

  for (const module of modules) {
    if (!graph.has(module.name)) {
      graph.set(module.name, new Set());
    }

    if (module.imports) {
      for (const importedModule of module.imports) {
        // Deferred edges explicitly break module initialization cycles.
        if (!('forwardRef' in importedModule)) {
          graph.get(module.name)?.add(importedModule.name);
        }
      }
    }
  }

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
 * Register module providers with an Awilix container.
 * @returns Async factory provider names that must be resolved before use.
 */
export function registerModuleProviders(
  module: ModuleConfig,
  container: AwilixContainer,
  logger: Logger
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
 * Resolve async factory providers and re-register them as values.
 */
export async function resolveAsyncFactoryProviders(
  container: AwilixContainer,
  names: string[],
  logger?: Logger
): Promise<void> {
  if (names.length === 0) {
    return;
  }

  const pending = new Set(names);
  const completed = new Set<string>();
  const visiting = new Set<string>();
  async function initialize(name: string): Promise<void> {
    if (completed.has(name)) return;
    if (visiting.has(name))
      throw new Error(`Circular async factory dependency: ${[...visiting, name].join(' -> ')}`);
    visiting.add(name);
    const registration = container.registrations[name] as DependencyResolver | undefined;
    for (const dependency of registration?.dependencies ?? []) await initialize(dependency);
    if (pending.has(name)) {
      logger?.debug(`  - Resolving async factory: ${name}`);
      let value: unknown;
      try {
        value = await container.resolve(name);
      } catch (error) {
        // Disposal must not receive the rejected promise cached for this singleton.
        container.cache.delete(name);
        throw error;
      }
      registerResolvedValue(container, name, value, registration?.dispose);
    }
    visiting.delete(name);
    completed.add(name);
  }
  try {
    for (const name of names) await initialize(name);
  } catch (error) {
    logger?.error('Failed to resolve async providers', { error });
    throw error;
  }
}

/**
 * Replaces an async factory with its resolved value. The cached promise is dropped, and a
 * disposer moves to a singleton holding the value so that disposal receives the value.
 */
function registerResolvedValue(
  container: AwilixContainer,
  name: string,
  value: unknown,
  dispose: ((value: unknown) => unknown) | undefined
): void {
  container.cache.delete(name);
  if (!dispose) {
    container.register({ [name]: asValue(value) });
    return;
  }
  container.register({
    [name]: asFunction(() => value)
      .singleton()
      .disposer(dispose),
  });
  container.resolve(name);
}

/** Factory dependency metadata used to order asynchronous initialization. */
export interface DependencyResolver extends Resolver<unknown> {
  dependencies?: string[];
  /** Awilix disposer, set by `.disposer()`. */
  dispose?: (value: unknown) => unknown;
}

function registerProvider(
  provider: ProviderConfig,
  container: AwilixContainer,
  moduleName: string,
  logger: Logger
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
  logger: Logger
): void {
  const name = camelCase(provider.name);

  logger.debug(`  - Registering ${name} (${provider.name})`);

  container.register({
    [name]: asClass(provider).singleton(),
  });
}

function registerExplicitClassProvider(
  provider: Extract<ProviderConfig, { useClass: unknown }>,
  container: AwilixContainer,
  logger: Logger
): void {
  const name =
    typeof provider.provide === 'string' ? provider.provide : camelCase(provider.provide.name);

  const scope = provider.scope || 'SINGLETON';

  logger.debug(`  - Registering ${name} (scope: ${scope})`);

  const registration = applyScopeToRegistration(asClass(provider.useClass), scope);

  container.register({
    [name]: provider.dispose ? registration.disposer(provider.dispose) : registration,
  });
}

function registerValueProvider(
  provider: { provide: string; useValue: unknown },
  container: AwilixContainer,
  logger: Logger
): void {
  logger.debug(`  - Registering ${provider.provide} (value)`);

  container.register({
    [provider.provide]: asValue(provider.useValue),
  });
}

type FactoryProvider = Extract<ProviderConfig, { useFactory: unknown }>;

function registerFactoryProvider(
  provider: FactoryProvider,
  container: AwilixContainer,
  logger: Logger
): string | undefined {
  const scope = provider.scope || 'SINGLETON';
  const factory = provider.useFactory as (...args: unknown[]) => unknown;
  const isAsync = isAsyncFunction(factory);
  if (isAsync && scope !== 'SINGLETON') {
    throw new Error(`Async factory "${provider.provide}" must use SINGLETON scope`);
  }
  logger.debug(
    `  - Registering ${provider.provide} (factory${isAsync ? ' async' : ''}, scope: ${scope})`
  );

  const registration = applyScopeToRegistration(
    Object.assign(asFunction(factory), { dependencies: provider.inject ?? [] }),
    scope
  );

  container.register({
    [provider.provide]: provider.dispose ? registration.disposer(provider.dispose) : registration,
  });

  return isAsync ? provider.provide : undefined;
}

function isAsyncFunction(fn: (...args: unknown[]) => unknown): boolean {
  return fn.constructor.name === 'AsyncFunction';
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

function camelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}
