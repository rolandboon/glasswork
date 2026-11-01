import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESTransport } from '../../src/email/transports/ses-transport.js';
import { EventBridgeSchedulerDriver } from '../../src/jobs/drivers/eventbridge-scheduler-driver.js';
import { SQSQueueDriver } from '../../src/jobs/drivers/sqs-driver.js';

const clients = vi.hoisted(() => ({
  sqs: vi.fn(),
  ses: vi.fn(),
  scheduler: vi.fn(),
  send: vi.fn(async () => ({ MessageId: 'message', ScheduleArn: 'arn:schedule' })),
  destroy: vi.fn(),
}));
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    constructor() {
      clients.sqs();
    }
    send = clients.send;
    destroy = clients.destroy;
  },
  SendMessageCommand: class {},
}));
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    constructor() {
      clients.ses();
    }
    send = clients.send;
  },
  SendEmailCommand: class {},
}));
vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: class {
    constructor() {
      clients.scheduler();
    }
    send = clients.send;
    destroy = clients.destroy;
  },
  CreateScheduleCommand: class {},
}));

const queueUrl = 'https://sqs.eu-west-1.amazonaws.com/123456789012/jobs';
const job = { jobName: 'example', payload: {} };
const schedule = { queueUrl, message: job, scheduledAt: new Date('2030-01-01T00:00:00Z') };
const sqs = () => new SQSQueueDriver({ region: 'eu-west-1', queues: { default: queueUrl } });
const scheduler = () =>
  new EventBridgeSchedulerDriver({ region: 'eu-west-1', roleArn: 'arn:role' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lazy AWS adapter clients', () => {
  it('creates one SQS client for simultaneous first enqueues', async () => {
    const driver = sqs();
    await Promise.all([driver.enqueue(job), driver.enqueue(job)]);
    expect(clients.sqs).toHaveBeenCalledTimes(1);
    await driver.dispose();
    expect(clients.destroy).toHaveBeenCalledTimes(1);
  });
  it('creates one SES client for simultaneous first sends', async () => {
    const transport = new SESTransport({ region: 'eu-west-1' });
    const message = {
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    };
    await Promise.all([transport.send(message), transport.send(message)]);
    expect(clients.ses).toHaveBeenCalledTimes(1);
  });
  it('creates one Scheduler client for simultaneous first schedules', async () => {
    const driver = scheduler();
    await Promise.all([driver.scheduleAt(schedule), driver.scheduleAt(schedule)]);
    expect(clients.scheduler).toHaveBeenCalledTimes(1);
    await driver.dispose();
    expect(clients.destroy).toHaveBeenCalledTimes(1);
  });
  it('does not create an SQS client after disposal during its import', async () => {
    const driver = sqs();
    const sending = driver.enqueue(job);
    await driver.dispose();
    await expect(sending).rejects.toThrow('SQSQueueDriver has been disposed');
    expect(clients.sqs).not.toHaveBeenCalled();
    expect(clients.send).not.toHaveBeenCalled();
  });
  it('does not create a Scheduler client after disposal during its import', async () => {
    const driver = scheduler();
    const sending = driver.scheduleAt(schedule);
    await driver.dispose();
    await expect(sending).rejects.toThrow('EventBridgeSchedulerDriver has been disposed');
    expect(clients.scheduler).not.toHaveBeenCalled();
    expect(clients.send).not.toHaveBeenCalled();
  });
});
