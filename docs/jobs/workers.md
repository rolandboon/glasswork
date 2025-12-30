# Workers

Workers are Lambda functions that process background jobs from SQS queues.

## Setup

Create a worker using `bootstrapWorker` with your app module:

```typescript
// src/worker.ts
import { bootstrapWorker } from 'glasswork';
import { AppModule } from './app.module';

export const handler = bootstrapWorker({
  module: AppModule,
});
```

The worker automatically discovers and executes jobs registered in any module imported by `AppModule`.

## Lifecycle Hooks

Hook into the job lifecycle for logging, metrics, or error tracking:

```typescript
export const handler = bootstrapWorker({
  module: AppModule,
  hooks: {
    onJobStart: async (job, context) => {
      context.logger.info({ jobName: job.name }, 'Job started');
    },
    onJobComplete: async (job, context) => {
      context.logger.info({ jobName: job.name }, 'Job completed');
    },
    onJobFailed: async (job, context, error) => {
      context.logger.error({ error }, 'Job failed');
      await context.services.errorTracker?.capture(error);
    },
    onJobDeadLetter: async (job, context, error) => {
      context.logger.error({ error }, 'Job moved to DLQ');
    },
  },
});
```

## Error Handling

Glasswork distinguishes between **transient** (retriable) and **permanent** (non-retriable) errors.

### Transient Errors

Standard errors and `TransientJobError` are treated as transient:

```typescript
import { TransientJobError } from 'glasswork';

// In a job handler
if (apiRateLimited) {
  throw new TransientJobError('Rate limited, will retry');
}
```

- The Lambda throws the error
- SQS retries after visibility timeout
- Retry count tracked via `ApproximateReceiveCount`
- After `maxAttempts`, job goes to DLQ

### Permanent Errors

`PermanentJobError` indicates the job will never succeed:

```typescript
import { PermanentJobError } from 'glasswork';

// In a job handler
if (!user) {
  throw new PermanentJobError(`User ${userId} not found`);
}
```

- Error is logged
- `onJobDeadLetter` hook is called
- Job immediately goes to DLQ (no retries)

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

```yaml
# SAM template example
WorkerFunction:
  Type: AWS::Serverless::Function
  Properties:
    ReservedConcurrentExecutions: 5  # Max 5 concurrent workers
    Events:
      SQSEvent:
        Type: SQS
        Properties:
          Queue: !GetAtt JobQueue.Arn
          BatchSize: 10
```

## Custom Queue Drivers

While `SQSQueueDriver` is the default, you can implement `QueueDriver` for other backends:

```typescript
import { QueueDriver, JobMessage, EnqueueResult } from 'glasswork';

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
import { MockQueueDriver, JobService } from 'glasswork';

const driver = new MockQueueDriver();
const jobService = new JobService(driver);

await jobService.enqueue(myJob, { data: 'test' });

expect(driver.jobs).toHaveLength(1);
expect(driver.jobs[0].payload).toEqual({ data: 'test' });
```

See [Testing](./testing) for more patterns.
