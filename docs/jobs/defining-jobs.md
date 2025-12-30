# Defining Jobs

Jobs in Glasswork are defined using the `defineJob` helper. This function creates a type-safe definition that includes the job's name, configuration, payload schema, and handler.

## Basic Definition

A minimal job definition requires a `name` and a `handler`.

```typescript
import { defineJob } from 'glasswork/jobs';

export const simpleJob = defineJob({
  name: 'simple-task',
  handler: async (payload, context) => {
    // Do work
  },
});
```

## Payload Validation

Glasswork uses [Valibot](https://valibot.dev/) for runtime payload validation. By providing a schema, you ensure that your job handler always receives valid data.

```typescript
import * as v from 'valibot';
import { defineJob } from 'glasswork/jobs';

export const processOrder = defineJob({
  name: 'process-order',
  schema: v.object({
    orderId: v.string(),
    amount: v.number(),
    currency: v.picklist(['USD', 'EUR', 'GBP']),
  }),
  handler: async ({ orderId, amount }, { logger }) => {
    // Types are inferred automatically!
    // orderId is string
    // amount is number
    logger.info({ orderId, amount }, 'Processing order');
  },
});
```

If the payload does not match the schema, the job will fail with an `InvalidJobPayloadError`. This error is treated as retriable—the job will retry until the configured `maxAttempts` is reached, then go to the Dead Letter Queue (DLQ).

## Retry Configuration

Configure how many times a job should retry before being considered "dead":

```typescript
// Default: 25 retries, send to DLQ when exhausted
export const emailJob = defineJob({
  name: 'send-email',
  handler: async () => { ... },
});

// Custom retry count
export const webhookJob = defineJob({
  name: 'send-webhook',
  retry: { maxAttempts: 5 },
  handler: async () => { ... },
});

// No retries (fire-and-forget)
export const analyticsJob = defineJob({
  name: 'track-event',
  retry: false,
  handler: async () => { ... },
});

// Shorthand syntax
export const quickJob = defineJob({
  name: 'quick-task',
  retry: 3, // Same as { maxAttempts: 3 }
  handler: async () => { ... },
});
```

See [Error Handling & Retries](./error-handling) for complete retry documentation.

## Queue Configuration

You can specify a target queue for the job. If omitted, the job will be sent to the default queue configured in the `JobService`.

```typescript
export const highPriorityJob = defineJob({
  name: 'critical-task',
  queue: 'high-priority',
  handler: async () => { ... },
});
```

## Job Uniqueness (FIFO)

For SQS FIFO queues, you can enforce job uniqueness to prevent duplicate processing. Glasswork allows you to define a unique key generator based on the payload.

```typescript
export const generateReport = defineJob({
  name: 'generate-report',
  queue: 'reports.fifo',
  unique: {
    // Only one job per reportId will be processed at a time
    key: (payload) => `report-${payload.reportId}`,
  },
  handler: async () => { ... },
});
```

When using `unique.key`:

1. The generated key is used as the SQS `MessageDeduplicationId`.
2. SQS ensures that if a message with the same deduplication ID is sent within a 5-minute interval, it is treated as a duplicate and not delivered.

## The Job Handler

The handler function receives two arguments:

1. **Payload**: The validated data for the job.
2. **Context**: An object containing useful utilities.

### Job Context

```typescript
interface JobContext {
  /**
   * The dependency injection container cradle.
   * Contains all your services (e.g., services.userService).
   */
  services: Record<string, unknown>;

  /**
   * A logger instance scoped to this job execution.
   * Automatically includes jobId and jobName in logs.
   */
  logger: Logger;

  /**
   * The unique ID of the job execution.
   */
  jobId: string;

  /**
   * The number of times this job has been attempted.
   * Starts at 1.
   */
  attemptNumber: number;

  /**
   * The date when the job was originally enqueued.
   */
  enqueuedAt: Date;
}
```

## Periodic Jobs

For jobs that run on a schedule (e.g., cron), use `definePeriodicJob`. These jobs typically don't have a payload and are triggered by EventBridge.

```typescript
import { definePeriodicJob } from 'glasswork/jobs';

export const dailyCleanup = definePeriodicJob({
  name: 'daily-cleanup',
  handler: async (_payload, { services, logger }) => {
    logger.info('Starting daily cleanup');
    await services.cleanupService.run();
  },
});
```

See [Dispatching & Scheduling](./dispatching#periodic-jobs) for how to configure the infrastructure for periodic jobs.
