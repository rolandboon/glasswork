---
title: Workers
---

# Workers

Workers are the Lambda functions responsible for processing background jobs. Glasswork provides a `bootstrapWorker` helper to create a robust SQS handler.

## Setup

A worker requires a **Module** (containing the jobs and services) and a **Queue Driver**. Use the config service for queue settings (see [Environment Config](/configuration/environment-config)).

```typescript
// src/worker.ts
import { bootstrapWorker, SQSQueueDriver } from 'glasswork/jobs';
import { WorkerModule } from './modules/worker.module';
import { jobConfig } from './config/job-config';

export const handler = bootstrapWorker({
  module: WorkerModule,
  driver: new SQSQueueDriver({
    region: jobConfig.get('awsRegion'),
    queues: {
      default: jobConfig.get('jobQueueUrl'),
    },
  }),
});
```

## Lifecycle Hooks

You can hook into the job lifecycle for logging, metrics, or error tracking.

```typescript
export const handler = bootstrapWorker({
  module: WorkerModule,
  driver: new SQSQueueDriver({ ... }),
  hooks: {
    onJobStart: async (job, context) => {
      context.logger.info('Job started');
    },
    onJobComplete: async (job, context) => {
      context.logger.info('Job completed successfully');
    },
    onJobFailed: async (job, context, error) => {
      context.logger.error('Job failed', { error });
      // Send to error tracking (e.g., Sentry, AppSignal)
      await context.services.errorTracker.capture(error);
    },
    onJobDeadLetter: async (job, context, error) => {
      context.logger.error('Job moved to DLQ', { error });
    },
  },
});
```

## Error Handling

Glasswork distinguishes between **transient** and **permanent** errors.

### Transient Errors (Retriable)

If a job fails with a standard `Error` or a `TransientJobError`, Glasswork assumes it might succeed later.

- The Lambda will throw the error.
- SQS will see the failure and retry the message after the visibility timeout.
- The retry count is tracked by SQS (`ApproximateReceiveCount`).

```typescript
import { TransientJobError } from 'glasswork/jobs';

// ... inside handler ...
if (apiRateLimited) {
  // Retry this job later
  throw new TransientJobError('Rate limited');
}
```

### Permanent Errors (Non-Retriable)

If a job fails with a `PermanentJobError` (or `InvalidJobPayloadError`), Glasswork knows it will never succeed.

- The error is logged.
- The `onJobDeadLetter` hook is called.
- The message is **successfully consumed** from SQS (deleted) to prevent infinite retries.
- Ideally, you should have a Dead Letter Queue configured on your SQS resource to catch these if you want to inspect them manually, but Glasswork handles the "don't retry" logic at the application level.

```typescript
import { PermanentJobError } from 'glasswork/jobs';

// ... inside handler ...
if (!user) {
  throw new PermanentJobError(`User ${userId} not found`);
}
```

### Poison Messages

If a message cannot be parsed (invalid JSON), Glasswork catches the error, logs it, and swallows the message. This prevents "poison messages" from blocking the queue or triggering infinite Lambda invocations.

## Concurrency & Scaling

Concurrency is managed by AWS Lambda's integration with SQS.

1. **Batch Size**: You can configure the SQS event source mapping to send batches of messages (e.g., 10 at a time). Glasswork processes them sequentially within a single Lambda invocation.
2. **Lambda Concurrency**: AWS scales the number of Lambda instances based on queue depth.
3. **Rate Limiting**: To limit concurrency (e.g., to protect a database), set the `ReservedConcurrentExecutions` on your Worker Lambda function in your IaC (SAM/Terraform).

```yaml
# Example SAM template
WorkerFunction:
  Type: AWS::Serverless::Function
  Properties:
    ReservedConcurrentExecutions: 5 # Max 5 concurrent workers
    Events:
      SQSEvent:
        Type: SQS
        Properties:
          Queue: !GetAtt JobQueue.Arn
          BatchSize: 10
```

## Custom Drivers

While `SQSQueueDriver` is the default, you can implement the `QueueDriver` interface to use other backends (e.g., Redis, RabbitMQ) or for testing.

```typescript
import { QueueDriver, JobMessage, EnqueueResult } from 'glasswork/jobs';

export class MyCustomDriver implements QueueDriver {
  readonly name = 'custom';

  async enqueue(message: JobMessage): Promise<EnqueueResult> {
    // ... custom implementation ...
  }
}
```
