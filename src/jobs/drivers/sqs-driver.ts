import type {
  SendMessageCommand as SendMessageCommandType,
  SQSClient as SQSClientType,
} from '@aws-sdk/client-sqs';
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
  /** DynamoDB table for scheduled jobs (required for delays > 15 minutes) */
  schedulerTable?: string;
}

/**
 * AWS SQS queue driver (Phase 1: enqueue only).
 */
export class SQSQueueDriver implements QueueDriver {
  readonly name = 'sqs';
  private client: SQSClient | null = null;

  constructor(private readonly config: SQSDriverConfig) {}

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
    if (delaySeconds <= 900) {
      return this.enqueueWithDelay(message, delaySeconds);
    }
    return this.scheduleJob(message, at);
  }

  async enqueueIn(message: JobMessage, delay: Duration): Promise<EnqueueResult> {
    const delaySeconds = durationToSeconds(delay);
    if (delaySeconds <= 900) {
      return this.enqueueWithDelay(message, delaySeconds);
    }
    const at = new Date(Date.now() + delaySeconds * 1000);
    return this.scheduleJob(message, at);
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
      DelaySeconds: Math.min(900, Math.max(0, Math.floor(delaySeconds))),
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

  private async scheduleJob(message: JobMessage, at: Date): Promise<EnqueueResult> {
    if (!this.config.schedulerTable) {
      throw new Error('schedulerTable is required for delays over 15 minutes');
    }

    const { DynamoDBClient, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
    const ddb = new DynamoDBClient({
      region: this.config.region,
      ...(this.config.endpoint && { endpoint: this.config.endpoint }),
    });

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
}
