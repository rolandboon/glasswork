import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../../src/core/module.js';
import { defineJob } from '../../../src/jobs/define-job.js';
import { PermanentJobError, TransientJobError } from '../../../src/jobs/errors.js';
import { bootstrapWorker } from '../../../src/jobs/worker.js';
import { buildSqsEvent } from '../../helpers/sqs.js';

describe('Worker Telemetry Integration', () => {
  it('emits success EMF metric when a job succeeds', async () => {
    const sink = vi.fn();

    const job = defineJob({
      name: 'sendSuccessEmail',
      handler: () => {
        // success
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      metrics: {
        namespace: 'Test/Jobs',
        sink,
      },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'sendSuccessEmail',
        jobId: 'job-101',
        payload: { email: 'test@example.com' },
        enqueuedAt: new Date(Date.now() - 500).toISOString(),
      }),
      attributes: {
        ApproximateReceiveCount: '1',
      },
    });

    const result = await handler(event);
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);

    expect(sink).toHaveBeenCalledTimes(1);
    const metric = JSON.parse(sink.mock.calls[0][0]);
    expect(metric._aws.CloudWatchMetrics[0].Namespace).toBe('Test/Jobs');
    expect(metric.JobName).toBe('sendSuccessEmail');
    expect(metric.JobId).toBe('job-101');
    expect(metric.Status).toBe('success');
    expect(metric.JobCount).toBe(1);
    expect(metric.JobErrorCount).toBe(0);
    expect(metric.RetryCount).toBe(0);
    expect(metric.AttemptNumber).toBe(1);
    expect(metric.JobDuration).toBeGreaterThanOrEqual(0);
    expect(metric.QueueWaitTime).toBeGreaterThanOrEqual(400);
  });

  it('emits retry EMF metric when job fails transiently', async () => {
    const sink = vi.fn();

    const job = defineJob({
      name: 'flakyJob',
      retry: { maxAttempts: 3 },
      handler: () => {
        throw new TransientJobError('Rate limit exceeded');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      metrics: { sink },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'flakyJob',
        jobId: 'job-flaky',
        payload: {},
      }),
      attributes: {
        ApproximateReceiveCount: '1',
      },
    });

    const result = await handler(event);
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(1);

    expect(sink).toHaveBeenCalledTimes(1);
    const metric = JSON.parse(sink.mock.calls[0][0]);
    expect(metric.JobName).toBe('flakyJob');
    expect(metric.Status).toBe('retry');
    expect(metric.JobErrorCount).toBe(1);
    expect(metric.ErrorMessage).toBe('Rate limit exceeded');
  });

  it('emits dead_letter EMF metric when PermanentJobError is encountered', async () => {
    const sink = vi.fn();

    const job = defineJob({
      name: 'unrecoverableJob',
      handler: () => {
        throw new PermanentJobError('Invalid user ID');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      metrics: { sink },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'unrecoverableJob',
        jobId: 'job-unrec',
        payload: {},
      }),
    });

    await handler(event);

    expect(sink).toHaveBeenCalledTimes(1);
    const metric = JSON.parse(sink.mock.calls[0][0]);
    expect(metric.JobName).toBe('unrecoverableJob');
    expect(metric.Status).toBe('dead_letter');
    expect(metric.JobErrorCount).toBe(1);
    expect(metric.ErrorName).toBe('PermanentJobError');
  });

  it('emits dead_letter EMF metric when retry attempts are exhausted', async () => {
    const sink = vi.fn();

    const job = defineJob({
      name: 'retryExhaustedJob',
      retry: { maxAttempts: 2, dead: true },
      handler: () => {
        throw new Error('Database unreachable');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      metrics: { sink },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'retryExhaustedJob',
        jobId: 'job-exhausted',
        payload: {},
      }),
      ApproximateReceiveCount: '2',
    });

    await handler(event);

    expect(sink).toHaveBeenCalledTimes(1);
    const metric = JSON.parse(sink.mock.calls[0][0]);
    expect(metric.JobName).toBe('retryExhaustedJob');
    expect(metric.Status).toBe('dead_letter');
    expect(metric.JobErrorCount).toBe(1);
    expect(metric.AttemptNumber).toBe(2);
    expect(metric.RetryCount).toBe(1);
  });
});
