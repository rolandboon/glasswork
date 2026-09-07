import type { AwilixContainer } from 'awilix';
import type { Logger } from '../utils/logger.js';

export type LifecycleHook = 'onModuleInit' | 'onModuleDestroy' | 'onServerStart';

/**
 * Execute lifecycle hooks on all registered services in parallel.
 */
export async function executeLifecycleHooks(
  container: AwilixContainer,
  hook: LifecycleHook,
  logger: Logger,
  context?: unknown
): Promise<void> {
  const cradle = container.cradle as Record<string, unknown>;
  const serviceNames = Object.keys(cradle);

  const promises: Promise<void>[] = [];

  for (const name of serviceNames) {
    const service = cradle[name];

    if (hasHook(service, hook)) {
      logger.debug(`Executing ${hook} for ${name}`);
      promises.push(
        Promise.resolve()
          .then(() =>
            (service as Record<string, (ctx?: unknown) => void | Promise<void>>)[hook](context)
          )
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
  hook: LifecycleHook
): service is { [K in LifecycleHook]: (ctx?: unknown) => void | Promise<void> } {
  return (
    service !== null &&
    typeof service === 'object' &&
    hook in service &&
    typeof (service as Record<string, unknown>)[hook] === 'function'
  );
}
