import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';
import { JobService } from '../../src/jobs/job-service.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { createLogger } from '../../src/utils/logger.js';

interface InvitationServices {
  invitationJobsService: { send(id: string): string };
  attemptState: { id: number };
}

const sent: string[] = [];
const scopes: number[] = [];
let nextScope = 0;

const sendInvitation = defineJob({
  name: 'send-invitation',
  schema: v.object({ invitationId: v.string() }),
  handler: async ({ invitationId }, { services }) => {
    const { invitationJobsService, attemptState } = services as unknown as InvitationServices;
    sent.push(invitationJobsService.send(invitationId));
    scopes.push(attemptState.id);
  },
});

const unownedJob = defineJob({
  name: 'unowned',
  handler: async (_payload, { services }) => {
    sent.push((services as { shared: string }).shared);
  },
});

// The infrastructure module builds the driver from its own injected services, as
// applications do to switch between SQS and in-process execution.
const JobsModule = defineModule({
  name: 'jobs',
  providers: [
    { provide: 'shared', useValue: 'from jobs module' },
    {
      provide: 'queueDriver',
      useFactory: (services: Record<string, unknown>) =>
        new MockQueueDriver({
          executeImmediately: true,
          serviceResolver: () => services,
          logger: createLogger('jobs', 'silent'),
        }),
    },
    {
      provide: 'jobService',
      useFactory: ({ queueDriver }: { queueDriver: MockQueueDriver }) =>
        new JobService(queueDriver),
    },
  ],
  exports: ['jobService', 'queueDriver'],
});

const VotingModule = defineModule({
  name: 'voting',
  imports: [JobsModule],
  providers: [
    {
      provide: 'invitationJobsService',
      useValue: { send: (id: string) => `sent ${id}` },
    },
    { provide: 'attemptState', scope: 'SCOPED', useFactory: () => ({ id: ++nextScope }) },
  ],
  jobs: [sendInvitation],
});

const AppModule = defineModule({ name: 'app', imports: [VotingModule, JobsModule] });

describe('MockQueueDriver with module boundaries', () => {
  it('runs a job with the private services of the module that declares it', async () => {
    sent.length = 0;
    const { container } = await bootstrap(AppModule, { environment: 'test' });
    const jobService = container.resolve('jobService') as JobService;

    await jobService.enqueue(sendInvitation, { invitationId: 'inv-1' });

    expect(sent).toEqual(['sent inv-1']);
  });

  it('opens a new scope for every local execution', async () => {
    scopes.length = 0;
    const { container } = await bootstrap(AppModule, { environment: 'test' });
    const jobService = container.resolve('jobService') as JobService;

    await jobService.enqueue(sendInvitation, { invitationId: 'inv-1' });
    await jobService.enqueue(sendInvitation, { invitationId: 'inv-2' });

    expect(new Set(scopes).size).toBe(2);
  });

  it('resolves the same services as the worker', async () => {
    sent.length = 0;
    const handler = bootstrapWorker({
      module: AppModule,
      logger: createLogger('worker', 'silent'),
    });

    await handler({ jobName: 'send-invitation', payload: { invitationId: 'inv-3' } });

    expect(sent).toEqual(['sent inv-3']);
  });

  it('keeps using the resolved services for jobs that no module declares', async () => {
    sent.length = 0;
    const { container } = await bootstrap(AppModule, { environment: 'test' });
    const jobService = container.resolve('jobService') as JobService;

    await jobService.enqueue(unownedJob, {});

    expect(sent).toEqual(['from jobs module']);
  });

  it('keeps plain service objects working', async () => {
    const handler = vi.fn();
    const job = defineJob({ name: 'plain', handler });
    const driver = new MockQueueDriver({
      executeImmediately: true,
      serviceResolver: () => ({ shared: 'plain' }),
      logger: createLogger('jobs', 'silent'),
    });

    await new JobService(driver).enqueue(job, {});

    expect(handler.mock.calls[0]?.[1].services).toEqual({ shared: 'plain' });
  });
});
