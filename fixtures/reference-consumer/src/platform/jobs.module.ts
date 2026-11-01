import { defineModule } from 'glasswork/core';
import { JobService, MockQueueDriver, type QueueDriver } from 'glasswork/jobs';

/**
 * Jobs run in-process here; production would select an SQS driver. The driver resolves
 * services through this module, and each job still runs in the module that declares it.
 */
export const JobsModule = defineModule({
  name: 'jobs',
  providers: [
    {
      provide: 'queueDriver',
      useFactory: (services: Record<string, unknown>) =>
        new MockQueueDriver({ executeImmediately: true, serviceResolver: () => services }),
    },
    {
      provide: 'jobService',
      useFactory: ({ queueDriver }: { queueDriver: QueueDriver }) => new JobService(queueDriver),
    },
  ],
  exports: ['jobService'],
});
