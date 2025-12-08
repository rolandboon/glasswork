import type { SQSEvent, SQSRecordAttributes } from 'aws-lambda';
import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { PermanentJobError, TransientJobError } from '../../src/jobs/errors.js';
import type { JobDefinition, QueueDriver } from '../../src/jobs/types.js';
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

    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
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

  it('reschedules jobs that are not due yet using the driver', async () => {
    const enqueueIn = vi.fn();
    const handlerSpy = vi.fn();
    const job = defineJob({
      name: 'future-job',
      handler: handlerSpy,
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      driver: { enqueueIn } as unknown as QueueDriver,
    });

    const runAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'future-job',
        payload: { id: 1 },
        metadata: { __glassworkRunAt: runAt },
      }),
    });

    const result = await handler(event);

    expect(enqueueIn).toHaveBeenCalledTimes(1);
    const [message, delay] = enqueueIn.mock.calls[0] as [
      { metadata?: Record<string, string> },
      number,
    ];
    expect(message.metadata?.__glassworkRunAt).toBe(runAt);
    expect(delay).toBeGreaterThan(0);
    expect(handlerSpy).not.toHaveBeenCalled();
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
  });

  it('executes immediately when runAt metadata is invalid', async () => {
    const handlerSpy = vi.fn();
    const job = defineJob({
      name: 'invalid-run-at',
      handler: handlerSpy,
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const enqueueIn = vi.fn();
    const handler = bootstrapWorker({
      module,
      driver: { enqueueIn } as unknown as QueueDriver,
    });

    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'invalid-run-at',
        payload: {},
        metadata: { __glassworkRunAt: 'not-a-date' },
      }),
    });

    const result = await handler(event);

    expect(enqueueIn).not.toHaveBeenCalled();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
  });

  it('executes immediately when future metadata is present but no driver is configured', async () => {
    const handlerSpy = vi.fn();
    const job = defineJob({
      name: 'no-driver',
      handler: handlerSpy,
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const runAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'no-driver',
        payload: { id: 1 },
        metadata: { __glassworkRunAt: runAt },
      }),
    });

    const result = await handler(event);

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
  });

  it('reschedules using enqueueAt when enqueueIn is unavailable', async () => {
    const enqueueAt = vi.fn();
    const handlerSpy = vi.fn();
    const job = defineJob({
      name: 'future-at',
      handler: handlerSpy,
    });

    const module = defineModule({
      name: 'worker',
      jobs: [job],
    });

    const handler = bootstrapWorker({
      module,
      driver: { name: 'mock', enqueueAt } as unknown as QueueDriver,
    });

    const runAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'future-at',
        payload: { id: 1 },
        metadata: { __glassworkRunAt: runAt },
      }),
    });

    const result = await handler(event);

    expect(enqueueAt).toHaveBeenCalledTimes(1);
    expect(handlerSpy).not.toHaveBeenCalled();
    expect('batchItemFailures' in result ? result.batchItemFailures : []).toHaveLength(0);
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

  it('uses logger child when available and skips reschedule for near-term jobs', async () => {
    const handlerSpy = vi.fn();
    const child = vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
    const job = defineJob({
      name: 'near-term',
      handler: handlerSpy,
    });

    const module = defineModule({
      name: 'worker',
      providers: [
        {
          provide: 'logger',
          useValue: {
            child,
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
      jobs: [job],
    });

    const handler = bootstrapWorker({ module });

    const runAt = new Date(Date.now() + 500).toISOString();
    const event = buildSqsEvent({
      body: JSON.stringify({
        jobName: 'near-term',
        payload: {},
        metadata: { __glassworkRunAt: runAt },
      }),
    });

    const result = await handler(event);

    expect(child).toHaveBeenCalled();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
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
});
