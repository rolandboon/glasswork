import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SQSDriverConfig, SQSQueueDriver } from '../../src/jobs/drivers/sqs-driver.js';

const sendMock = vi.fn();
const ddbSendMock = vi.fn();

vi.mock('@aws-sdk/client-sqs', () => {
  class SQSClient {
    send = sendMock;
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

vi.mock('@aws-sdk/client-dynamodb', () => {
  const DynamoDBClient = vi.fn(function DynamoDBClient(this: unknown) {
    // @ts-expect-error - assign mock send
    this.send = ddbSendMock;
  });

  class PutItemCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return { DynamoDBClient, PutItemCommand };
});

describe('SQSQueueDriver', () => {
  const config: SQSDriverConfig = {
    region: 'us-east-1',
    defaultQueue: 'default',
    queues: {
      default: 'https://sqs.us-east-1.amazonaws.com/123/default',
      'orders.fifo': 'https://sqs.us-east-1.amazonaws.com/123/orders.fifo',
    },
  };

  let driver: SQSQueueDriver;

  beforeEach(() => {
    driver = new SQSQueueDriver(config);
    sendMock.mockReset();
    sendMock.mockResolvedValue({ MessageId: 'sqs-123' });
    ddbSendMock.mockReset();
    (DynamoDBClient as unknown as Mock).mockClear();
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

  it('self reschedules long delays without DynamoDB', async () => {
    await driver.enqueueIn(
      {
        jobName: 'long-delay',
        payload: { id: 1 },
      },
      '20m'
    );

    expect(ddbSendMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.DelaySeconds).toBe(900);
    const body = JSON.parse(command.input.MessageBody as string);
    expect(body.metadata.__glassworkRunAt).toBeDefined();
  });

  it('uses DynamoDB strategy when configured', async () => {
    const longDelayDriver = new SQSQueueDriver({
      ...config,
      schedulerTable: 'scheduled-jobs',
      longDelayStrategy: 'dynamodb',
    });

    await longDelayDriver.enqueueIn(
      {
        jobName: 'long-delay',
        payload: { id: 1 },
      },
      '20m'
    );

    expect(ddbSendMock).toHaveBeenCalledTimes(1);
    const command = ddbSendMock.mock.calls[0][0] as {
      input: { TableName: string; Item: Record<string, { S?: string }> };
    };
    expect(command.input.TableName).toBe('scheduled-jobs');
    expect(command.input.Item.queue.S).toBe('default');
  });

  it('reuses DynamoDB client for scheduling across calls', async () => {
    const longDelayDriver = new SQSQueueDriver({
      ...config,
      schedulerTable: 'scheduled-jobs',
      longDelayStrategy: 'dynamodb',
    });

    await longDelayDriver.enqueueIn(
      {
        jobName: 'long-delay',
        payload: { id: 1 },
      },
      '20m'
    );

    await longDelayDriver.enqueueIn(
      {
        jobName: 'long-delay-2',
        payload: { id: 2 },
      },
      '25m'
    );

    const ctorCalls = (DynamoDBClient as unknown as Mock).mock.calls.length;
    expect(ctorCalls).toBe(1);
  });

  it('throws if DynamoDB strategy is selected without a table', async () => {
    const longDelayDriver = new SQSQueueDriver({
      ...config,
      longDelayStrategy: 'dynamodb',
    });

    await expect(
      longDelayDriver.enqueueIn(
        {
          jobName: 'long-delay',
          payload: {},
        },
        '20m'
      )
    ).rejects.toThrow('schedulerTable is required for delays over 15 minutes when using dynamodb');
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

  it('reschedules long enqueueAt using self-reschedule metadata', async () => {
    const future = new Date(Date.now() + 40 * 60 * 1000);

    await driver.enqueueAt(
      {
        jobName: 'future-at',
        payload: { id: 2 },
      },
      future
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    const body = JSON.parse(command.input.MessageBody as string);
    expect(command.input.DelaySeconds).toBe(900);
    expect(body.metadata.__glassworkRunAt).toBe(future.toISOString());
  });

  it('throws for unimplemented receive/ack/nack', async () => {
    await expect(driver.receive()).rejects.toThrow('receive is not implemented for SQS driver');
    await expect(driver.ack({} as never)).rejects.toThrow('ack is not implemented for SQS driver');
    await expect(driver.nack({} as never)).rejects.toThrow(
      'nack is not implemented for SQS driver'
    );
  });
});
