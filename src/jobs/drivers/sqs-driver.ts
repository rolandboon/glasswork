import type {
  SendMessageCommand as SendMessageCommandType,
  SQSClient as SQSClientType,
} from '@aws-sdk/client-sqs';
import { MAX_SQS_DELAY_SECONDS, RUN_AT_METADATA_KEY } from '../schedule-constants.js';
import type {
  Duration,
  EnqueueResult,
  JobMessage,
  QueueDriver,
  ReceivedJob,
  ReceiveOptions,
} from '../types.js';
import { durationToSeconds, generateJobId } from '../utils.js';

type SQSClient = SQSClientType;
type SendMessageCommand = SendMessageCommandType;

export interface SQSDriverConfig {
  /** AWS region */
  region: string;
  /** Queue URL mapping (queue name -> URL) */
  queues: Record<string, string>;
  /** Default queue name */
  defaultQueue?: string;
  /** Custom endpoint (for LocalStack) */
  endpoint?: string;
  /**
   * DynamoDB table for scheduled jobs (used when longDelayStrategy is "dynamodb").
   * Not required when using the default self-rescheduling strategy.
   */
  schedulerTable?: string;
  /**
   * Strategy for delays over 15 minutes (SQS maximum).
   * - "self-reschedule" (default): the job re-enqueues itself in 15-minute slices until due.
   * - "dynamodb": store in DynamoDB and poll via the scheduler Lambda.
   */
  longDelayStrategy?: 'self-reschedule' | 'dynamodb';
  /** Optional pre-configured SQS client */
  client?: SQSClientType;
}

/**
 * AWS SQS queue driver (Phase 1: enqueue only).
 */
export class SQSQueueDriver implements QueueDriver {
  readonly name = 'sqs';
  private client: SQSClient | null = null;
  private schedulerClientPromise: Promise<unknown> | null = null;

  constructor(private readonly config: SQSDriverConfig) {
    if (config.client) {
      this.client = config.client;
    }
  }

  /**
   * Lazily initialize the SQS client.
   */
  private async getClient(): Promise<SQSClient> {
    if (!this.client) {
      const { SQSClient } = await import('@aws-sdk/client-sqs');
      this.client = new SQSClient({
        region: this.config.region,
        ...(this.config.endpoint && { endpoint: this.config.endpoint }),
      }) as SQSClient;
    }
    return this.client;
  }

  async enqueue(message: JobMessage): Promise<EnqueueResult> {
    const client = await this.getClient();
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    const queueUrl = this.getQueueUrl(message.queue);
    const jobId = message.jobId ?? generateJobId();
    const isFifo = queueUrl.endsWith('.fifo');

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        jobName: message.jobName,
        payload: message.payload,
        jobId,
        metadata: message.metadata,
        enqueuedAt: new Date().toISOString(),
      }),
      MessageAttributes: {
        JobName: { DataType: 'String', StringValue: message.jobName },
      },
      ...(isFifo && {
        MessageGroupId: message.queue ?? message.jobName,
        MessageDeduplicationId: jobId,
      }),
    }) as SendMessageCommand;

    const result = await client.send(command);
    const messageId = (result as { MessageId?: string }).MessageId;
    if (!messageId) {
      throw new Error('SQS did not return a message ID');
    }

    return {
      messageId,
      jobId,
    };
  }

  async enqueueAt(message: JobMessage, at: Date): Promise<EnqueueResult> {
    const delaySeconds = Math.max(0, Math.floor((at.getTime() - Date.now()) / 1000));
    if (delaySeconds <= 0) {
      return this.enqueue(message);
    }
    if (delaySeconds <= MAX_SQS_DELAY_SECONDS) {
      return this.enqueueWithDelay(message, delaySeconds);
    }
    return this.scheduleLongDelay(message, at);
  }

  async enqueueIn(message: JobMessage, delay: Duration): Promise<EnqueueResult> {
    const delaySeconds = durationToSeconds(delay);
    if (delaySeconds <= MAX_SQS_DELAY_SECONDS) {
      return this.enqueueWithDelay(message, delaySeconds);
    }
    const at = new Date(Date.now() + delaySeconds * 1000);
    return this.scheduleLongDelay(message, at);
  }

  async receive(_options?: ReceiveOptions): Promise<ReceivedJob[]> {
    throw new Error('receive is not implemented for SQS driver');
  }

  async ack(_job: ReceivedJob): Promise<void> {
    throw new Error('ack is not implemented for SQS driver');
  }

  async nack(_job: ReceivedJob): Promise<void> {
    throw new Error('nack is not implemented for SQS driver');
  }

  private getQueueUrl(queue?: string): string {
    const queueName = queue ?? this.config.defaultQueue ?? 'default';
    const queueUrl = this.config.queues[queueName];
    if (!queueUrl) {
      throw new Error(`Queue "${queueName}" is not configured for SQS driver`);
    }
    return queueUrl;
  }

  private async enqueueWithDelay(
    message: JobMessage,
    delaySeconds: number
  ): Promise<EnqueueResult> {
    const client = await this.getClient();
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    const queueUrl = this.getQueueUrl(message.queue);
    const jobId = message.jobId ?? generateJobId();
    const isFifo = queueUrl.endsWith('.fifo');

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        jobName: message.jobName,
        payload: message.payload,
        jobId,
        metadata: message.metadata,
        enqueuedAt: new Date().toISOString(),
      }),
      DelaySeconds: Math.min(MAX_SQS_DELAY_SECONDS, Math.max(0, Math.floor(delaySeconds))),
      MessageAttributes: {
        JobName: { DataType: 'String', StringValue: message.jobName },
      },
      ...(isFifo && {
        MessageGroupId: message.queue ?? message.jobName,
        MessageDeduplicationId: jobId,
      }),
    }) as SendMessageCommand;

    const result = await client.send(command);
    const messageId = (result as { MessageId?: string }).MessageId;
    if (!messageId) {
      throw new Error('SQS did not return a message ID');
    }

    return {
      messageId,
      jobId,
    };
  }

  private async scheduleLongDelay(message: JobMessage, at: Date): Promise<EnqueueResult> {
    const strategy = this.config.longDelayStrategy ?? 'self-reschedule';
    if (strategy === 'dynamodb') {
      return this.scheduleJobWithDynamo(message, at);
    }

    return this.scheduleJobWithSelfReschedule(message, at);
  }

  private async scheduleJobWithSelfReschedule(
    message: JobMessage,
    at: Date
  ): Promise<EnqueueResult> {
    const jobId = message.jobId ?? generateJobId();
    const metadata = {
      ...message.metadata,
      [RUN_AT_METADATA_KEY]: at.toISOString(),
    };

    const delaySeconds = Math.max(
      1,
      Math.min(MAX_SQS_DELAY_SECONDS, Math.floor((at.getTime() - Date.now()) / 1000))
    );

    return this.enqueueWithDelay(
      {
        ...message,
        jobId,
        metadata,
      },
      delaySeconds
    );
  }

  private async scheduleJobWithDynamo(message: JobMessage, at: Date): Promise<EnqueueResult> {
    if (!this.config.schedulerTable) {
      throw new Error('schedulerTable is required for delays over 15 minutes when using dynamodb');
    }

    const { PutItemCommand } = await import('@aws-sdk/client-dynamodb');
    const ddb = await this.getSchedulerClient();

    const jobId = message.jobId ?? generateJobId();
    const partition = `SCHEDULED#${at.toISOString().slice(0, 16)}`;

    await ddb.send(
      new PutItemCommand({
        TableName: this.config.schedulerTable,
        Item: {
          pk: { S: partition },
          sk: { S: jobId },
          jobName: { S: message.jobName },
          payload: { S: JSON.stringify(message.payload) },
          queue: { S: message.queue ?? this.config.defaultQueue ?? 'default' },
          scheduledAt: { S: at.toISOString() },
          ttl: { N: String(Math.floor(at.getTime() / 1000) + 86400) },
        },
      })
    );

    return {
      messageId: jobId,
      jobId,
    };
  }

  private async getSchedulerClient(): Promise<{
    send: (command: unknown) => Promise<unknown>;
  }> {
    if (this.schedulerClientPromise) {
      return (await this.schedulerClientPromise) as {
        send: (command: unknown) => Promise<unknown>;
      };
    }

    this.schedulerClientPromise = (async () => {
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      return new DynamoDBClient({
        region: this.config.region,
        ...(this.config.endpoint && { endpoint: this.config.endpoint }),
      }) as { send: (command: unknown) => Promise<unknown> };
    })();

    return (await this.schedulerClientPromise) as {
      send: (command: unknown) => Promise<unknown>;
    };
  }
}
