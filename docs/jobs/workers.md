---
description: Lambda-based workers that process background jobs from SQS queues, including setup, batch processing, and concurrency.
---

# Workers

Workers are Lambda functions that process background jobs from SQS queues.

`bootstrapWorker` returns failed SQS record IDs in `batchItemFailures`. Every SQS
event source must enable `reportBatchItemFailures: true` in CDK's `SqsEventSource`.
Without it, Lambda treats a normally returned invocation as successful and can
remove failed records from the queue. Apply this setting to existing deployments
as well; updating the worker package does not update the event source mapping.
See [AWS partial batch responses](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html).

## Setup

Create a worker using `bootstrapWorker` with your app module:

```typescript
// src/worker.ts
import { bootstrapWorker } from 'glasswork/jobs';
import { AppModule } from './app.module';

export const handler = bootstrapWorker({
  module: AppModule,
});
```

The worker automatically discovers and executes jobs registered in any module imported by `AppModule`.

In Lambda, workers also emit per-attempt CloudWatch EMF metrics automatically.
See [Worker Observability](./observability) for configuration, metric semantics,
and application-owned dashboards and alarms using native CDK.

## Lifecycle Hooks

Hook into the job lifecycle for application logging or error tracking.
Standard execution metrics are already emitted by the worker:

```typescript
export const handler = bootstrapWorker({
  module: AppModule,
  hooks: {
    onJobStart: async (job, context) => {
      context.logger?.info('Job started', { jobName: job.jobName });
    },
    onJobComplete: async (job, context) => {
      context.logger?.info('Job completed', { jobName: job.jobName });
    },
    onJobFailed: async (job, context, error) => {
      context.logger?.error('Job failed', { error });
      // Report the failure to your application's error tracker here.
    },
    onJobDeadLetter: async (job, context, error) => {
      context.logger?.error('Job requires dead-letter handling', { error });
    },
  },
});
```

## Error Handling

Glasswork distinguishes between **transient** (retriable) and **permanent** (non-retriable) errors.

### Transient Errors

Standard errors and `TransientJobError` are treated as transient:

```typescript
import { TransientJobError } from 'glasswork/jobs';

// In a job handler
if (apiRateLimited) {
  throw new TransientJobError('Rate limited, will retry');
}
```

- The worker returns the record ID in `batchItemFailures`
- SQS retries after visibility timeout
- Retry count tracked via `ApproximateReceiveCount`
- The worker classifies failures after `maxAttempts` as exhausted; SQS redrives
  the message when its own `maxReceiveCount` threshold is reached

### Permanent Errors

`PermanentJobError` indicates the job will never succeed:

```typescript
import { PermanentJobError } from 'glasswork/jobs';

// In a job handler
if (!user) {
  throw new PermanentJobError(`User ${userId} not found`);
}
```

- Error is logged
- `onJobDeadLetter` hook is called
- The record remains a batch failure until SQS redrives it using the queue's
  `maxReceiveCount`; the hook does not itself move the message to the DLQ

### Retry Configuration

Configure retry behavior per-job:

```typescript
export const webhookJob = defineJob({
  name: 'send-webhook',
  retry: { maxAttempts: 5 },  // Only 5 retries
  handler: async () => { ... },
});

export const analyticsJob = defineJob({
  name: 'track-event',
  retry: false,  // No retries, discard on failure
  handler: async () => { ... },
});
```

See [Error Handling & Retries](./error-handling) for complete retry documentation.

## Concurrency & Scaling

Concurrency is managed by AWS Lambda's SQS integration:

| Setting | Description |
|---------|-------------|
| **Batch Size** | Messages per Lambda invocation (1-10) |
| **Lambda Concurrency** | AWS automatically scales based on queue depth |
| **Reserved Concurrency** | Limit concurrent workers to protect downstream resources |

Set `reservedConcurrentExecutions: 5` when creating the worker's CDK
`NodejsFunction`, then attach its existing `jobQueue`:

```typescript
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

worker.addEventSource(
  new SqsEventSource(jobQueue, {
    batchSize: 10,
    maxConcurrency: 5,
    reportBatchItemFailures: true,
  })
);
```

`maxConcurrency` limits this event source; reserved concurrency limits the whole
function. When multiple queues feed a worker, allow enough reserved concurrency
for their combined limits to avoid throttling. See [AWS Setup](./aws-setup).

## Custom Queue Drivers

While `SQSQueueDriver` is the default, you can implement `QueueDriver` for other backends:

```typescript
import { QueueDriver, JobMessage, EnqueueResult } from 'glasswork/jobs';

export class RedisQueueDriver implements QueueDriver {
  readonly name = 'redis';

  async enqueue(message: JobMessage): Promise<EnqueueResult> {
    // Custom implementation
  }

  // ... other methods
}
```

## Testing Workers

Use `MockQueueDriver` for unit tests:

```typescript
import { MockQueueDriver, JobService } from 'glasswork/jobs';

const driver = new MockQueueDriver();
const jobService = new JobService(driver);

await jobService.enqueue(myJob, { data: 'test' });

expect(driver.jobs).toHaveLength(1);
expect(driver.jobs[0].payload).toEqual({ data: 'test' });
```

See [Testing](./testing) for more patterns.
