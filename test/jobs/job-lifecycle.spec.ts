import { AsyncLocalStorage } from 'node:async_hooks';
import { object, string } from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/index.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';
import { PermanentJobError } from '../../src/jobs/errors.js';
import { runJobAttempt } from '../../src/jobs/job-runner.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';

describe('validated job lifecycle', () => {
  it('shares tenant context and typed services across local and worker terminal failure hooks', async () => {
    const context = new AsyncLocalStorage<string>();
    const record = vi.fn();
    const schema = object({ tenant: string() });
    const job = defineJob<typeof schema, { record: typeof record }>({
      name: 'context-job',
      schema,
      runInContext: (payload, _ctx, execute) => context.run(payload.tenant, execute),
      handler: (_payload, ctx) => {
        ctx.services.record('handler', context.getStore());
        throw new PermanentJobError('failed');
      },
      onDeadLetter: (_payload, ctx) => {
        ctx.services.record('dead', context.getStore());
      },
    });
    const driver = new MockQueueDriver({
      executeImmediately: true,
      serviceResolver: () => ({ record }),
    });
    await expect(
      driver.enqueue({ jobName: job.name, __job: job, payload: { tenant: 'local' } })
    ).rejects.toThrow('failed');
    const worker = bootstrapWorker({
      module: defineModule({
        name: 'jobs',
        jobs: [job],
        providers: [{ provide: 'record', useValue: record }],
      }),
      metrics: { enabled: false },
    });
    await expect(worker({ jobName: job.name, payload: { tenant: 'worker' } })).rejects.toThrow(
      'failed'
    );
    expect(record.mock.calls).toEqual([
      ['handler', 'local'],
      ['dead', 'local'],
      ['handler', 'worker'],
      ['dead', 'worker'],
    ]);
    expect(context.getStore()).toBeUndefined();
  });

  it('does not derive context or run typed failure hooks from invalid input', async () => {
    const wrapper = vi.fn();
    const dead = vi.fn();
    const job = defineJob({
      name: 'validated',
      schema: object({ tenant: string() }),
      runInContext: wrapper,
      onDeadLetter: dead,
      handler: vi.fn(),
    });
    await expect(
      runJobAttempt(
        job,
        { tenant: 1 },
        { services: {}, jobId: '1', attemptNumber: 25, enqueuedAt: new Date() }
      )
    ).rejects.toThrow();
    expect(wrapper).not.toHaveBeenCalled();
    expect(dead).not.toHaveBeenCalled();
  });
});
