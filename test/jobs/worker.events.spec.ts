import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { buildSqsEvent } from '../helpers/sqs.js';

describe('bootstrapWorker', () => {
  it('handles event.detail.jobName for non-SQS invocation', async () => {
    const executed: string[] = [];
    const job = defineJob({
      name: 'detail-job',
      handler: () => {
        executed.push('ran');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });
    const result = await handler({ detail: { jobName: 'detail-job', payload: {} } });

    expect(result).toEqual({ success: true });
    expect(executed).toEqual(['ran']);
  });

  it('extracts payload from top-level event for non-SQS invocation', async () => {
    let receivedPayload: unknown = null;
    const job = defineJob({
      name: 'payload-job',
      handler: (payload) => {
        receivedPayload = payload;
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });
    await handler({ jobName: 'payload-job', payload: { key: 'value' } });

    expect(receivedPayload).toEqual({ key: 'value' });
  });

  it('returns undefined payload when detail exists but has no payload', async () => {
    let receivedPayload: unknown = 'NOT_SET';
    const job = defineJob({
      name: 'no-payload-job',
      handler: (payload) => {
        receivedPayload = payload;
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });
    await handler({ detail: { jobName: 'no-payload-job' } });

    expect(receivedPayload).toBeUndefined();
  });

  it('handles async provider resolution failure', async () => {
    const failingJob = defineJob({
      name: 'failing-provider-job',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      providers: [
        {
          provide: 'failingService',
          useFactory: async () => {
            throw new Error('Provider initialization failed');
          },
        },
      ],
      jobs: [failingJob],
    });

    const handler = bootstrapWorker({ module });

    await expect(
      handler({
        jobName: 'failing-provider-job',
        payload: {},
      })
    ).rejects.toThrow('Provider initialization failed');
  });

  it('generates unique job IDs with eb- prefix for EventBridge invocations', async () => {
    let receivedJobId: string | undefined;
    const job = defineJob({
      name: 'eb-job',
      handler: (_payload, ctx) => {
        receivedJobId = ctx.jobId;
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });
    await handler({ jobName: 'eb-job', payload: {} });

    expect(receivedJobId).toBeDefined();
    expect(receivedJobId).toMatch(/^eb-/);
  });

  it('extracts attempt number from Lambda context clientContext if available', async () => {
    let receivedAttemptNumber: number | undefined;
    const job = defineJob({
      name: 'context-attempt-job',
      handler: (_payload, ctx) => {
        receivedAttemptNumber = ctx.attemptNumber;
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    // Simulate EventBridge invocation with retry attempt in clientContext
    const lambdaContext = {
      clientContext: {
        custom: { retryAttempt: 2 },
      },
    };

    await handler({ jobName: 'context-attempt-job', payload: {} }, lambdaContext as never);

    expect(receivedAttemptNumber).toBe(3); // retryAttempt + 1
  });

  it('defaults to attempt 1 when Lambda context has no retry metadata', async () => {
    let receivedAttemptNumber: number | undefined;
    const job = defineJob({
      name: 'no-retry-job',
      handler: (_payload, ctx) => {
        receivedAttemptNumber = ctx.attemptNumber;
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });
    await handler({ jobName: 'no-retry-job', payload: {} });

    expect(receivedAttemptNumber).toBe(1);
  });

  it('rejects SQS messages with invalid structure (missing jobName)', async () => {
    const job = defineJob({
      name: 'structure-test',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    // Valid JSON but missing required jobName field
    const event = buildSqsEvent({
      body: JSON.stringify({
        payload: { data: 'test' },
        jobId: 'job-1',
      }),
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
  });

  it('does not treat non-SQS events with Records array as SQS events', async () => {
    const job = defineJob({
      name: 's3-like-event-job',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    // S3 event has Records array but different structure
    const s3LikeEvent = {
      Records: [
        {
          eventSource: 'aws:s3',
          s3: { bucket: { name: 'test-bucket' } },
        },
      ],
      jobName: 's3-like-event-job', // Fallback to top-level jobName
    };

    const result = await handler(s3LikeEvent);
    expect(result).toEqual({ success: true });
  });
});
