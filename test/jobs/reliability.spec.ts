import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { defineModule } from '../../src/core/module.js';
import { defineJob } from '../../src/jobs/define-job.js';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';
import { JobService } from '../../src/jobs/job-service.js';
import { bootstrapWorker } from '../../src/jobs/worker.js';
import { buildSqsEvent } from '../helpers/sqs.js';

describe('FIFO partial batch failures', () => {
  it.each([true, false])('preserves the processing contract for FIFO=%s', async (isFifo) => {
    const handled: number[] = [];
    const job = defineJob({
      name: 'ordered',
      schema: v.number(),
      handler: (payload) => {
        handled.push(payload);
        if (payload === 2) throw new Error('retry');
      },
    });
    const worker = bootstrapWorker({ module: defineModule({ name: 'fifo', jobs: [job] }) });
    const records = [1, 2, 3, 4].map((payload) => ({
      ...buildSqsEvent({
        messageId: String(payload),
        MessageGroupId: payload === 4 ? 'other-group' : 'same-group',
        body: JSON.stringify({ jobName: job.name, payload }),
      }).Records[0],
      eventSourceARN: `arn:aws:sqs:us-east-1:123:queue${isFifo ? '.fifo' : ''}`,
    }));
    expect(await worker({ Records: records })).toEqual({
      batchItemFailures: (isFifo ? ['2', '3', '4'] : ['2']).map((itemIdentifier) => ({
        itemIdentifier,
      })),
    });
    expect(handled).toEqual(isFifo ? [1, 2] : [1, 2, 3, 4]);
  });

  it('stops FIFO processing after malformed JSON too', async () => {
    const handler = vi.fn();
    const job = defineJob({ name: 'ordered', handler });
    const worker = bootstrapWorker({ module: defineModule({ name: 'fifo', jobs: [job] }) });
    const records = ['invalid', JSON.stringify({ jobName: job.name })].map((body, index) => ({
      ...buildSqsEvent({ body, messageId: String(index) }).Records[0],
      eventSourceARN: 'arn:aws:sqs:us-east-1:123:queue.fifo',
    }));
    expect(await worker({ Records: records })).toEqual({
      batchItemFailures: [{ itemIdentifier: '0' }, { itemIdentifier: '1' }],
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('job schema boundaries', () => {
  it.each(['enqueue', 'enqueueIn', 'enqueueAt'] as const)(
    '%s transports input and passes parsed output to the worker and mock handler',
    async (method) => {
      const handler = vi.fn();
      const job = defineJob({
        name: 'transformed',
        schema: v.object({
          name: v.pipe(v.string(), v.trim()),
          role: v.optional(v.string(), 'member'),
          count: v.pipe(
            v.number(),
            v.transform((value) => value + 1)
          ),
          length: v.pipe(
            v.string(),
            v.transform((value) => value.length)
          ),
        }),
        handler,
      });
      const driver = new MockQueueDriver({ executeImmediately: true, serviceResolver: () => ({}) });
      const service = new JobService(driver);
      const input = { name: ' Alice ', count: 1, length: 'hello', unexpected: 'removed' };
      if (method === 'enqueue') await service.enqueue(job, input);
      if (method === 'enqueueIn') await service.enqueueIn(job, input, '5m');
      if (method === 'enqueueAt') await service.enqueueAt(job, input, new Date(Date.now() + 1000));
      expect(driver.lastJob?.message.payload).toEqual(input);
      const worker = bootstrapWorker({ module: defineModule({ name: 'schema', jobs: [job] }) });
      const body = JSON.stringify(driver.lastJob?.message);
      expect(await worker(buildSqsEvent({ body }))).toEqual({ batchItemFailures: [] });
      expect(await worker({ jobName: job.name, payload: input })).toEqual({ success: true });
      expect(handler).toHaveBeenCalledTimes(3);
      for (const [payload] of handler.mock.calls) {
        expect(payload).toEqual({ name: 'Alice', role: 'member', count: 2, length: 5 });
      }
    }
  );
});

describe('immediate-only driver', () => {
  it('rejects both delayed methods without recursion or enqueueing', async () => {
    const enqueue = vi.fn().mockResolvedValue({ jobId: '1', messageId: '1' });
    const service = new JobService({ name: 'immediate-only', enqueue });
    const job = defineJob({ name: 'noop', handler: vi.fn() });
    await expect(service.enqueueIn(job, {}, '1m')).rejects.toThrow('does not support delayed jobs');
    await expect(service.enqueueAt(job, {}, new Date())).rejects.toThrow(
      'does not support delayed jobs'
    );
    expect(enqueue).not.toHaveBeenCalled();
    await expect(service.enqueue(job, {})).resolves.toEqual({ jobId: '1', messageId: '1' });
  });
});
