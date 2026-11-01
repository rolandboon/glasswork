import { type AwilixContainer, Lifetime } from 'awilix';
import type { Logger } from '../utils/logger.js';

/**
 * Execute lifecycle hooks on singleton and value providers in parallel.
 *
 * `onModuleInit` creates every singleton to initialize it. `onModuleDestroy` only reaches
 * singletons that were already created, so shutdown never constructs a provider just to
 * destroy it. Every hook runs to completion before failures are reported: one failure is
 * rethrown as-is, several are combined in an `AggregateError`.
 */
export async function executeLifecycleHooks(
  container: AwilixContainer,
  hook: 'onModuleInit' | 'onModuleDestroy',
  logger: Logger
): Promise<void> {
  const cradle = container.cradle as Record<string, unknown>;
  const names = Object.keys(cradle).filter((name) => {
    const lifetime = container.registrations[name]?.lifetime;
    if (lifetime && lifetime !== Lifetime.SINGLETON) return false;
    return hook === 'onModuleInit' || !lifetime || container.cache.has(name);
  });

  const results = await Promise.allSettled(
    names.map(async (name) => {
      try {
        const service = cradle[name];
        if (!hasHook(service, hook)) return;
        logger.debug(`Executing ${hook} for ${name}`);
        await service[hook]();
      } catch (error) {
        logger.error(`Error in ${hook} for ${name}`, error);
        throw error;
      }
    })
  );

  throwFailures(
    results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
    `${hook} failed`
  );
}

/** Rethrows a single failure unchanged and combines several in an AggregateError. */
export function throwFailures(failures: unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, `${message} (${failures.length} errors)`);
  }
}

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

export interface ApplicationLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Runs an application's start and stop steps at most once.
 *
 * Concurrent calls share one promise, so `start()` only resolves after the start step has
 * finished. A failed start keeps rejecting with its original error. `stop()` waits for a
 * pending start to settle before it runs, and `start()` rejects once `stop()` was called.
 */
export function createApplicationLifecycle(steps: {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}): ApplicationLifecycle {
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;

  return {
    start() {
      if (stopping) {
        return Promise.reject(new Error('Application has been stopped and cannot start again'));
      }
      starting ??= steps.start();
      return starting;
    },
    stop() {
      stopping ??= (async () => {
        await starting?.catch(() => undefined);
        await steps.stop();
      })();
      return stopping;
    },
  };
}
