import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBridgeSchedulerDriver } from '../../src/jobs/drivers/eventbridge-scheduler-driver.js';

const schedulerSendMock = vi.fn();

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

describe('EventBridgeSchedulerDriver', () => {
  let driver: EventBridgeSchedulerDriver;

  beforeEach(() => {
    driver = new EventBridgeSchedulerDriver({
      region: 'us-east-1',
      roleArn: 'arn:aws:iam::123456789012:role/scheduler-role',
    });
    schedulerSendMock.mockReset();
  });

  describe('scheduleAt', () => {
    it('creates a one-off schedule targeting SQS', async () => {
      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-job-1',
      });

      const scheduledAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      const result = await driver.scheduleAt({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-queue',
        message: {
          jobName: 'cleanup-job',
          payload: { ids: [1, 2, 3] },
        },
        scheduledAt,
      });

      expect(schedulerSendMock).toHaveBeenCalledTimes(1);
      expect(result.scheduleArn).toBe(
        'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-job-1'
      );
      expect(result.scheduleName).toContain('glasswork-');
      expect(result.jobId).toBeDefined();
      expect(result.messageId).toBe(result.jobId);
    });

    it('uses provided jobId if available', async () => {
      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-custom-id',
      });

      const result = await driver.scheduleAt({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-queue',
        message: {
          jobName: 'custom-job',
          payload: {},
          jobId: 'custom-id',
        },
        scheduledAt: new Date(Date.now() + 60000),
      });

      expect(result.jobId).toBe('custom-id');
      expect(result.scheduleName).toBe('glasswork-custom-id');
    });

    it('throws when schedule ARN is not returned', async () => {
      schedulerSendMock.mockResolvedValue({});

      await expect(
        driver.scheduleAt({
          queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-queue',
          message: {
            jobName: 'failing-job',
            payload: {},
          },
          scheduledAt: new Date(Date.now() + 60000),
        })
      ).rejects.toThrow('EventBridge Scheduler did not return a schedule ARN');
    });

    it('uses custom schedule group name when provided', async () => {
      const driverWithGroup = new EventBridgeSchedulerDriver({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/scheduler-role',
        scheduleGroupName: 'my-custom-group',
      });

      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/my-custom-group/glasswork-job-1',
      });

      const result = await driverWithGroup.scheduleAt({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-queue',
        message: {
          jobName: 'grouped-job',
          payload: {},
        },
        scheduledAt: new Date(Date.now() + 60000),
      });

      expect(result.scheduleArn).toContain('my-custom-group');
      expect(schedulerSendMock).toHaveBeenCalledTimes(1);

      const command = schedulerSendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(command.input.GroupName).toBe('my-custom-group');
    });

    it('uses custom endpoint when provided', async () => {
      const driverWithEndpoint = new EventBridgeSchedulerDriver({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/scheduler-role',
        endpoint: 'http://localhost:4566',
      });

      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-job-1',
      });

      await driverWithEndpoint.scheduleAt({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-queue',
        message: {
          jobName: 'local-job',
          payload: {},
        },
        scheduledAt: new Date(Date.now() + 60000),
      });

      expect(schedulerSendMock).toHaveBeenCalledTimes(1);
    });

    it('uses message queue for MessageGroupId when provided', async () => {
      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-job-1',
      });

      await driver.scheduleAt({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-queue',
        message: {
          jobName: 'queued-job',
          payload: {},
          queue: 'high-priority',
        },
        scheduledAt: new Date(Date.now() + 60000),
      });

      const command = schedulerSendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      const target = command.input.Target as Record<string, unknown>;
      const sqsParams = target.SqsParameters as Record<string, unknown>;
      expect(sqsParams.MessageGroupId).toBe('high-priority');
    });

    it('includes metadata in message body', async () => {
      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-job-1',
      });

      await driver.scheduleAt({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-queue',
        message: {
          jobName: 'metadata-job',
          payload: {},
          metadata: { source: 'test', userId: 'user-123' },
        },
        scheduledAt: new Date(Date.now() + 60000),
      });

      const command = schedulerSendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      const target = command.input.Target as Record<string, unknown>;
      const messageBody = JSON.parse(target.Input as string);

      expect(messageBody.metadata).toEqual({ source: 'test', userId: 'user-123' });
    });
  });

  describe('cancel', () => {
    it('deletes the schedule', async () => {
      schedulerSendMock.mockResolvedValue({});

      await driver.cancel('glasswork-job-123');

      expect(schedulerSendMock).toHaveBeenCalledTimes(1);
      const command = schedulerSendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(command.input.Name).toBe('glasswork-job-123');
      expect(command.input.GroupName).toBe('default');
    });

    it('uses custom schedule group name when canceling', async () => {
      const driverWithGroup = new EventBridgeSchedulerDriver({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/scheduler-role',
        scheduleGroupName: 'my-group',
      });

      schedulerSendMock.mockResolvedValue({});

      await driverWithGroup.cancel('glasswork-job-456');

      const command = schedulerSendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      expect(command.input.Name).toBe('glasswork-job-456');
      expect(command.input.GroupName).toBe('my-group');
    });
  });

  describe('sqsArnFromUrl', () => {
    it('throws for invalid SQS URL format', async () => {
      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-job-1',
      });

      await expect(
        driver.scheduleAt({
          queueUrl: 'https://sqs.us-east-1.amazonaws.com/queue-only',
          message: {
            jobName: 'invalid-url-job',
            payload: {},
          },
          scheduledAt: new Date(Date.now() + 60000),
        })
      ).rejects.toThrow('Invalid SQS queue URL format');
    });

    it('extracts region from queue URL hostname', async () => {
      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:eu-west-1:456:schedule/default/glasswork-job-1',
      });

      await driver.scheduleAt({
        queueUrl: 'https://sqs.eu-west-1.amazonaws.com/456789012345/my-queue',
        message: {
          jobName: 'regional-job',
          payload: {},
        },
        scheduledAt: new Date(Date.now() + 60000),
      });

      const command = schedulerSendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      const target = command.input.Target as Record<string, unknown>;
      expect(target.Arn).toBe('arn:aws:sqs:eu-west-1:456789012345:my-queue');
    });

    it('uses configured region for LocalStack URLs', async () => {
      const localstackDriver = new EventBridgeSchedulerDriver({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::000000000000:role/scheduler-role',
        endpoint: 'http://localhost:4566',
      });

      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:000:schedule/default/glasswork-job-1',
      });

      await localstackDriver.scheduleAt({
        queueUrl: 'http://localhost:4566/000000000000/test-queue',
        message: {
          jobName: 'localstack-job',
          payload: {},
        },
        scheduledAt: new Date(Date.now() + 60000),
      });

      const command = schedulerSendMock.mock.calls[0][0] as { input: Record<string, unknown> };
      const target = command.input.Target as Record<string, unknown>;
      // Should use configured region (us-east-1) since localhost doesn't have region in hostname
      expect(target.Arn).toBe('arn:aws:sqs:us-east-1:000000000000:test-queue');
    });
  });

  describe('dispose', () => {
    it('can be called safely even when client is not initialized', async () => {
      const freshDriver = new EventBridgeSchedulerDriver({
        region: 'us-east-1',
        roleArn: 'arn:aws:iam::123456789012:role/scheduler-role',
      });

      // Should not throw
      await expect(freshDriver.dispose()).resolves.toBeUndefined();
    });

    it('destroys the client after initialization', async () => {
      schedulerSendMock.mockResolvedValue({
        ScheduleArn: 'arn:aws:scheduler:us-east-1:123:schedule/default/glasswork-job-1',
      });

      // Initialize the client by making a call
      await driver.scheduleAt({
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-queue',
        message: {
          jobName: 'test-job',
          payload: {},
        },
        scheduledAt: new Date(Date.now() + 60000),
      });

      // Should not throw
      await expect(driver.dispose()).resolves.toBeUndefined();
    });
  });
});
