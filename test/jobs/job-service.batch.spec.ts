import { describe, expect, it } from 'vitest';
import { defineJob } from '../../src/jobs/define-job.js';
import { JobService } from '../../src/jobs/job-service.js';
import type { EnqueueResult, JobMessage, QueueDriver } from '../../src/jobs/types.js';

const job = defineJob<{ id: string }>({ name: 'notify', handler: async () => {} });

/** Accepts after a tick, fails the payload ids in `failing` once, and records in-flight sends. */
function createDriver(failing: Set<string> = new Set()) {
  const accepted: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const driver: QueueDriver = {
    name: 'test',
    async enqueue(message: JobMessage): Promise<EnqueueResult> {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const { id } = message.payload as { id: string };
        if (failing.delete(id)) throw new Error(`Send failed for ${id}`);
        accepted.push(id);
        return { messageId: `message-${id}` };
      } finally {
        inFlight--;
      }
    },
  };
  return { driver, accepted, maxInFlight: () => maxInFlight };
}

const items = (ids: string[]) => ids.map((id) => ({ job, payload: { id }, key: id }));

describe('JobService.enqueueBatchSettled', () => {
  it('keeps at most the configured number of jobs in flight', async () => {
    const { driver, accepted, maxInFlight } = createDriver();

    await new JobService(driver).enqueueBatchSettled(items(['a', 'b', 'c', 'd', 'e']), {
      concurrency: 2,
    });

    expect(maxInFlight()).toBe(2);
    expect(accepted.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('reports every item in input order when one of them fails', async () => {
    const { driver } = createDriver(new Set(['b']));

    const results = await new JobService(driver).enqueueBatchSettled(items(['a', 'b', 'c']));

    expect(results).toEqual([
      {
        index: 0,
        key: 'a',
        status: 'accepted',
        result: expect.objectContaining({ messageId: 'message-a' }),
      },
      { index: 1, key: 'b', status: 'rejected', error: new Error('Send failed for b') },
      {
        index: 2,
        key: 'c',
        status: 'accepted',
        result: expect.objectContaining({ messageId: 'message-c' }),
      },
    ]);
  });

  it('lets a caller retry only the rejected items', async () => {
    const { driver, accepted } = createDriver(new Set(['b', 'd']));
    const service = new JobService(driver);
    const batch = items(['a', 'b', 'c', 'd']);

    const first = await service.enqueueBatchSettled(batch);
    const retry = batch.filter((_item, index) => first[index]?.status === 'rejected');
    const second = await service.enqueueBatchSettled(retry);

    expect(second.every((result) => result.status === 'accepted')).toBe(true);
    expect(accepted.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('omits the key when an item has none', async () => {
    const { driver } = createDriver();

    const [result] = await new JobService(driver).enqueueBatchSettled([
      { job, payload: { id: 'a' } },
    ]);

    expect(result).not.toHaveProperty('key');
  });

  it.each([0, -1, 1.5])('rejects concurrency %s', async (concurrency) => {
    const { driver } = createDriver();

    await expect(
      new JobService(driver).enqueueBatchSettled(items(['a']), { concurrency })
    ).rejects.toThrow('Batch concurrency must be a positive integer');
  });
});

describe('JobService.enqueueBatch', () => {
  it('rejects on the first failure while the other jobs can still be accepted', async () => {
    const { driver, accepted } = createDriver(new Set(['a']));

    await expect(new JobService(driver).enqueueBatch(items(['a', 'b', 'c']))).rejects.toThrow(
      'Send failed for a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(accepted.sort()).toEqual(['b', 'c']);
  });
});
