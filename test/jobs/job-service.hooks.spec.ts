import { describe, expect, it } from 'vitest';
import { defineJob } from '../../src/jobs/define-job.js';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';
import { EnqueueHookError } from '../../src/jobs/errors.js';
import { JobService } from '../../src/jobs/job-service.js';

const job = defineJob<{ id: string }>({ name: 'notify', handler: async () => {} });
const hookFailure = new Error('Audit insert failed');

function createService() {
  const driver = new MockQueueDriver();
  const service = new JobService(driver, undefined, {
    onEnqueued: () => {
      throw hookFailure;
    },
  });
  return { driver, service };
}

describe('onEnqueued hook failures', () => {
  it('reports that the job was accepted, with the queue result and the hook error', async () => {
    const { driver, service } = createService();

    const error = await service.enqueue(job, { id: 'a' }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(EnqueueHookError);
    expect(error).toMatchObject({
      accepted: true,
      jobName: 'notify',
      result: { messageId: 'mock-1' },
      cause: hookFailure,
      message: 'onEnqueued hook failed after job "notify" was enqueued: Audit insert failed',
    });
    expect(driver.enqueued).toHaveLength(1);
  });

  it('applies to delayed and scheduled jobs', async () => {
    const { service } = createService();

    await expect(service.enqueueIn(job, { id: 'a' }, '1m')).rejects.toBeInstanceOf(
      EnqueueHookError
    );
    await expect(service.enqueueAt(job, { id: 'b' }, new Date())).rejects.toBeInstanceOf(
      EnqueueHookError
    );
  });

  it('lets a caller avoid enqueueing the same job twice', async () => {
    const { driver, service } = createService();

    const enqueueOnce = async () => {
      try {
        return await service.enqueue(job, { id: 'a' });
      } catch (error) {
        if (error instanceof EnqueueHookError) return error.result;
        return service.enqueue(job, { id: 'a' });
      }
    };
    await enqueueOnce();

    expect(driver.enqueued).toHaveLength(1);
  });

  it('counts the item as accepted in a settled batch', async () => {
    const { driver, service } = createService();

    const [result] = await service.enqueueBatchSettled([{ job, payload: { id: 'a' } }]);

    expect(result).toEqual({
      index: 0,
      status: 'accepted',
      result: expect.objectContaining({ messageId: 'mock-1' }),
      hookError: hookFailure,
    });
    expect(driver.enqueued).toHaveLength(1);
  });

  it('still surfaces queue failures unchanged', async () => {
    const { driver, service } = createService();
    const sendFailure = new Error('Queue unavailable');
    driver.simulateFailure(sendFailure);

    await expect(service.enqueue(job, { id: 'a' })).rejects.toBe(sendFailure);
  });
});
