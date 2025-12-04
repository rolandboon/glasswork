import type { JobDefinition } from './types.js';

/**
 * Define a periodic job (typically triggered by EventBridge).
 */
export function definePeriodicJob(
  config: Pick<JobDefinition<undefined>, 'name' | 'queue' | 'handler'>
): JobDefinition<undefined> {
  return {
    name: config.name,
    queue: config.queue,
    handler: config.handler,
  };
}
