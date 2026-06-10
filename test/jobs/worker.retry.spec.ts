import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { buildSqsEvent } from '../helpers/sqs.js';

describe('bootstrapWorker', () => {
  // Retry configuration tests

  it('discards job without throwing when retry: false is configured', async () => {
    const onJobFailed = vi.fn();
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'no-retry-job',
      retry: false,
      handler: () => {
        throw new Error('This should be discarded');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed, onJobDeadLetter },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'no-retry-job',
        payload: {},
        jobId: 'job-discard',
      }),
    });

    const result = await handler(event);

    // Job should NOT cause a batch failure since it's discarded
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(0);
    expect(onJobFailed).toHaveBeenCalledTimes(1);
    expect(onJobDeadLetter).not.toHaveBeenCalled();
  });

  it('triggers onJobDeadLetter when retries are exhausted', async () => {
    const onJobFailed = vi.fn();
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'limited-retry-job',
      retry: { maxAttempts: 3 },
      handler: () => {
        throw new Error('Always fails');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed, onJobDeadLetter },
    });

    // Simulate attempt 3 (the final attempt)
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'limited-retry-job',
        payload: {},
        jobId: 'job-exhausted',
      }),
      ApproximateReceiveCount: '3',
    });

    const result = await handler(event);

    // Should still return batch failure to let SQS send to DLQ
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
    expect(onJobFailed).toHaveBeenCalledTimes(1);
    expect(onJobDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('does not throw when retries exhausted with dead: false (discards silently)', async () => {
    const onJobFailed = vi.fn();
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'discard-on-exhaust-job',
      retry: { maxAttempts: 2, dead: false },
      handler: () => {
        throw new Error('Fail and discard');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed, onJobDeadLetter },
    });

    // Simulate attempt 2 (exhausted)
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'discard-on-exhaust-job',
        payload: {},
        jobId: 'job-discard-exhaust',
      }),
      ApproximateReceiveCount: '2',
    });

    const result = await handler(event);

    // Should NOT cause batch failure since dead: false means discard
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(0);
    expect(onJobFailed).toHaveBeenCalledTimes(1);
    expect(onJobDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('uses default 25 retries when retry is not configured', async () => {
    const onJobFailed = vi.fn();
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'default-retry-job',
      // No retry config = default 25 attempts
      handler: () => {
        throw new Error('Fail');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed, onJobDeadLetter },
    });

    // Simulate attempt 24 (not exhausted yet)
    const eventNotExhausted = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'default-retry-job',
        payload: {},
        jobId: 'job-default-24',
      }),
      ApproximateReceiveCount: '24',
    });

    const result1 = await handler(eventNotExhausted);
    const failures1 = 'batchItemFailures' in result1 ? (result1.batchItemFailures ?? []) : [];
    expect(failures1).toHaveLength(1);
    expect(onJobDeadLetter).not.toHaveBeenCalled();

    onJobFailed.mockClear();
    onJobDeadLetter.mockClear();

    // Simulate attempt 25 (exhausted)
    const eventExhausted = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'default-retry-job',
        payload: {},
        jobId: 'job-default-25',
      }),
      ApproximateReceiveCount: '25',
    });

    const result2 = await handler(eventExhausted);
    const failures2 = 'batchItemFailures' in result2 ? (result2.batchItemFailures ?? []) : [];
    expect(failures2).toHaveLength(1);
    expect(onJobDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('supports shorthand number syntax for retry config', async () => {
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'shorthand-retry-job',
      retry: 2, // Shorthand for { maxAttempts: 2 }
      handler: () => {
        throw new Error('Fail');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobDeadLetter },
    });

    // Attempt 2 should trigger dead letter
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'shorthand-retry-job',
        payload: {},
        jobId: 'job-shorthand',
      }),
      ApproximateReceiveCount: '2',
    });

    await handler(event);
    expect(onJobDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('retries normally when under maxAttempts threshold', async () => {
    const onJobFailed = vi.fn();
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'retry-under-threshold',
      retry: { maxAttempts: 5 },
      handler: () => {
        throw new Error('Transient failure');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed, onJobDeadLetter },
    });

    // Attempt 3 of 5 - should retry without dead letter
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'retry-under-threshold',
        payload: {},
        jobId: 'job-under',
      }),
      ApproximateReceiveCount: '3',
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1); // Batch failure to trigger retry
    expect(onJobFailed).toHaveBeenCalledTimes(1);
    expect(onJobDeadLetter).not.toHaveBeenCalled();
  });

  it('treats zero maxAttempts as no retries (discards on first failure)', async () => {
    const onJobFailed = vi.fn();
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'zero-retry-job',
      retry: 0, // Zero should be treated as retry: false
      handler: () => {
        throw new Error('Should be discarded');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed, onJobDeadLetter },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'zero-retry-job',
        payload: {},
        jobId: 'job-zero',
      }),
    });

    const result = await handler(event);

    // Should NOT cause a batch failure since zero means discard
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(0);
    expect(onJobFailed).toHaveBeenCalledTimes(1);
    expect(onJobDeadLetter).not.toHaveBeenCalled();
  });

  it('treats negative maxAttempts as no retries (discards on first failure)', async () => {
    const onJobFailed = vi.fn();
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'negative-retry-job',
      retry: -1, // Negative should be treated as retry: false
      handler: () => {
        throw new Error('Should be discarded');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed, onJobDeadLetter },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'negative-retry-job',
        payload: {},
        jobId: 'job-negative',
      }),
    });

    const result = await handler(event);

    // Should NOT cause a batch failure since negative means discard
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(0);
    expect(onJobFailed).toHaveBeenCalledTimes(1);
    expect(onJobDeadLetter).not.toHaveBeenCalled();
  });

  it('treats object config with zero maxAttempts as no retries', async () => {
    const onJobFailed = vi.fn();
    const onJobDeadLetter = vi.fn();

    const job = defineJob({
      name: 'zero-object-retry-job',
      retry: { maxAttempts: 0 }, // Object config with zero
      handler: () => {
        throw new Error('Should be discarded');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobFailed, onJobDeadLetter },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'zero-object-retry-job',
        payload: {},
        jobId: 'job-zero-obj',
      }),
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(0);
    expect(onJobFailed).toHaveBeenCalledTimes(1);
    expect(onJobDeadLetter).not.toHaveBeenCalled();
  });
});
