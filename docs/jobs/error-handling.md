# Error Handling & Retries

Glasswork provides a flexible retry system that integrates with SQS's built-in retry mechanism while giving you control over retry behavior at the job level.

## How Retries Work

When a job fails, Glasswork works with SQS to handle retries:

1. **Job throws an error** → Lambda fails processing
2. **SQS visibility timeout expires** → Message becomes visible again
3. **SQS redelivers the message** → `ApproximateReceiveCount` increments
4. **Glasswork tracks attempts** → Compares against `maxAttempts`
5. **Retries exhausted** → `onJobDeadLetter` hook fires

> **Note:** Retry timing is controlled by your queue's **visibility timeout** setting (default 30 seconds, configurable up to 12 hours). This is different from **delay seconds** (max 15 minutes) which controls initial job scheduling via `enqueueAt`/`enqueueIn`.

## Retry Configuration

Configure retry behavior per-job using the `retry` option:

```typescript
import { defineJob } from 'glasswork';

// Default: 25 retries, send to DLQ when exhausted
const defaultJob = defineJob({
  name: 'email-send',
  handler: async (payload) => { ... },
});

// Custom retry count
const webhookJob = defineJob({
  name: 'webhook-send',
  retry: { maxAttempts: 5 },
  handler: async (payload) => { ... },
});

// No retries (fire-and-forget)
const analyticsJob = defineJob({
  name: 'track-event',
  retry: false,
  handler: async (payload) => { ... },
});

// Shorthand for maxAttempts
const quickJob = defineJob({
  name: 'quick-task',
  retry: 3, // Same as { maxAttempts: 3 }
  handler: async (payload) => { ... },
});

// Retry but discard instead of DLQ
const notificationJob = defineJob({
  name: 'push-notification',
  retry: { maxAttempts: 5, dead: false },
  handler: async (payload) => { ... },
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `25` | Maximum retry attempts before exhaustion |
| `dead` | `boolean` | `true` | Send to DLQ on exhaustion (if false, discard) |

### Shorthand Syntax

| Syntax | Equivalent |
|--------|------------|
| `retry: undefined` | `{ maxAttempts: 25, dead: true }` |
| `retry: 5` | `{ maxAttempts: 5, dead: true }` |
| `retry: false` | No retries, discard on failure |

## Error Types

### TransientJobError

Indicates a temporary failure that should be retried:

```typescript
import { TransientJobError } from 'glasswork';

export const fetchDataJob = defineJob({
  name: 'fetch-external-data',
  handler: async (payload, ctx) => {
    const response = await fetch(payload.url);

    if (response.status === 429) {
      throw new TransientJobError('Rate limited');
    }

    if (response.status >= 500) {
      throw new TransientJobError('Upstream server error');
    }

    // Process data...
  },
});
```

`TransientJobError` is treated the same as any other error—it triggers a retry. The distinction is semantic for logging and monitoring.

### PermanentJobError

Indicates the job will never succeed and should not be retried:

```typescript
import { PermanentJobError } from 'glasswork';

export const processOrderJob = defineJob({
  name: 'process-order',
  handler: async (payload, ctx) => {
    const order = await ctx.services.orderService.find(payload.orderId);

    if (!order) {
      throw new PermanentJobError(`Order ${payload.orderId} not found`);
    }

    if (order.status === 'cancelled') {
      throw new PermanentJobError('Cannot process cancelled order');
    }

    // Process order...
  },
});
```

When `PermanentJobError` is thrown:
- The job is **immediately** sent to the DLQ (no retries)
- `onJobDeadLetter` hook is called
- The original error is logged

### RetryExhaustedError

Thrown internally when a job exhausts all retries. You'll see this in the `onJobDeadLetter` hook:

```typescript
import { RetryExhaustedError } from 'glasswork';

bootstrapWorker({
  module: AppModule,
  hooks: {
    onJobDeadLetter: (job, ctx, error) => {
      if (error instanceof RetryExhaustedError) {
        // Access original error
        console.log('Original error:', error.cause);
        console.log('Attempts made:', error.attemptNumber);
        console.log('Max attempts:', error.maxAttempts);
      }
    },
  },
});
```

## Lifecycle Hooks

Use hooks to monitor retry behavior:

```typescript
bootstrapWorker({
  module: AppModule,
  hooks: {
    onJobFailed: (job, ctx, error) => {
      // Called on EVERY failure (before retry check)
      metrics.increment('job.failed', {
        job: job.jobName,
        attempt: job.attemptNumber,
      });
    },

    onJobDeadLetter: (job, ctx, error) => {
      // Called when:
      // 1. PermanentJobError is thrown
      // 2. Retries are exhausted
      alertService.critical(`Job ${job.jobName} dead`, {
        jobId: job.jobId,
        error: error.message,
      });
    },
  },
});
```

## Infrastructure Configuration

For the retry system to work correctly, configure your SQS queue's redrive policy:

```yaml
# SAM template
JobQueue:
  Type: AWS::SQS::Queue
  Properties:
    VisibilityTimeout: 60  # Retry delay
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt JobDLQ.Arn
      maxReceiveCount: 25  # Should match job's maxAttempts

JobDLQ:
  Type: AWS::SQS::Queue
  Properties:
    MessageRetentionPeriod: 1209600  # 14 days
```

> **Important:** Set `maxReceiveCount` to match your highest job `maxAttempts`. If they don't match, SQS may send jobs to the DLQ before Glasswork's retry exhaustion logic triggers.

## Best Practices

### 1. Use Appropriate Retry Counts

| Job Type | Recommended `maxAttempts` |
|----------|---------------------------|
| Critical business logic | 10-25 |
| External API calls | 3-5 |
| Non-critical notifications | 1-3 |
| Analytics/logging | 1 or `false` |

### 2. Make Jobs Idempotent

Jobs may be retried, so ensure they're safe to run multiple times:

```typescript
export const chargeCustomerJob = defineJob({
  name: 'charge-customer',
  handler: async (payload, ctx) => {
    // Use idempotency key to prevent duplicate charges
    const existing = await ctx.services.paymentService.findByIdempotencyKey(
      payload.idempotencyKey
    );

    if (existing) {
      ctx.logger?.info('Payment already processed');
      return;
    }

    await ctx.services.paymentService.charge(payload);
  },
});
```

### 3. Log Attempt Information

Include attempt number in logs for debugging:

```typescript
export const myJob = defineJob({
  name: 'flaky-operation',
  retry: { maxAttempts: 5 },
  handler: async (payload, ctx) => {
    ctx.logger?.info(`Attempt ${ctx.attemptNumber} of 5`);
    // ...
  },
});
```

### 4. Use PermanentJobError for Unrecoverable States

Don't waste retries on errors that will never succeed:

```typescript
// Good: Fail permanently for missing prerequisites
if (!user) {
  throw new PermanentJobError('User deleted');
}

// Bad: This will retry 25 times for nothing
if (!user) {
  throw new Error('User not found');
}
```

### 5. Consider Using `dead: false` for Non-Critical Jobs

For jobs where you don't need DLQ storage:

```typescript
export const trackClickJob = defineJob({
  name: 'track-click',
  retry: { maxAttempts: 2, dead: false },
  handler: async (payload) => {
    await analytics.track(payload);
  },
});
```

## Related

- [Defining Jobs](./defining-jobs) - Job definition options
- [Workers](./workers) - Worker setup and error handling
- [AWS Setup](./aws-setup) - Queue and DLQ configuration
