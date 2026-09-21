import { AsyncLocalStorage } from 'node:async_hooks';
import { type AwilixContainer, Lifetime } from 'awilix';
import type { MiddlewareHandler } from 'hono';

/**
 * Bridges route factories, which run during bootstrap, to an Awilix scope that
 * exists only while the current HTTP request is being handled.
 */
export class HttpRequestScope {
  readonly #storage = new AsyncLocalStorage<AwilixContainer>();
  readonly #proxies = new Map<string, unknown>();

  middleware(container: AwilixContainer): MiddlewareHandler {
    return async (_context, next) => {
      const scope = container.createScope();

      try {
        await this.#storage.run(scope, next);
      } finally {
        await scope.dispose();
      }
    };
  }

  routeServices(container: AwilixContainer): Record<string, unknown> {
    return new Proxy<Record<string, unknown>>(Object.create(null), {
      get: (_target, property) => {
        if (typeof property !== 'string') return undefined;

        const registration = container.registrations[property];
        if (
          registration?.lifetime === Lifetime.SCOPED ||
          registration?.lifetime === Lifetime.TRANSIENT
        ) {
          return this.#requestScopedProxy(property, registration.lifetime === Lifetime.SCOPED);
        }

        return container.resolve(property);
      },
      getOwnPropertyDescriptor: (_target, property) => {
        if (typeof property !== 'string' || !container.hasRegistration(property)) return undefined;
        return { configurable: true, enumerable: true };
      },
      has: (_target, property) =>
        typeof property === 'string' && container.hasRegistration(property),
      ownKeys: () => Object.keys(container.registrations),
    });
  }

  #requestScopedProxy(name: string, shared: boolean): unknown {
    const existing = shared ? this.#proxies.get(name) : undefined;
    if (existing) return existing;

    const instances = new WeakMap<AwilixContainer, unknown>();
    const resolve = (): unknown => {
      const scope = this.#storage.getStore();
      if (!scope) {
        throw new Error(
          `Scoped provider "${name}" can only be used while handling an HTTP request`
        );
      }
      if (!instances.has(scope)) instances.set(scope, scope.resolve(name));
      return instances.get(scope);
    };

    const callable = (...args: unknown[]) => {
      const service = resolve();
      if (typeof service !== 'function') {
        throw new TypeError(`Scoped provider "${name}" is not callable`);
      }
      return Reflect.apply(service, undefined, args);
    };

    const proxy = new Proxy(callable, {
      apply: (_target, thisArg, args) => {
        const service = resolve();
        if (typeof service !== 'function') {
          throw new TypeError(`Scoped provider "${name}" is not callable`);
        }
        return Reflect.apply(service, thisArg, args);
      },
      get: (_target, property) => {
        const service = resolve();
        const value = Reflect.get(Object(service), property, service);
        return typeof value === 'function' ? value.bind(service) : value;
      },
      set: (_target, property, value) => {
        const service = resolve();
        return Reflect.set(Object(service), property, value, service);
      },
    });

    if (shared) this.#proxies.set(name, proxy);
    return proxy;
  }
}
