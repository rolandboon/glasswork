import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { defineJob } from '../../src/jobs/define-job.js';
import { MockQueueDriver } from '../../src/jobs/drivers/mock-driver.js';
import { InvalidJobPayloadError, PayloadTooLargeError } from '../../src/jobs/errors.js';
import { JobService } from '../../src/jobs/job-service.js';
import type { QueueDriver } from '../../src/jobs/types.js';

describe('JobService', () => {
  const defaultQueue = 'default';

  const createService = (driver = new MockQueueDriver()) =>
    new JobService(driver, { defaultQueue });

  it('enqueues with default queue when none specified', async () => {
    const driver = new MockQueueDriver();
    const service = createService(driver);
    const job = defineJob({
      name: 'send-welcome-email',
      handler: vi.fn(),
    });

    const result = await service.enqueue(job, { userId: '123' });

    expect(result.messageId).toMatch(/^mock-/);
    expect(driver.enqueued).toHaveLength(1);
    expect(driver.enqueued[0].message.queue).toBe(defaultQueue);
    expect(driver.enqueued[0].message.jobName).toBe('send-welcome-email');
  });

  it('respects job-level queue override', async () => {
    const driver = new MockQueueDriver();
    const service = createService(driver);
    const job = defineJob({
      name: 'process-payment',
      queue: 'payments',
      handler: vi.fn(),
    });

    await service.enqueue(job, { orderId: 'abc' });

    expect(driver.enqueued[0].message.queue).toBe('payments');
  });

  it('validates payload with valibot schema', async () => {
    const service = createService();
    const job = defineJob({
      name: 'typed-job',
      schema: v.object({ id: v.string() }),
      handler: vi.fn(),
    });

    await expect(service.enqueue(job, { id: 123 } as unknown as { id: string })).rejects.toThrow(
      InvalidJobPayloadError
    );
  });

  it('rejects payloads above 256KB', async () => {
    const service = createService();
    const job = defineJob({
      name: 'large-payload',
      handler: vi.fn(),
    });

    const hugePayload = { data: 'x'.repeat(300 * 1024) };

    await expect(service.enqueue(job, hugePayload)).rejects.toThrow(PayloadTooLargeError);
  });

  it('calls onEnqueued hook after successful enqueue', async () => {
    const driver = new MockQueueDriver();
    const onEnqueued = vi.fn();
    const service = new JobService(driver, { defaultQueue }, { onEnqueued });
    const job = defineJob({
      name: 'welcome',
      handler: vi.fn(),
    });

    await service.enqueue(job, { userId: '123' });

    expect(onEnqueued).toHaveBeenCalledTimes(1);
    expect(onEnqueued.mock.calls[0][0]).toBe(job);
    expect(onEnqueued.mock.calls[0][1]).toEqual({ userId: '123' });
  });

  it('supports enqueueIn with driver support', async () => {
    const driver = new MockQueueDriver();
    const service = createService(driver);
    const job = defineJob({
      name: 'delayed',
      handler: vi.fn(),
    });

    await service.enqueueIn(job, { id: 1 }, '10s');

    expect(driver.enqueued[0].delay).toBe('10s');
  });

  it('supports enqueueAt when driver supports enqueueIn', async () => {
    const driver = new MockQueueDriver();
    const service = createService(driver);
    const job = defineJob({
      name: 'at-time',
      handler: vi.fn(),
    });

    const target = new Date(Date.now() + 5000);
    await service.enqueueAt(job, { foo: 'bar' }, target);

    expect(driver.enqueued[0].at?.getTime()).toBeGreaterThan(Date.now());
  });

  it('falls back to enqueueAt when enqueueIn is missing', async () => {
    const enqueueAt = vi.fn().mockResolvedValue({ messageId: '1', jobId: '1' });
    const driver = {
      name: 'custom',
      enqueue: vi.fn(),
      enqueueAt,
    } as unknown as QueueDriver;
    const service = createService(driver);
    const job = defineJob({
      name: 'fallback-in',
      handler: vi.fn(),
    });

    await service.enqueueIn(job, { id: 1 }, '5s');

    expect(enqueueAt).toHaveBeenCalledTimes(1);
  });

  it('falls back to enqueueIn when enqueueAt is missing', async () => {
    const enqueueIn = vi.fn().mockResolvedValue({ messageId: '1', jobId: '1' });
    const driver = {
      name: 'custom',
      enqueue: vi.fn(),
      enqueueIn,
    } as unknown as QueueDriver;
    const service = createService(driver);
    const job = defineJob({
      name: 'fallback-at',
      handler: vi.fn(),
    });

    const target = new Date(Date.now() + 2000);
    await service.enqueueAt(job, { id: 1 }, target);

    expect(enqueueIn).toHaveBeenCalledTimes(1);
  });

  it('uses unique deduplication key as jobId', async () => {
    const driver = new MockQueueDriver();
    const service = createService(driver);
    const job = defineJob({
      name: 'unique-job',
      queue: 'orders.fifo',
      unique: { key: (payload: { orderId: string }) => payload.orderId },
      handler: vi.fn(),
    });

    await service.enqueue(job, { orderId: 'order-1' });

    expect(driver.enqueued[0].message.jobId).toBe('order-1');
  });
});
