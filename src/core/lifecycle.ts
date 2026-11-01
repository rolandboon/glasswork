import { type AwilixContainer, Lifetime } from 'awilix';
import type { Logger } from '../utils/logger.js';

/**
 * Execute lifecycle hooks on all registered services in parallel.
 */
export async function executeLifecycleHooks(
  container: AwilixContainer,
  hook: 'onModuleInit' | 'onModuleDestroy',
  logger: Logger
): Promise<void> {
  const cradle = container.cradle as Record<string, unknown>;
  const serviceNames = Object.keys(cradle);

  const promises: Promise<void>[] = [];

  for (const name of serviceNames) {
    const lifetime = container.registrations[name]?.lifetime;
    if (lifetime && lifetime !== Lifetime.SINGLETON) continue;
    const service = cradle[name];

    if (hasHook(service, hook)) {
      logger.debug(`Executing ${hook} for ${name}`);
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

  await Promise.all(promises);
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
