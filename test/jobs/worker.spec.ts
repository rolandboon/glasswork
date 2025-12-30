import type { SQSEvent, SQSRecordAttributes } from 'aws-lambda';
import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { PermanentJobError, TransientJobError } from '../../src/jobs/errors.js';
import type { JobDefinition } from '../../src/jobs/types.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';

function buildSqsEvent(
  record: Partial<SQSRecordAttributes> & { body: string; messageId?: string }
) {
  const attrs: SQSRecordAttributes = {
    ApproximateFirstReceiveTimestamp: '0',
    ApproximateReceiveCount: '1',
    SenderId: 'sender',
    SentTimestamp: `${Date.now()}`,
    ...record,
  } as SQSRecordAttributes;

  return {
    Records: [
      {
        messageId: record.messageId ?? 'msg-1',
        receiptHandle: 'rh',
        body: record.body,
        attributes: attrs,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123:queue',
        awsRegion: 'us-east-1',
      },
    ],
  } as SQSEvent;
}

describe('bootstrapWorker', () => {
  it('processes SQS job and calls hooks', async () => {
    const onJobStart = vi.fn();
    const onJobComplete = vi.fn();
    const increments: string[] = [];

    const job = defineJob({
      name: 'hello',
      schema: v.object({ name: v.string() }),
      handler: async (payload) => {
        increments.push(payload.name);
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job as JobDefinition<unknown>],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobStart, onJobComplete },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'hello',
        payload: { name: 'Alice' },
        jobId: 'job-1',
        enqueuedAt: new Date().toISOString(),
      }),
    });

    const result = await handler(event);

    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
    expect(onJobStart).toHaveBeenCalledTimes(1);
    expect(onJobComplete).toHaveBeenCalledTimes(1);
    expect(increments).toEqual(['Alice']);
  });

  it('marks permanent errors as dead letter without retry', async () => {
    const onDeadLetter = vi.fn();
    const job = defineJob({
      name: 'permanent',
      handler: () => {
        throw new PermanentJobError('no retry');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobDeadLetter: onDeadLetter },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'permanent',
        payload: {},
        jobId: 'job-1',
      }),
    });

    const result = await handler(event);

    // PermanentJobError is now re-thrown for consistent error propagation,
    // so it will cause a batch failure (allowing SQS DLQ to capture it)
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('returns batch failure for transient errors', async () => {
    const job = defineJob({
      name: 'transient',
      handler: () => {
        throw new TransientJobError('retry later');
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'transient',
        payload: {},
        jobId: 'job-1',
      }),
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
    expect(failures[0]?.itemIdentifier).toBe('msg-1');
  });

  it('retries invalid payloads so DLQ can capture them', async () => {
    const onDeadLetter = vi.fn();
    const job = defineJob({
      name: 'schema-job',
      schema: v.object({ name: v.string() }),
      handler: () => {
        // Will not be reached because payload is invalid
      },
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job as JobDefinition<unknown>],
    });

    const handler = bootstrapWorker({
      module,
      hooks: { onJobDeadLetter: onDeadLetter },
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'schema-job',
        payload: {}, // missing required name
        jobId: 'job-1',
      }),
    });

    const result = await handler(event);

    // Should signal failure so SQS redrives to DLQ after retries
    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toHaveLength(1);
    expect(failures[0]?.itemIdentifier).toBe('msg-1');
    expect(onDeadLetter).not.toHaveBeenCalled();
  });

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

  it('marks batch failure when payload cannot be parsed', async () => {
    const job = defineJob({
      name: 'noop',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: 'not-json',
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];

    expect(failures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  it('marks batch failure when payload is not an object', async () => {
    const job = defineJob({
      name: 'noop',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: '"just-a-string"',
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  it('marks batch failure when job name is missing', async () => {
    const job = defineJob({
      name: 'noop',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const event = buildSqsEvent({
      body: JSON.stringify({
        payload: { data: 'test' },
      }),
    });

    const result = await handler(event);

    const failures = 'batchItemFailures' in result ? (result.batchItemFailures ?? []) : [];
    expect(failures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  it('throws for non-SQS invocation without job name', async () => {
    const job = defineJob({
      name: 'test',
      handler: vi.fn(),
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    await expect(handler({ payload: {} })).rejects.toThrow(
      'Job name is required for non-SQS invocation'
    );
  });

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
