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
  class DynamoDBClient {
    send = ddbSendMock;
  }

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

  it('stores long delays in scheduler table', async () => {
    const longDelayDriver = new SQSQueueDriver({
      ...config,
      schedulerTable: 'scheduled-jobs',
    });

    await longDelayDriver.enqueueIn(
      {
        jobName: 'long-delay',
        payload: { id: 1 },
        queue: 'default',
      },
      '20m'
    );

    expect(ddbSendMock).toHaveBeenCalledTimes(1);
    const command = ddbSendMock.mock.calls[0][0] as {
      input: Record<string, Record<string, unknown>>;
    };
    expect(command.input.TableName).toBe('scheduled-jobs');
    expect(command.input.Item.queue.S).toBe('default');
  });
});
