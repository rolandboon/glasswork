import { describe, expect, it, vi } from 'vitest';
import { defineJob } from '../../src/jobs/define-job.js';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';
import { createJobRegistry } from '../../src/jobs/job-registry.js';

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

  it('clears stored state', async () => {
    const driver = new MockQueueDriver();
    await driver.enqueue({
      jobName: 'clean-me',
      payload: { value: 1 },
    });

    expect(driver.enqueued).toHaveLength(1);

    driver.clear();

    expect(driver.enqueued).toHaveLength(0);
    expect(driver.lastJob).toBeUndefined();
  });

  describe('executeImmediately', () => {
    const testHandler = vi.fn();
    const testJob = defineJob<{ data: string }>({
      name: 'test-job',
      handler: testHandler,
    });
    const registry = createJobRegistry([testJob]);

    it('calls job handler when executeImmediately is true with registry and serviceResolver', async () => {
      testHandler.mockReset();
      const services = { myService: 'test-service' };
      const driver = new MockQueueDriver({
        executeImmediately: true,
        registry,
        serviceResolver: () => services,
      });

      await driver.enqueue({
        jobName: 'test-job',
        payload: { data: 'value' },
      });

      expect(testHandler).toHaveBeenCalledTimes(1);
      expect(testHandler).toHaveBeenCalledWith(
        { data: 'value' },
        expect.objectContaining({
          services,
          jobId: expect.any(String),
          attemptNumber: 1,
          enqueuedAt: expect.any(Date),
        })
      );
    });

    it('still records jobs even when executing immediately', async () => {
      testHandler.mockReset();
      const driver = new MockQueueDriver({
        executeImmediately: true,
        registry,
        serviceResolver: () => ({}),
      });

      await driver.enqueue({
        jobName: 'test-job',
        payload: { data: 'recorded' },
      });

      expect(driver.enqueued).toHaveLength(1);
      expect(driver.lastJob?.message.jobName).toBe('test-job');
    });

    it('does not execute when registry is missing', async () => {
      testHandler.mockReset();
      const driver = new MockQueueDriver({
        executeImmediately: true,
        serviceResolver: () => ({}),
        // no registry
      });

      await driver.enqueue({
        jobName: 'test-job',
        payload: { data: 'no-exec' },
      });

      expect(testHandler).not.toHaveBeenCalled();
      expect(driver.enqueued).toHaveLength(1);
    });

    it('does not execute when serviceResolver is missing', async () => {
      testHandler.mockReset();
      const driver = new MockQueueDriver({
        executeImmediately: true,
        registry,
        // no serviceResolver
      });

      await driver.enqueue({
        jobName: 'test-job',
        payload: { data: 'no-exec' },
      });

      expect(testHandler).not.toHaveBeenCalled();
      expect(driver.enqueued).toHaveLength(1);
    });

    it('does not execute when executeImmediately is false', async () => {
      testHandler.mockReset();
      const driver = new MockQueueDriver({
        executeImmediately: false,
        registry,
        serviceResolver: () => ({}),
      });

      await driver.enqueue({
        jobName: 'test-job',
        payload: { data: 'no-exec' },
      });

      expect(testHandler).not.toHaveBeenCalled();
    });

    it('executes immediately for enqueueAt', async () => {
      testHandler.mockReset();
      const driver = new MockQueueDriver({
        executeImmediately: true,
        registry,
        serviceResolver: () => ({}),
      });

      const future = new Date(Date.now() + 60000);
      await driver.enqueueAt({ jobName: 'test-job', payload: { data: 'at' } }, future);

      expect(testHandler).toHaveBeenCalledTimes(1);
      expect(driver.lastJob?.at).toEqual(future);
    });

    it('executes immediately for enqueueIn', async () => {
      testHandler.mockReset();
      const driver = new MockQueueDriver({
        executeImmediately: true,
        registry,
        serviceResolver: () => ({}),
      });

      await driver.enqueueIn({ jobName: 'test-job', payload: { data: 'in' } }, '5m');

      expect(testHandler).toHaveBeenCalledTimes(1);
      expect(driver.lastJob?.delay).toBe('5m');
    });
  });
});
