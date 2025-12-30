import type {
  SendMessageCommand as SendMessageCommandType,
  SQSClient as SQSClientType,
} from '@aws-sdk/client-sqs';
import { MAX_SQS_DELAY_SECONDS } from '../schedule-constants.js';
import type { Duration, EnqueueResult, JobMessage, QueueDriver } from '../types.js';
import { durationToSeconds, generateJobId } from '../utils.js';
import {
  type EventBridgeSchedulerConfig,
  EventBridgeSchedulerDriver,
  type ScheduleResult,
} from './eventbridge-scheduler-driver.js';

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
   * EventBridge Scheduler configuration for delays over 15 minutes.
   * Required when using enqueueAt or enqueueIn with delays exceeding SQS maximum.
   */
  scheduler?: EventBridgeSchedulerConfig;
  /** Optional pre-configured SQS client */
  client?: SQSClientType;
}

/**
 * AWS SQS queue driver with EventBridge Scheduler support for long delays.
 *
 * For delays up to 15 minutes, uses native SQS delay.
 * For delays over 15 minutes, uses EventBridge Scheduler to create a one-off
 * schedule that sends the job to SQS at the specified time.
 */
export class SQSQueueDriver implements QueueDriver {
  readonly name = 'sqs';
  readonly defaultQueue: string;
  private client: SQSClient | null = null;
  private schedulerDriver: EventBridgeSchedulerDriver | null = null;
  private disposed = false;

  constructor(private readonly config: SQSDriverConfig) {
    this.defaultQueue = config.defaultQueue ?? 'default';
    if (config.client) {
      this.client = config.client;
    }
    if (config.scheduler) {
      this.schedulerDriver = new EventBridgeSchedulerDriver(config.scheduler);
    }
  }

  /**
   * Lazily initialize the SQS client.
   * @throws Error if the driver has been disposed
   */
  private async getClient(): Promise<SQSClient> {
    if (this.disposed) {
      throw new Error('SQSQueueDriver has been disposed');
    }
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
    return this.scheduleWithEventBridge(message, at);
  }

  async enqueueIn(message: JobMessage, delay: Duration): Promise<EnqueueResult> {
    const delaySeconds = durationToSeconds(delay);
    if (delaySeconds <= MAX_SQS_DELAY_SECONDS) {
      return this.enqueueWithDelay(message, delaySeconds);
    }
    const at = new Date(Date.now() + delaySeconds * 1000);
    return this.scheduleWithEventBridge(message, at);
  }

  /**
   * Cancel a scheduled job. Only works for jobs scheduled with EventBridge Scheduler.
   *
   * @param scheduleName - The schedule name from the ScheduleResult
   */
  async cancelSchedule(scheduleName: string): Promise<void> {
    if (!this.schedulerDriver) {
      throw new Error('EventBridge Scheduler is not configured');
    }
    await this.schedulerDriver.cancel(scheduleName);
  }

  /**
   * Dispose of the driver and release AWS SDK client resources.
   * Call this when you're done using the driver to prevent memory leaks.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.schedulerDriver) {
      await this.schedulerDriver.dispose();
    }
  }

  private getQueueUrl(queue?: string): string {
    const queueName = queue ?? this.defaultQueue;
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

  private async scheduleWithEventBridge(message: JobMessage, at: Date): Promise<ScheduleResult> {
    if (!this.schedulerDriver) {
      throw new Error(
        'EventBridge Scheduler configuration is required for delays over 15 minutes. ' +
          'Configure the `scheduler` option in SQSDriverConfig.'
      );
    }

    const queueUrl = this.getQueueUrl(message.queue);

    return this.schedulerDriver.scheduleAt({
      queueUrl,
      message,
      scheduledAt: at,
    });
  }
}
