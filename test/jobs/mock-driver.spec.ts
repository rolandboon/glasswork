import { describe, expect, it } from 'vitest';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';

describe('MockQueueDriver', () => {
  it('records enqueued jobs and supports failure injection', async () => {
    const driver = new MockQueueDriver();
    driver.simulateFailure(new Error('boom'));

    await expect(
      driver.enqueue({
        jobName: 'failing',
        payload: {},
      })
    ).rejects.toThrow('boom');

    await driver.enqueue({
      jobName: 'ok',
      payload: {},
    });

    expect(driver.enqueued).toHaveLength(1);
    expect(driver.lastJob?.message.jobId).toBeDefined();
  });

  it('clears stored state and tracks ack/nack', async () => {
    const driver = new MockQueueDriver();
    await driver.enqueue({
      jobName: 'clean-me',
      payload: { value: 1 },
    });

    const [received] = await driver.receive();
    await driver.ack(received);
    await driver.nack(received, new Error('bad'));

    expect(driver.acks).toHaveLength(1);
    expect(driver.nacks).toHaveLength(1);

    driver.clear();

    expect(driver.enqueued).toHaveLength(0);
    expect(driver.acks).toHaveLength(0);
    expect(driver.nacks).toHaveLength(0);
    expect(driver.lastJob).toBeUndefined();
  });
});
