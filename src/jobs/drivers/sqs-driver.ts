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
import { generateJobId } from '../utils.js';

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

  async enqueueAt(_message: JobMessage, _at: Date): Promise<EnqueueResult> {
    throw new Error('enqueueAt is not implemented for SQS driver');
  }

  async enqueueIn(_message: JobMessage, _delay: Duration): Promise<EnqueueResult> {
    throw new Error('enqueueIn is not implemented for SQS driver');
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
}
