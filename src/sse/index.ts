import { defineModule } from '../core/module.js';
import type { ModuleConfig } from '../core/types.js';
import { SseBroadcaster, type SseBroadcasterOptions } from './sse-broadcaster.js';

export { SseBroadcaster, type SseBroadcasterOptions } from './sse-broadcaster.js';

/** Register one broadcaster per application container, without exposing a public route. */
export function createSseModule(options: SseBroadcasterOptions = {}): ModuleConfig {
  return defineModule({
    name: 'sse',
    providers: [
      {
        provide: 'sseBroadcaster',
        useFactory: () => new SseBroadcaster(options),
        scope: 'SINGLETON',
      },
    ],
    exports: ['sseBroadcaster'],
  });
}
