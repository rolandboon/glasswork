import type { Constructor, ForwardReference, ModuleConfig, ProviderConfig } from './types.js';

/**
 * Define a module with providers, imports, and routes.
 *
 * This is a pure metadata function - it just returns the configuration.
 * The actual registration happens in the bootstrap function.
 *
 * @example
 * ```typescript
 * export const AuthModule = defineModule({
 *   name: 'auth',
 *   basePath: 'auth',
 *   providers: [AuthService, UserService],
 *   imports: [CommonModule],
 *   exports: [AuthService],
 *   routes: AuthRoutes,
 * });
 * ```
 */
export function defineModule(config: ModuleConfig): ModuleConfig {
  validateModuleConfig(config);
  return config;
}

function validateModuleConfig(config: ModuleConfig): void {
  validateModuleName(config.name);
  validateProviders(config);
  validateExports(config);
}

function validateModuleName(name: string): void {
  if (!name) {
    throw new Error('Module name is required');
  }

  if (name.includes('/') || name.includes(' ')) {
    throw new Error('Module name must not contain "/" or spaces');
  }
}

function validateProviders(config: ModuleConfig): void {
  if (!config.providers) {
    return;
  }

  for (const provider of config.providers) {
    if (typeof provider !== 'function' && typeof provider !== 'object') {
      throw new Error(`Invalid provider in module "${config.name}"`);
    }
  }
}

function validateExports(config: ModuleConfig): void {
  if (!config.exports) {
    return;
  }

  const providerNames = collectProviderNames(config.providers ?? []);

  for (const exp of config.exports) {
    if (typeof exp === 'object') continue;
    const exportName = getProviderName(exp);
    if (!providerNames.has(exportName)) {
      throw new Error(`Module "${config.name}" exports "${exportName}" but it's not in providers`);
    }
  }
}

function collectProviderNames(providers: ProviderConfig[]): Set<string> {
  const names = new Set<string>();

  for (const provider of providers) {
    names.add(getProviderName(provider));
  }

  return names;
}

export function getProviderName(provider: ProviderConfig | Constructor | string): string {
  if (typeof provider === 'string') {
    return provider;
  }

  if (typeof provider === 'function') {
    return camelCase(provider.name);
  }

  if ('provide' in provider) {
    return typeof provider.provide === 'string'
      ? provider.provide
      : camelCase((provider.provide as Constructor).name);
  }

  return '';
}

/**
 * Convert PascalCase to camelCase
 */
function camelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/** Defer a module import to allow explicitly declared circular module graphs. */
export function forwardRef(factory: () => ModuleConfig): ForwardReference {
  return { forwardRef: factory };
}

export function resolveModule(reference: ModuleConfig | ForwardReference): ModuleConfig {
  const module = 'forwardRef' in reference ? reference.forwardRef() : reference;
  if (!module?.name) throw new Error('Module import is undefined or has no name');
  return module;
}
