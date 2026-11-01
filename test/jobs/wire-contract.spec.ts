import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { defineJob } from '../../src/jobs/define-job.js';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';
import { SQSQueueDriver } from '../../src/jobs/drivers/sqs-driver.js';
import { InvalidJobPayloadError } from '../../src/jobs/errors.js';
import { JobService } from '../../src/jobs/job-service.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { createLogger } from '../../src/utils/logger.js';

const logger = createLogger('wire', 'silent');

type Outcome = { accepted: true; received: unknown } | { accepted: false; error: unknown };

function describeValue(value: unknown): unknown {
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return value.map(describeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, describeValue(item)])
    );
  }
  return value === undefined ? 'undefined' : typeof value;
}

function createJob(name: string, schema: v.GenericSchema | undefined, received: unknown[]) {
  return defineJob({
    name,
    schema: schema as v.GenericSchema<unknown>,
    handler: (payload) => {
      received.push(describeValue(payload));
    },
  });
}

async function runLocally(name: string, schema: v.GenericSchema | undefined, payload: unknown) {
  const received: unknown[] = [];
  const job = createJob(name, schema, received);
  const driver = new MockQueueDriver({
    executeImmediately: true,
    serviceResolver: () => ({}),
    logger,
  });
  try {
    await new JobService(driver).enqueue(job, payload);
    return { accepted: true, received: received[0] } satisfies Outcome;
  } catch (error) {
    return { accepted: false, error } satisfies Outcome;
  }
}

async function runThroughSqs(name: string, schema: v.GenericSchema | undefined, payload: unknown) {
  const received: unknown[] = [];
  const job = createJob(name, schema, received);
  const sent: Array<{ MessageBody: string }> = [];
  const driver = new SQSQueueDriver({
    region: 'eu-west-1',
    queues: { default: 'https://sqs.eu-west-1.amazonaws.com/000000000000/jobs' },
    client: {
      send: async (command: { input: { MessageBody: string } }) => {
        sent.push(command.input);
        return { MessageId: 'message-1' };
      },
      destroy: () => {},
    } as never,
  });
  try {
    await new JobService(driver).enqueue(job, payload);
  } catch (error) {
    return { accepted: false, error } satisfies Outcome;
  }
  const worker = bootstrapWorker({
    module: { name: `wire-${name}`, jobs: [job] },
    logger,
    metrics: { enabled: false },
  });
  const result = await worker({
    Records: [
      {
        messageId: 'message-1',
        receiptHandle: 'receipt',
        body: sent[0]?.MessageBody,
        attributes: { ApproximateReceiveCount: '1' },
        eventSourceARN: 'arn:aws:sqs:eu-west-1:000000000000:jobs',
        eventSource: 'aws:sqs',
      },
    ],
  } as never);
  expect(result).toEqual({ batchItemFailures: [] });
  return { accepted: true, received: received[0] } satisfies Outcome;
}

const isoDate = v.pipe(
  v.string(),
  v.isoTimestamp(),
  v.transform((value) => new Date(value))
);

describe('job payloads after JSON transport', () => {
  it.each([
    ['date-object', v.object({ due: v.date() }), { due: new Date('2026-11-01T12:00:00.000Z') }],
    ['undefined-property', v.object({ value: v.undefined() }), { value: undefined }],
    ['undefined-array-item', v.object({ values: v.array(v.undefined()) }), { values: [undefined] }],
  ])('rejects %s at enqueue in both runtimes', async (name, schema, payload) => {
    for (const outcome of [
      await runLocally(name, schema, payload),
      await runThroughSqs(name, schema, payload),
    ]) {
      expect(outcome.accepted).toBe(false);
      const error = (outcome as { error: unknown }).error;
      expect(error).toBeInstanceOf(InvalidJobPayloadError);
      expect((error as Error).message).toContain('after JSON transport');
    }
  });

  it.each([
    ['undefined-root', v.undefined(), undefined, 'undefined'],
    [
      'iso-string-transform',
      v.object({ due: isoDate }),
      { due: '2026-11-01T12:00:00.000Z' },
      { due: 'Date' },
    ],
    ['no-schema-date', undefined, { due: new Date('2026-11-01T12:00:00.000Z') }, { due: 'string' }],
  ])(
    'hands %s to the handler identically in both runtimes',
    async (name, schema, payload, expected) => {
      expect(await runLocally(name, schema, payload)).toEqual({
        accepted: true,
        received: expected,
      });
      expect(await runThroughSqs(name, schema, payload)).toEqual({
        accepted: true,
        received: expected,
      });
    }
  );

  it('rejects values JSON cannot represent before enqueueing in both runtimes', async () => {
    const schema = v.object({ count: v.bigint() });
    for (const outcome of [
      await runLocally('bigint', schema, { count: 1n }),
      await runThroughSqs('bigint', schema, { count: 1n }),
    ]) {
      expect(outcome.accepted).toBe(false);
      expect((outcome as { error: unknown }).error).toBeInstanceOf(TypeError);
    }
  });
});
