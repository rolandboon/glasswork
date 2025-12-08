---
title: Testing
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

Since job handlers are just functions, you can test them directly by invoking the `handler` property. You'll need to mock the context.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { sendWelcomeEmail } from '../jobs/send-welcome-email.job';

describe('sendWelcomeEmail Job', () => {
  it('sends email via email service', async () => {
    // Mock services
    const emailService = { send: vi.fn() };
    const logger = { info: vi.fn() };

    // Invoke handler
    await sendWelcomeEmail.handler(
      { userId: '123', name: 'Alice' },
      {
        services: { emailService },
        logger,
        jobId: 'test-job',
        attemptNumber: 1,
        enqueuedAt: new Date(),
      } as any // Cast to JobContext
    );

    // Assert
    expect(emailService.send).toHaveBeenCalledWith('welcome', {
      to: '123',
      name: 'Alice',
    });
  });
});
```

## Integration Testing Workers

You can also test the full worker lifecycle using `bootstrapWorker` and simulated SQS events.

```typescript
import { bootstrapWorker } from 'glasswork/jobs';
import { WorkerModule } from '../modules/worker.module';

it('processes SQS event', async () => {
  const handler = bootstrapWorker({
    module: WorkerModule,
    // Use mock driver for any jobs enqueued BY the worker
    driver: new MockQueueDriver(),
  });

  const event = {
    Records: [
      {
        messageId: 'msg-1',
        body: JSON.stringify({
          jobName: 'send-welcome-email',
          payload: { userId: '123', name: 'Alice' },
        }),
        attributes: { ApproximateReceiveCount: '1' },
      },
    ],
  };

  const result = await handler(event as any);

  expect(result.batchItemFailures).toHaveLength(0);
  // Verify side effects (e.g., check database or mocked services)
});
```
