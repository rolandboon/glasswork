import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { TransientJobError } from '../../src/jobs/errors.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { buildSqsEvent } from '../helpers/sqs.js';

describe('bootstrapWorker', () => {
  it('logs transient error with retryAfter', async () => {
    const onJobFailed = vi.fn();
    const job = defineJob({
      name: 'transient-with-delay',
      handler: () => {
        throw new TransientJobError('retry me', 5000);
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
        jobName: 'transient-with-delay',
        payload: {},
      }),
    });

    const result = await handler(event);

    expect(onJobFailed).toHaveBeenCalledTimes(1);
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
  });

  it('uses module logger for job execution when available', async () => {
    const childLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      child: vi.fn(),
    };
    const moduleLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      child: vi.fn().mockReturnValue(childLogger),
    };

    const job = defineJob({
      name: 'logger-job',
      handler: (_payload, ctx) => {
        expect(ctx.logger).toBe(childLogger);
      },
    });

    const module = defineModule({
      name: 'worker',
      providers: [
        {
          provide: 'logger',
          useValue: moduleLogger,
        },
      ],
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'logger-job',
        payload: {},
        jobId: 'job-logger',
      }),
    });

    const result = await handler(event);
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
    expect(moduleLogger.child).toHaveBeenCalledWith({ jobId: 'job-logger', jobName: 'logger-job' });
  });

  it('uses module logger without child method when child is not available', async () => {
    const moduleLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const job = defineJob({
      name: 'logger-no-child-job',
      handler: (_payload, ctx) => {
        expect(ctx.logger).toBe(moduleLogger);
      },
    });

    const module = defineModule({
      name: 'worker',
      providers: [
        {
          provide: 'logger',
          useValue: moduleLogger,
        },
      ],
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'logger-no-child-job',
        payload: {},
      }),
    });

    const result = await handler(event);
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
  });
});
