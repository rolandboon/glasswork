import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { TransientJobError } from '../../src/jobs/errors.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { buildSqsEvent } from '../helpers/sqs.js';

describe('bootstrapWorker', () => {
  it('supports non-SQS invocation (periodic job)', async () => {
    const executed: string[] = [];
    const job = defineJob({
      name: 'periodic',
      handler: () => {
        executed.push('ok');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const result = await handler({ jobName: 'periodic', payload: {} });
    expect(result).toEqual({ success: true });
    expect(executed).toEqual(['ok']);
  });

  it('resolves job name from event.detail.name', async () => {
    const executed: string[] = [];
    const job = defineJob({
      name: 'from-detail',
      handler: () => {
        executed.push('ran');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });
    const result = await handler({ detail: { name: 'from-detail', payload: { id: 1 } } });

    expect(result).toEqual({ success: true });
    expect(executed).toEqual(['ran']);
  });

  it('calls onJobFailed hook when job throws', async () => {
    const onJobFailed = vi.fn();
    const job = defineJob({
      name: 'failing',
      handler: () => {
        throw new TransientJobError('retry me');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'failing',
        payload: {},
      }),
    });

    const result = await handler(event);

    expect(onJobFailed).toHaveBeenCalledTimes(1);
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
  });

  it('resolves async providers before processing jobs', async () => {
    const job = defineJob({
      name: 'async-provider-job',
      handler: (_payload, { services }) => {
        expect((services as { asyncService: { ready: boolean } }).asyncService.ready).toBe(true);
      },
    });

    const module = defineModule({
      name: 'worker',
      providers: [
        {
          provide: 'asyncService',
          useFactory: async () => ({ ready: true }),
        },
      ],
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'async-provider-job',
        payload: {},
        jobId: 'job-async',
      }),
    });

    const result = await handler(event);
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
  });
});
