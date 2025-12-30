import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SQSDriverConfig, SQSQueueDriver } from '../../src/jobs/drivers/sqs-driver.js';

const sendMock = vi.fn();
const schedulerSendMock = vi.fn();

vi.mock('@aws-sdk/client-sqs', () => {
  class SQSClient {
    send = sendMock;
    destroy = vi.fn();
    config: Record<string, unknown>;

    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
  }

  class SendMessageCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return { SQSClient, SendMessageCommand };
});

vi.mock('@aws-sdk/client-scheduler', () => {
  class SchedulerClient {
    send = schedulerSendMock;
    destroy = vi.fn();
    config: Record<string, unknown>;

    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
  }

  class CreateScheduleCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  class DeleteScheduleCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand };
});

describe('SQSQueueDriver', () => {
  const configWithScheduler: SQSDriverConfig = {
    region: 'us-east-1',
    defaultQueue: 'default',
    queues: {
      default: 'https://sqs.us-east-1.amazonaws.com/123456789012/default',
      'orders.fifo': 'https://sqs.us-east-1.amazonaws.com/123456789012/orders.fifo',
    },
    scheduler: {
      region: 'us-east-1',
      roleArn: 'arn:aws:iam::123456789012:role/scheduler-role',
    },
  };

  const config: SQSDriverConfig = {
    region: 'us-east-1',
    defaultQueue: 'default',
    queues: {
      default: 'https://sqs.us-east-1.amazonaws.com/123456789012/default',
      'orders.fifo': 'https://sqs.us-east-1.amazonaws.com/123456789012/orders.fifo',
    },
  };

  let driver: SQSQueueDriver;
  let driverWithScheduler: SQSQueueDriver;

  beforeEach(() => {
    driver = new SQSQueueDriver(config);
    driverWithScheduler = new SQSQueueDriver(configWithScheduler);
    sendMock.mockReset();
    sendMock.mockResolvedValue({ MessageId: 'sqs-123' });
    schedulerSendMock.mockReset();
    schedulerSendMock.mockResolvedValue({
      ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-job-1',
    });
  });

  it('sends message to configured queue', async () => {
    const result = await driver.enqueue({
      jobName: 'test-job',
      payload: { hello: 'world' },
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    const body = JSON.parse(command.input.MessageBody as string);

    expect(command.input.QueueUrl).toBe(config.queues.default);
    expect(body.jobName).toBe('test-job');
    expect(result.messageId).toBe('sqs-123');
    expect(result.jobId).toBe(body.jobId);
  });

  it('uses provided jobId and queue', async () => {
    await driver.enqueue({
      jobName: 'custom-id',
      payload: {},
      jobId: 'job-123',
      queue: 'default',
    });

    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    const body = JSON.parse(command.input.MessageBody as string);

    expect(body.jobId).toBe('job-123');
    expect(command.input.QueueUrl).toBe(config.queues.default);
  });

  it('adds FIFO attributes for fifo queues', async () => {
    await driver.enqueue({
      jobName: 'fifo-job',
      payload: {},
      queue: 'orders.fifo',
    });

    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };

    expect(command.input.QueueUrl).toBe(config.queues['orders.fifo']);
    expect(command.input.MessageGroupId).toBe('orders.fifo');
    expect(command.input.MessageDeduplicationId).toBeDefined();
  });

  it('throws when queue is missing', async () => {
    await expect(
      driver.enqueue({
        jobName: 'missing-queue',
        payload: {},
        queue: 'not-configured',
      })
    ).rejects.toThrow('Queue "not-configured" is not configured for SQS driver');
  });

  it('throws when SQS does not return message ID in enqueue', async () => {
    sendMock.mockResolvedValueOnce({});

    await expect(
      driver.enqueue({
        jobName: 'no-id-job',
        payload: {},
      })
    ).rejects.toThrow('SQS did not return a message ID');
  });

  it('uses DelaySeconds for short delays', async () => {
    await driver.enqueueIn(
      {
        jobName: 'delayed',
        payload: {},
      },
      '30s'
    );

    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.DelaySeconds).toBe(30);
  });

  it('uses EventBridge Scheduler for long delays when configured', async () => {
    await driverWithScheduler.enqueueIn(
      {
        jobName: 'long-delay',
        payload: { id: 1 },
      },
      '20m'
    );

    expect(schedulerSendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('throws when long delay without scheduler config', async () => {
    await expect(
      driver.enqueueIn(
        {
          jobName: 'long-delay',
          payload: {},
        },
        '20m'
      )
    ).rejects.toThrow('EventBridge Scheduler configuration is required for delays over 15 minutes');
  });

  it('uses EventBridge Scheduler for long enqueueAt delays', async () => {
    const future = new Date(Date.now() + 40 * 60 * 1000);

    await driverWithScheduler.enqueueAt(
      {
        jobName: 'future-at',
        payload: { id: 2 },
      },
      future
    );

    expect(schedulerSendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('enqueues immediately when target time is in the past', async () => {
    const past = new Date(Date.now() - 1000);
    await driver.enqueueAt(
      {
        jobName: 'immediate',
        payload: {},
      },
      past
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.DelaySeconds).toBeUndefined();
  });

  describe('cancelSchedule', () => {
    it('cancels a scheduled job', async () => {
      await driverWithScheduler.cancelSchedule('glasswork-job-123');

      expect(schedulerSendMock).toHaveBeenCalledTimes(1);
      const command = schedulerSendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(command.input.Name).toBe('glasswork-job-123');
    });

    it('throws when scheduler is not configured', async () => {
      await expect(driver.cancelSchedule('glasswork-job-123')).rejects.toThrow(
        'EventBridge Scheduler is not configured'
      );
    });
  });

  describe('enqueueWithDelay error handling', () => {
    it('throws when SQS does not return message ID', async () => {
      sendMock.mockResolvedValueOnce({});

      await expect(
        driver.enqueueIn(
          {
            jobName: 'no-id-job',
            payload: {},
          },
          '5s'
        )
      ).rejects.toThrow('SQS did not return a message ID');
    });

    it('adds FIFO attributes for delayed fifo queue messages', async () => {
      await driver.enqueueIn(
        {
          jobName: 'fifo-delayed',
          payload: {},
          queue: 'orders.fifo',
        },
        '30s'
      );

      const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(command.input.QueueUrl).toBe(config.queues['orders.fifo']);
      expect(command.input.MessageGroupId).toBe('orders.fifo');
      expect(command.input.MessageDeduplicationId).toBeDefined();
      expect(command.input.DelaySeconds).toBe(30);
    });
  });

  describe('enqueueAt with short delays', () => {
    it('uses DelaySeconds for delays under 15 minutes', async () => {
      const future = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

      await driver.enqueueAt(
        {
          jobName: 'short-future',
          payload: {},
        },
        future
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
      const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(command.input.DelaySeconds).toBeGreaterThan(0);
      expect(command.input.DelaySeconds).toBeLessThanOrEqual(300);
    });
  });

  describe('custom endpoint', () => {
    it('uses custom endpoint when provided', async () => {
      const driverWithEndpoint = new SQSQueueDriver({
        ...config,
        endpoint: 'http://localhost:4566',
      });

      await driverWithEndpoint.enqueue({
        jobName: 'local-job',
        payload: {},
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('pre-configured client', () => {
    it('uses provided SQS client', async () => {
      const mockClient = { send: sendMock } as never;
      const driverWithClient = new SQSQueueDriver({
        ...config,
        client: mockClient,
      });

      await driverWithClient.enqueue({
        jobName: 'client-job',
        payload: {},
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('can be called safely even when client is not initialized', async () => {
      const freshDriver = new SQSQueueDriver(config);

      // Should not throw
      await expect(freshDriver.dispose()).resolves.toBeUndefined();
    });

    it('destroys the SQS client after initialization', async () => {
      // Initialize the client by making a call
      await driver.enqueue({
        jobName: 'test-job',
        payload: {},
      });

      // Should not throw
      await expect(driver.dispose()).resolves.toBeUndefined();
    });

    it('also disposes the scheduler driver when configured', async () => {
      // Initialize both clients
      await driverWithScheduler.enqueueIn(
        {
          jobName: 'scheduled-job',
          payload: {},
        },
        '30m' // Long delay to trigger scheduler
      );

      // Should not throw and should dispose both clients
      await expect(driverWithScheduler.dispose()).resolves.toBeUndefined();
    });

    it('throws when enqueue is called after dispose', async () => {
      // Initialize the client
      await driver.enqueue({
        jobName: 'test-job',
        payload: {},
      });

      // Dispose the driver
      await driver.dispose();

      // Should throw when trying to enqueue after dispose
      await expect(
        driver.enqueue({
          jobName: 'after-dispose-job',
          payload: {},
        })
      ).rejects.toThrow('SQSQueueDriver has been disposed');
    });
  });
});
