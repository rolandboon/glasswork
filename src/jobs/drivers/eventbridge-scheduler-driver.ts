import type {
  CreateScheduleCommand as CreateScheduleCommandType,
  DeleteScheduleCommand as DeleteScheduleCommandType,
  SchedulerClient as SchedulerClientType,
} from '@aws-sdk/client-scheduler';
import type { EnqueueResult, JobMessage } from '../types.js';
import { generateJobId } from '../utils.js';

type SchedulerClient = SchedulerClientType;
type CreateScheduleCommand = CreateScheduleCommandType;
type DeleteScheduleCommand = DeleteScheduleCommandType;

export interface EventBridgeSchedulerConfig {
  /** AWS region */
  region: string;
  /** IAM role ARN that EventBridge Scheduler assumes to send messages to SQS */
  roleArn: string;
  /** Optional schedule group name for organization (default: 'default') */
  scheduleGroupName?: string;
  /** Custom endpoint (for LocalStack) */
  endpoint?: string;
}

export interface ScheduledJobConfig {
  /** Target SQS queue URL */
  queueUrl: string;
  /** Job message */
  message: JobMessage;
  /** When to run the job */
  scheduledAt: Date;
}

/**
 * Result of scheduling a job with EventBridge Scheduler.
 */
export interface ScheduleResult extends EnqueueResult {
  /** EventBridge Scheduler schedule ARN */
  scheduleArn: string;
  /** Schedule name (can be used for cancellation) */
  scheduleName: string;
}

/**
 * EventBridge Scheduler driver for scheduling jobs with delays longer than 15 minutes.
 *
 * Uses one-off schedules with `at()` expressions that target an SQS queue.
 * Schedules are automatically deleted after execution.
 */
export class EventBridgeSchedulerDriver {
  private client: SchedulerClient | null = null;

  constructor(private readonly config: EventBridgeSchedulerConfig) {}

  /**
   * Lazily initialize the Scheduler client.
   */
  private async getClient(): Promise<SchedulerClient> {
    if (!this.client) {
      const { SchedulerClient } = await import('@aws-sdk/client-scheduler');
      this.client = new SchedulerClient({
        region: this.config.region,
        ...(this.config.endpoint && { endpoint: this.config.endpoint }),
      }) as SchedulerClient;
    }
    return this.client;
  }

  /**
   * Schedule a job to be executed at a specific time.
   *
   * Creates a one-off EventBridge Scheduler schedule that sends a message
   * to the specified SQS queue at the scheduled time.
   *
   * @param config - The scheduled job configuration
   * @returns Schedule result with ARN and name
   */
  async scheduleAt(config: ScheduledJobConfig): Promise<ScheduleResult> {
    const client = await this.getClient();
    const { CreateScheduleCommand } = await import('@aws-sdk/client-scheduler');

    const jobId = config.message.jobId ?? generateJobId();
    const scheduleName = `glasswork-${jobId}`;

    // Format: at(yyyy-mm-ddThh:mm:ss)
    const scheduleExpression = `at(${config.scheduledAt.toISOString().slice(0, 19)})`;

    // Build the SQS message payload
    const messageBody = JSON.stringify({
      jobName: config.message.jobName,
      payload: config.message.payload,
      jobId,
      metadata: config.message.metadata,
      enqueuedAt: new Date().toISOString(),
    });

    const command = new CreateScheduleCommand({
      Name: scheduleName,
      GroupName: this.config.scheduleGroupName ?? 'default',
      ScheduleExpression: scheduleExpression,
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: {
        Mode: 'OFF',
      },
      Target: {
        Arn: this.sqsArnFromUrl(config.queueUrl),
        RoleArn: this.config.roleArn,
        Input: messageBody,
        SqsParameters: {
          MessageGroupId: config.message.queue ?? config.message.jobName,
        },
      },
      // Auto-delete the schedule after it runs
      ActionAfterCompletion: 'DELETE',
    }) as CreateScheduleCommand;

    const result = await client.send(command);
    const scheduleArn = (result as { ScheduleArn?: string }).ScheduleArn;

    if (!scheduleArn) {
      throw new Error('EventBridge Scheduler did not return a schedule ARN');
    }

    return {
      messageId: jobId,
      jobId,
      scheduleArn,
      scheduleName,
    };
  }

  /**
   * Cancel a scheduled job.
   *
   * @param scheduleName - The name of the schedule to cancel
   */
  async cancel(scheduleName: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteScheduleCommand } = await import('@aws-sdk/client-scheduler');

    const command = new DeleteScheduleCommand({
      Name: scheduleName,
      GroupName: this.config.scheduleGroupName ?? 'default',
    }) as DeleteScheduleCommand;

    await client.send(command);
  }

  /**
   * Dispose of the driver and release AWS SDK client resources.
   * Call this when you're done using the driver to prevent memory leaks.
   */
  async dispose(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  /**
   * Convert an SQS queue URL to its ARN.
   *
   * Supports both standard AWS and LocalStack URL formats:
   * - AWS: https://sqs.{region}.amazonaws.com/{accountId}/{queueName}
   * - LocalStack: http://localhost:4566/{accountId}/{queueName}
   *
   * ARN format: arn:aws:sqs:{region}:{accountId}:{queueName}
   */
  private sqsArnFromUrl(queueUrl: string): string {
    const url = new URL(queueUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts.length < 2) {
      throw new Error(`Invalid SQS queue URL format: ${queueUrl}`);
    }

    const accountId = pathParts[0];
    const queueName = pathParts[1];

    // Determine region from URL or fall back to configured region
    // Standard AWS format: sqs.{region}.amazonaws.com
    // LocalStack format: localhost:4566 (no region in hostname)
    let region = this.config.region;
    const hostParts = url.hostname.split('.');
    const isAwsUrl = url.hostname.includes('amazonaws.com');

    if (isAwsUrl && hostParts.length >= 2 && hostParts[0] === 'sqs') {
      region = hostParts[1];
    }

    return `arn:aws:sqs:${region}:${accountId}:${queueName}`;
  }
}
