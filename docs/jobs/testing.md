---
description: Testing background jobs with MockQueueDriver, unit testing enqueuing, and verifying job payloads.
---

# Testing

Glasswork makes testing background jobs easy with dedicated test helpers and drivers.

## Unit Testing Enqueuing

When testing services that enqueue jobs, use the `MockQueueDriver`. This allows you to verify that jobs are enqueued with the correct payload without actually sending them to SQS.

```typescript
import { describe, it, expect } from 'vitest';
import { JobService, MockQueueDriver } from 'glasswork/jobs';
import { sendWelcomeEmail } from '../jobs/send-welcome-email.job';

describe('UserService', () => {
  it('enqueues welcome email on registration', async () => {
    // Setup
    const driver = new MockQueueDriver();
    const jobService = new JobService(driver);
    const userService = new UserService(jobService);

    // Act
    await userService.register('Alice', 'alice@example.com');

    // Assert
    expect(driver.enqueued).toHaveLength(1);
    expect(driver.enqueued[0].message).toMatchObject({
      jobName: 'send-welcome-email',
      payload: {
        name: 'Alice',
        userId: expect.any(String),
      },
    });
  });
});
```

## Testing Job Handlers

Since job handlers are just functions, you can test them directly by invoking the `handler` property with a mock context.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { type JobContext } from 'glasswork/jobs';
import { sendWelcomeEmail } from '../jobs/send-welcome-email.job';

describe('sendWelcomeEmail Job', () => {
  it('sends email via email service', async () => {
    // Mock services
    const emailService = { send: vi.fn() };

    // Create minimal context
    const context: JobContext = {
      services: { emailService },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      jobId: 'test-job',
      attemptNumber: 1,
      enqueuedAt: new Date(),
    };

    // Invoke handler
    await sendWelcomeEmail.handler(
      { userId: '123', name: 'Alice' },
      context
    );

    // Assert
    expect(emailService.send).toHaveBeenCalledWith('welcome', {
      to: '123',
      name: 'Alice',
    });
  });
});
```

## Running Jobs Locally

With `executeImmediately: true`, `MockQueueDriver` runs each job in-process as soon as it is enqueued. Build the driver in a provider factory and return the factory's injected services from `serviceResolver`:

```typescript
import { defineModule, isProduction } from 'glasswork/core';
import { JobService, MockQueueDriver, SQSQueueDriver } from 'glasswork/jobs';

export const JobsModule = defineModule({
  name: 'jobs',
  providers: [
    {
      provide: 'queueDriver',
      useFactory: (services) =>
        isProduction()
          ? new SQSQueueDriver({
              region: process.env.AWS_REGION!,
              queues: { default: process.env.JOB_QUEUE_URL! },
            })
          : new MockQueueDriver({ executeImmediately: true, serviceResolver: () => services }),
    },
    {
      provide: 'jobService',
      useFactory: ({ queueDriver }) => new JobService(queueDriver),
    },
  ],
  exports: ['jobService'],
});
```

A job listed in a module's `jobs` then runs in a new scope of that module, exactly as in the worker: it can use the module's private providers, and scoped providers are created and disposed per execution. You do not need to export domain services to the jobs module. Jobs that no module declares receive the services `serviceResolver` returns, and so does a plain object returned from it.

## Integration Testing Workers

Test the full worker lifecycle using `bootstrapWorker` and simulated SQS events.

```typescript
import type { SQSEvent } from 'aws-lambda';
import { bootstrapWorker } from 'glasswork/jobs';
import { WorkerModule } from '../modules/worker.module';

it('processes SQS event', async () => {
  const handler = bootstrapWorker({
    module: WorkerModule,
  });

  const event: SQSEvent = {
    Records: [
      {
        messageId: 'msg-1',
        receiptHandle: 'receipt-1',
        body: JSON.stringify({
          jobName: 'send-welcome-email',
          payload: { userId: '123', name: 'Alice' },
        }),
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: Date.now().toString(),
          SenderId: 'test',
          ApproximateFirstReceiveTimestamp: Date.now().toString(),
        },
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test-queue',
        awsRegion: 'us-east-1',
      },
    ],
  };

  const result = await handler(event, {} as never, () => {});

  expect(result?.batchItemFailures).toHaveLength(0);
});
```

## Test Helpers

### assertJobEnqueued

Create a helper for common assertions:

```typescript
function assertJobEnqueued(
  driver: MockQueueDriver,
  jobName: string,
  payload: unknown
) {
  const job = driver.enqueued.find(j => j.message.jobName === jobName);
  expect(job).toBeDefined();
  expect(job?.message.payload).toMatchObject(payload);
}

// Usage
assertJobEnqueued(driver, 'send-welcome-email', { userId: '123' });
```
