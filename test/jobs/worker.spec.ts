import type { SQSEvent, SQSRecordAttributes } from 'aws-lambda';
import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { PermanentJobError, TransientJobError } from '../../src/jobs/errors.js';
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
      jobs: [job],
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

    expect(result.batchItemFailures).toHaveLength(0);
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

    expect(result.batchItemFailures).toHaveLength(0);
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

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0]?.itemIdentifier).toBe('msg-1');
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
});
