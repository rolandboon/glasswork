import type { AwilixContainer } from 'awilix';
import { asClass, asFunction, asValue } from 'awilix';
import type { Logger } from '../utils/logger.js';
import type { Constructor, ModuleConfig, ProviderConfig, ServiceScope } from './types.js';

/**
 * Collect all modules (flatten imports recursively).
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
        graph.get(module.name)?.add(importedModule.name);
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

  try {
    // Resolve in registration order so async factories can depend on earlier ones.
    for (const name of names) {
      logger?.debug(`  - Resolving async factory: ${name}`);
      const resolved = container.resolve(name);
      const value = resolved instanceof Promise ? await resolved : resolved;
      container.register({
        [name]: asValue(value),
      });
      logger?.debug(`  - Resolved ${name} (async factory → value)`);
    }
  } catch (error) {
    logger?.error('Failed to resolve async providers', { error });
    throw error;
  }
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
  provider: { provide: string | Constructor; useClass: Constructor; scope?: ServiceScope },
  container: AwilixContainer,
  logger: Logger
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
  logger.debug(
    `  - Registering ${provider.provide} (factory${isAsync ? ' async' : ''}, scope: ${scope})`
  );

  const registration = asFunction(factory);

  if (provider.inject && provider.inject.length > 0) {
    registration.inject(() => provider.inject as string[]);
  }

  container.register({
    [provider.provide]: applyScopeToRegistration(registration, scope),
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
