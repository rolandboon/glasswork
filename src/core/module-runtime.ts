import {
  type AwilixContainer,
  asClass,
  asFunction,
  createContainer,
  InjectionMode,
  type Resolver,
} from 'awilix';
import type { Logger } from '../utils/logger.js';
import { getProviderName } from './module.js';
import { registerModuleProviders } from './module-graph.js';
import type { ModuleConfig } from './types.js';

/** Module names are translated only at the edge; Awilix owns caching and lifetimes. */
export class ModuleRuntime {
  readonly container = createContainer({ injectionMode: InjectionMode.PROXY, strict: true });
  readonly asyncFactories: string[] = [];
  readonly #locals = new Map<ModuleConfig, Map<string, string>>();
  readonly #exports = new Map<ModuleConfig, Map<string, string>>();
  readonly #visible = new Map<ModuleConfig, Map<string, string>>();
  readonly #views = new WeakMap<AwilixContainer, Map<ModuleConfig, AwilixContainer>>();

  constructor(
    readonly modules: ModuleConfig[],
    logger: Logger
  ) {
    for (const module of modules) {
      const names = new Map<string, string>();
      for (const provider of module.providers ?? []) {
        const name = getProviderName(provider);
        if (names.has(name))
          throw new Error(`Duplicate provider "${name}" in module "${module.name}"`);
        names.set(name, `${module.name}/${name}`);
      }
      this.#locals.set(module, names);
    }
    this.#collectExports();
    for (const module of modules) this.#visible.set(module, this.#visibility(module));
    // Register everything before resolving anything.
    for (const module of modules) {
      const names = registerModuleProviders(module, this.forModule(module), logger);
      this.asyncFactories.push(...names.map((name) => this.#token(module, name)));
    }
  }

  #exportCandidates(
    module: ModuleConfig,
    entry: NonNullable<ModuleConfig['exports']>[number]
  ): Iterable<[string, string]> {
    if (typeof entry === 'object') {
      if (!(module.imports ?? []).includes(entry)) {
        throw new Error(
          `Module "${module.name}" re-exports a module it does not import: "${entry.name}"`
        );
      }
      return this.#exports.get(entry) ?? [];
    }
    const name = getProviderName(entry);
    const token = this.#locals.get(module)?.get(name);
    if (!token)
      throw new Error(
        `Module "${module.name}" exports unknown provider "${name}". Re-export the imported module instead.`
      );
    return [[name, token]];
  }

  #mergeExports(module: ModuleConfig): boolean {
    const exported = this.#exports.get(module) as Map<string, string>;
    let changed = false;
    for (const entry of module.exports ?? []) {
      for (const [name, token] of this.#exportCandidates(module, entry)) {
        const previous = exported.get(name);
        if (previous && previous !== token)
          throw new Error(`Ambiguous exported provider "${name}" in module "${module.name}"`);
        if (!previous) {
          exported.set(name, token);
          changed = true;
        }
      }
    }
    return changed;
  }

  #collectExports(): void {
    for (const module of this.modules) this.#exports.set(module, new Map());
    // Fixed point: re-exports are merged regardless of module order.
    let changed = true;
    while (changed) {
      changed = false;
      for (const module of this.modules) {
        if (this.#mergeExports(module)) changed = true;
      }
    }
  }

  #visibility(module: ModuleConfig): Map<string, string> {
    const locals = this.#locals.get(module) as Map<string, string>;
    const visible = new Map(locals);
    for (const imported of module.imports ?? []) {
      for (const [name, token] of this.#exports.get(imported) ?? []) {
        if (locals.has(name)) continue;
        const previous = visible.get(name);
        if (previous && previous !== token) {
          throw new Error(`Ambiguous imported provider "${name}" in module "${module.name}"`);
        }
        visible.set(name, token);
      }
    }
    return visible;
  }

  /** Imports are fixed at bootstrap; names registered later belong to the registering module. */
  #lookup(module: ModuleConfig, name: string, container: AwilixContainer): string | undefined {
    const own = `${module.name}/${name}`;
    return (
      this.#visible.get(module)?.get(name) ?? (container.getRegistration(own) ? own : undefined)
    );
  }

  #token(module: ModuleConfig, name: string | symbol, container = this.container): string {
    const token = typeof name === 'string' ? this.#lookup(module, name, container) : undefined;
    if (!token)
      throw new Error(
        `Provider "${String(name)}" is not available in module "${module.name}". Import its module and export the provider.`
      );
    return token;
  }

  #names(module: ModuleConfig, container: AwilixContainer): string[] {
    const prefix = `${module.name}/`;
    const registered = Object.keys(container.registrations)
      .filter((token) => token.startsWith(prefix))
      .map((token) => token.slice(prefix.length));
    return [...new Set([...(this.#visible.get(module)?.keys() ?? []), ...registered])];
  }

  #register(
    module: ModuleConfig,
    target: AwilixContainer,
    name: string | symbol,
    registration?: Resolver<unknown>
  ): void {
    if (!registration) throw new Error(`Missing resolver for "${String(name)}"`);
    if (typeof name !== 'string') throw new Error('Module provider tokens must be strings');
    const token = `${module.name}/${name}`;
    if ((this.#lookup(module, name, target) ?? token) !== token) {
      throw new Error(
        `Provider "${name}" is imported into module "${module.name}" and cannot be registered there. Use providerOverrides to replace it.`
      );
    }
    const originalResolve = registration.resolve;
    const wrapped: Resolver<unknown> = {
      ...registration,
      resolve: (scope) => originalResolve.call(registration, this.forModule(module, scope)),
    };
    target.register(token, wrapped);
  }

  /** A container view exposes only local providers and direct imports' exports. */
  forModule(module: ModuleConfig, container = this.container): AwilixContainer {
    const views = this.#views.get(container) ?? new Map<ModuleConfig, AwilixContainer>();
    this.#views.set(container, views);
    const view = views.get(module) ?? this.#createView(module, container);
    views.set(module, view);
    return view;
  }

  #createView(module: ModuleConfig, container: AwilixContainer): AwilixContainer {
    if (!this.#visible.has(module)) throw new Error(`Unknown module "${module.name}"`);
    const has = (name: string | symbol) =>
      typeof name === 'string' && this.#lookup(module, name, container) !== undefined;
    const resolve = (name: string | symbol, options?: { allowUnregistered?: boolean }) => {
      if (!has(name) && (options?.allowUnregistered || name === 'then')) return undefined;
      return container.resolve(this.#token(module, name, container), options);
    };
    const cradle = new Proxy(Object.create(null), {
      get: (_target, name) => resolve(name),
      has: (_target, name) => has(name),
      ownKeys: () => this.#names(module, container),
      getOwnPropertyDescriptor: (_target, name) =>
        has(name) ? { configurable: true, enumerable: true } : undefined,
    });
    const view: AwilixContainer = new Proxy(container, {
      get: (target, property) => {
        switch (property) {
          case 'cradle':
            return cradle;
          case 'resolve':
            return resolve;
          case 'registrations':
            return Object.fromEntries(
              this.#names(module, target).map((name) => [
                name,
                target.registrations[this.#token(module, name, target)],
              ])
            );
          case 'hasRegistration':
            return (name: string) =>
              has(name) && target.hasRegistration(this.#token(module, name, target));
          case 'getRegistration':
            return (name: string) =>
              has(name) ? target.getRegistration(this.#token(module, name, target)) : null;
          case 'build':
            return (
              target: Parameters<AwilixContainer['build']>[0],
              options?: Parameters<AwilixContainer['build']>[1]
            ) => {
              if (typeof target === 'function') {
                const resolver = /^class\s/.test(Function.prototype.toString.call(target))
                  ? asClass(target as Parameters<typeof asClass>[0], options)
                  : asFunction(target as Parameters<typeof asFunction>[0], options);
                return resolver.resolve(view);
              }
              return target.resolve(view);
            };
          case 'createScope':
            return () => this.forModule(module, target.createScope());
          case 'register':
            return (
              nameOrMap: string | symbol | Record<string, Resolver<unknown>>,
              resolver?: Resolver<unknown>
            ) => {
              const entries =
                typeof nameOrMap === 'object'
                  ? Object.entries(nameOrMap)
                  : [[nameOrMap, resolver] as const];
              for (const [name, registration] of entries) {
                this.#register(module, target, name, registration);
              }
              return view;
            };
          default:
            return Reflect.get(target, property);
        }
      },
    });
    return view;
  }
}
