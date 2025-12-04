# Background Jobs Development Plan for Glasswork

## Executive Summary

This document outlines the plan to integrate a first-class background jobs solution into the Glasswork framework. The solution provides async job processing with AWS SQS as the default queue backend, while maintaining framework principles of transparency, customization, and Lambda optimization.

## Background & Context

### Current State

Glasswork currently has no background job processing capability. Applications needing async processing must implement custom SQS integrations manually.

### Framework Principles

1. **Lambda-First**: Optimize for cold start times and bundle size
2. **Transparency**: Allow easy customization; underlying libraries are directly accessible
3. **Great DX**: Make common tasks simple, complex tasks possible
4. **Type Safety**: Leverage TypeScript throughout

### Inspiration

- **Sidekiq (Ruby)**: Excellent API design (`perform_async`, `perform_at`, `perform_in`), robust retry handling, great web UI
- **BullMQ (Node.js)**: Good features (rate limiting, concurrency, job events) but heavy decorator usage in NestJS doesn't align with Glasswork philosophy

### Key Requirements

1. **Separate Worker Lambda**: Keep HTTP Lambda lightweight; worker processes jobs
2. **Configurable Queue Backend**: SQS default, but architecture supports Redis/NATS/RabbitMQ later
3. **Sidekiq-like API**: `enqueue()`, `enqueueAt(date)`, `enqueueIn(duration)`
4. **Scheduled/Periodic Jobs**: Cron-like recurring jobs via EventBridge + dynamic scheduling
5. **Type Safety**: Fully typed job payloads
6. **No Decorators**: Plain TypeScript, no `reflect-metadata`

---

## Design Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| **Job Definition** | Function-based with `defineJob()` | Aligns with Glasswork's route-helper syntax; cleaner DI |
| **Scheduled Jobs** | EventBridge for static + DynamoDB for dynamic | Flexibility without overcomplicating core use case |
| **Web UI** | Deferred to Phase 6 | Focus on core functionality first |
| **Rate Limiting** | Lambda reserved concurrency | Job-level rate limiting requires external state, adds complexity; Lambda handles this naturally |
| **Package Distribution** | Integrated in core during development, `@glasswork/jobs` for release | Matches email module approach |
| **Result Storage** | Optional via lifecycle hooks | Matches email's `onSent` hook pattern |
| **Payload Size** | Validate on enqueue, document limitation | Keeps implementation simple; 256KB is sufficient for most use cases |
| **Job Uniqueness** | Optional deduplication via FIFO queues | Prevents duplicate processing without excessive complexity |
| **Job Priorities** | Out of scope (users configure multiple queues) | Keeps framework simple; priority is infrastructure concern |

---

## Architecture

### High-Level Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  HTTP Lambda    │────▶│   SQS Queue  │────▶│  Worker Lambda  │
│  (Enqueue jobs) │     │              │     │  (Process jobs) │
└─────────────────┘     └──────────────┘     └─────────────────┘
        │                                            │
        │                                            ▼
        │                                    ┌─────────────────┐
        │                                    │  Dead Letter Q  │
        │                                    └─────────────────┘
        │
        ▼
┌─────────────────┐     ┌─────────────────┐
│  EventBridge    │────▶│  Worker Lambda  │
│  (Schedules)    │     │  (Periodic jobs)│
└─────────────────┘     └─────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  DynamoDB       │────▶│  EventBridge    │────▶│  Worker Lambda  │
│  (Long delays)  │     │  (Scheduler)    │     │  (Enqueue job)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Queue Driver Interface

Following the email transport pattern:

```typescript
interface QueueDriver {
  /** Driver name for logging/debugging */
  readonly name: string;

  /**
   * Enqueue a job for immediate processing
   */
  enqueue(message: JobMessage): Promise<EnqueueResult>;

  /**
   * Enqueue a job for processing at a specific time
   * Note: For delays > 15 minutes, uses DynamoDB scheduler
   */
  enqueueAt(message: JobMessage, at: Date): Promise<EnqueueResult>;

  /**
   * Enqueue a job for processing after a delay
   * Note: For delays > 15 minutes, uses DynamoDB scheduler
   */
  enqueueIn(message: JobMessage, delay: Duration): Promise<EnqueueResult>;

  /**
   * Receive jobs from the queue (for worker)
   */
  receive(options: ReceiveOptions): Promise<ReceivedJob[]>;

  /**
   * Acknowledge successful job completion
   */
  ack(job: ReceivedJob): Promise<void>;

  /**
   * Reject a job (will be retried or sent to DLQ)
   */
  nack(job: ReceivedJob, error?: Error): Promise<void>;
}

interface JobMessage {
  /** Job type identifier */
  jobName: string;
  /** Job payload (JSON-serializable) */
  payload: unknown;
  /** Queue to use (default: 'default') */
  queue?: string;
  /** Job ID (auto-generated if not provided) */
  jobId?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

interface EnqueueResult {
  /** Queue-assigned message ID */
  messageId: string;
  /** Generated or provided job ID */
  jobId: string;
}
```

### SQS Driver Implementation

```typescript
class SQSDriver implements QueueDriver {
  readonly name = 'sqs';
  private client: SQSClient | null = null;

  constructor(private config: SQSDriverConfig) {}

  /**
   * Lazily initializes the SQS client
   */
  private async getClient(): Promise<SQSClient> {
    if (!this.client) {
      const { SQSClient } = await import('@aws-sdk/client-sqs');
      this.client = new SQSClient({
        region: this.config.region,
        ...(this.config.endpoint && { endpoint: this.config.endpoint }),
      });
    }
    return this.client;
  }

  async enqueue(message: JobMessage): Promise<EnqueueResult> {
    const client = await this.getClient();
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    const queueUrl = this.getQueueUrl(message.queue);
    const jobId = message.jobId || generateJobId();

    const result = await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        jobName: message.jobName,
        payload: message.payload,
        jobId,
        metadata: message.metadata,
        enqueuedAt: new Date().toISOString(),
      }),
      MessageAttributes: {
        JobName: { DataType: 'String', StringValue: message.jobName },
      },
    }));

    return {
      messageId: result.MessageId!,
      jobId,
    };
  }

  async enqueueIn(message: JobMessage, delay: Duration): Promise<EnqueueResult> {
    const delaySeconds = parseDuration(delay);

    // SQS max delay is 15 minutes (900 seconds)
    if (delaySeconds <= 900) {
      return this.enqueueWithDelay(message, delaySeconds);
    }

    // For longer delays, use DynamoDB scheduler
    return this.scheduleJob(message, new Date(Date.now() + delaySeconds * 1000));
  }

  async enqueueAt(message: JobMessage, at: Date): Promise<EnqueueResult> {
    const delaySeconds = Math.floor((at.getTime() - Date.now()) / 1000);

    if (delaySeconds <= 0) {
      return this.enqueue(message);
    }

    if (delaySeconds <= 900) {
      return this.enqueueWithDelay(message, delaySeconds);
    }

    return this.scheduleJob(message, at);
  }

  private async scheduleJob(message: JobMessage, at: Date): Promise<EnqueueResult> {
    // Store in DynamoDB for EventBridge Scheduler to pick up
    const { DynamoDBClient, PutItemCommand } = await import('@aws-sdk/client-dynamodb');
    const ddb = new DynamoDBClient({ region: this.config.region });
    const jobId = message.jobId || generateJobId();

    await ddb.send(new PutItemCommand({
      TableName: this.config.schedulerTable,
      Item: {
        pk: { S: `SCHEDULED#${at.toISOString().slice(0, 16)}` }, // Partition by minute
        sk: { S: jobId },
        jobName: { S: message.jobName },
        payload: { S: JSON.stringify(message.payload) },
        queue: { S: message.queue || 'default' },
        scheduledAt: { S: at.toISOString() },
        ttl: { N: String(Math.floor(at.getTime() / 1000) + 86400) }, // TTL: scheduled + 1 day
      },
    }));

    return { messageId: jobId, jobId };
  }
}

interface SQSDriverConfig {
  /** AWS region */
  region: string;
  /** Queue URL mapping (queue name -> URL) */
  queues: Record<string, string>;
  /** Default queue name */
  defaultQueue?: string;
  /** Custom endpoint (for LocalStack) */
  endpoint?: string;
  /** DynamoDB table for scheduled jobs (required for delays > 15min) */
  schedulerTable?: string;
}
```

---

## Job Definition (Function-Based)

The function-based approach aligns with Glasswork's route-helper pattern:

### Core Types

```typescript
// types.ts
interface JobDefinition<TPayload> {
  /** Unique job name */
  name: string;
  /** Target queue (default: 'default') */
  queue?: string;
  /** Valibot schema for payload validation */
  schema?: BaseSchema<TPayload>;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Job handler function */
  handler: JobHandler<TPayload>;
}

interface JobContext {
  /** DI container for accessing services */
  services: ServicesProxy;
  /** Job metadata */
  jobId: string;
  attemptNumber: number;
  enqueuedAt: Date;
  /** Logger scoped to this job */
  logger: Logger;
}

type JobHandler<TPayload> = (
  payload: TPayload,
  context: JobContext
) => Promise<void>;

interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxAttempts?: number;
  /** Backoff strategy (default: exponential) */
  backoff?: 'exponential' | 'linear' | 'fixed';
  /** Initial delay between retries (default: 30s) */
  initialDelay?: Duration;
  /** Maximum delay cap (default: 1h) */
  maxDelay?: Duration;
  /** Jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
}

type Duration = string | number; // '5m', '30s', '1h' or seconds as number
```

### defineJob Function

```typescript
// define-job.ts
import type { BaseSchema, InferInput } from 'valibot';

/**
 * Define a background job with typed payload and handler
 *
 * @example
 * ```typescript
 * const sendWelcomeEmail = defineJob({
 *   name: 'send-welcome-email',
 *   queue: 'emails',
 *   schema: v.object({ userId: v.string() }),
 *   handler: async ({ userId }, { services, logger }) => {
 *     const user = await services.userService.findById(userId);
 *     await services.emailService.send('welcome', { to: user.email });
 *   },
 * });
 * ```
 */
export function defineJob<TSchema extends BaseSchema<unknown, unknown, unknown>>(
  config: {
    name: string;
    queue?: string;
    schema: TSchema;
    retry?: RetryConfig;
    handler: JobHandler<InferInput<TSchema>>;
  }
): JobDefinition<InferInput<TSchema>>;

export function defineJob<TPayload>(
  config: {
    name: string;
    queue?: string;
    retry?: RetryConfig;
    handler: JobHandler<TPayload>;
  }
): JobDefinition<TPayload>;

export function defineJob(config: any): JobDefinition<any> {
  return {
    name: config.name,
    queue: config.queue,
    schema: config.schema,
    retry: config.retry,
    handler: config.handler,
  };
}
```

### Job Definition Examples

```typescript
// jobs/send-welcome-email.job.ts
import { defineJob } from 'glasswork/jobs';
import * as v from 'valibot';

// With schema validation
export const sendWelcomeEmailJob = defineJob({
  name: 'send-welcome-email',
  queue: 'emails',
  schema: v.object({
    userId: v.string(),
  }),
  retry: {
    maxAttempts: 3,
    backoff: 'exponential',
    initialDelay: '30s',
  },
  handler: async ({ userId }, { services, logger }) => {
    logger.info({ userId }, 'Sending welcome email');

    const user = await services.userService.findById(userId);
    if (!user) {
      throw new PermanentJobError(`User not found: ${userId}`);
    }

    await services.emailService.send('welcome', {
      to: user.email,
      context: { name: user.name },
    });

    logger.info({ userId, email: user.email }, 'Welcome email sent');
  },
});
```

```typescript
// jobs/process-payment.job.ts
import { defineJob } from 'glasswork/jobs';
import * as v from 'valibot';

export const processPaymentJob = defineJob({
  name: 'process-payment',
  queue: 'payments',
  schema: v.object({
    orderId: v.string(),
    amount: v.number(),
    currency: v.string(),
  }),
  retry: {
    maxAttempts: 5,
    backoff: 'exponential',
    initialDelay: '1m',
    maxDelay: '30m',
  },
  handler: async ({ orderId, amount, currency }, { services, logger }) => {
    const result = await services.paymentService.charge({ orderId, amount, currency });

    if (result.status === 'rate_limited') {
      throw new TransientJobError('Payment provider rate limited', '5m');
    }

    if (result.status === 'failed') {
      throw new PermanentJobError(`Payment failed: ${result.reason}`);
    }

    await services.orderService.markPaid(orderId, result.transactionId);
  },
});
```

---

## Job Service

The JobService is the main interface for enqueuing jobs:

```typescript
// job-service.ts
import * as v from 'valibot';

class JobService {
  constructor(
    private driver: QueueDriver,
    private config: JobServiceConfig,
    private hooks?: JobServiceHooks,
  ) {}

  /**
   * Enqueue a job for immediate processing
   *
   * @example
   * ```typescript
   * await jobService.enqueue(sendWelcomeEmailJob, { userId: '123' });
   * ```
   */
  async enqueue<T>(
    job: JobDefinition<T>,
    payload: T
  ): Promise<EnqueueResult> {
    this.validatePayload(job, payload);

    const result = await this.driver.enqueue({
      jobName: job.name,
      payload,
      queue: job.queue || this.config.defaultQueue,
    });

    await this.hooks?.onEnqueued?.(job, payload, result);
    return result;
  }

  /**
   * Enqueue a job to run at a specific time
   *
   * @example
   * ```typescript
   * // Send reminder 24 hours before event
   * await jobService.enqueueAt(
   *   sendReminderJob,
   *   { eventId: '123' },
   *   new Date('2024-12-25T08:00:00Z')
   * );
   * ```
   */
  async enqueueAt<T>(
    job: JobDefinition<T>,
    payload: T,
    at: Date
  ): Promise<EnqueueResult> {
    this.validatePayload(job, payload);

    const result = await this.driver.enqueueAt({
      jobName: job.name,
      payload,
      queue: job.queue || this.config.defaultQueue,
    }, at);

    await this.hooks?.onEnqueued?.(job, payload, result);
    return result;
  }

  /**
   * Enqueue a job to run after a delay
   *
   * @example
   * ```typescript
   * // Send follow-up email in 3 days
   * await jobService.enqueueIn(sendFollowUpJob, { userId: '123' }, '3d');
   *
   * // Process with 5 minute delay
   * await jobService.enqueueIn(processOrderJob, { orderId: '456' }, '5m');
   * ```
   */
  async enqueueIn<T>(
    job: JobDefinition<T>,
    payload: T,
    delay: Duration
  ): Promise<EnqueueResult> {
    this.validatePayload(job, payload);

    const result = await this.driver.enqueueIn({
      jobName: job.name,
      payload,
      queue: job.queue || this.config.defaultQueue,
    }, delay);

    await this.hooks?.onEnqueued?.(job, payload, result);
    return result;
  }

  /**
   * Enqueue multiple jobs in a batch
   */
  async enqueueBatch<T>(
    jobs: Array<{ job: JobDefinition<T>; payload: T }>
  ): Promise<EnqueueResult[]> {
    // SQS supports batch of up to 10 messages
    const results: EnqueueResult[] = [];

    for (const { job, payload } of jobs) {
      results.push(await this.enqueue(job, payload));
    }

    return results;
  }

  private validatePayload<T>(job: JobDefinition<T>, payload: T): void {
    if (job.schema) {
      const result = v.safeParse(job.schema, payload);
      if (!result.success) {
        throw new InvalidJobPayloadError(job.name, result.issues);
      }
    }
  }
}

interface JobServiceConfig {
  defaultQueue: string;
}

interface JobServiceHooks {
  /** Called after a job is successfully enqueued */
  onEnqueued?: <T>(
    job: JobDefinition<T>,
    payload: T,
    result: EnqueueResult
  ) => Promise<void> | void;
}
```

---

## Worker Lambda

### Bootstrap Function

```typescript
// bootstrap-worker.ts
import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';

interface WorkerConfig {
  /** Module containing jobs and providers */
  module: ModuleConfig;

  /** Lifecycle hooks */
  hooks?: WorkerHooks;

  /** Queue driver configuration */
  driver: QueueDriver;
}

interface WorkerHooks {
  /** Called before job execution */
  onJobStart?: (job: JobExecution, context: JobContext) => Promise<void> | void;

  /** Called after successful job execution */
  onJobComplete?: (job: JobExecution, context: JobContext) => Promise<void> | void;

  /** Called when job fails (before retry) */
  onJobFailed?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;

  /** Called when job exhausts retries and goes to DLQ */
  onJobDeadLetter?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;
}

interface JobExecution {
  jobId: string;
  jobName: string;
  payload: unknown;
  attemptNumber: number;
  enqueuedAt: Date;
}

/**
 * Bootstrap a worker Lambda handler
 *
 * @example
 * ```typescript
 * // worker.ts
 * import { bootstrapWorker } from 'glasswork/jobs';
 * import { WorkerModule } from './modules/worker.module';
 *
 * export const handler = bootstrapWorker({
 *   module: WorkerModule,
 *   driver: new SQSDriver({ region: 'eu-west-1', queues: { default: process.env.JOB_QUEUE_URL! } }),
 *   hooks: {
 *     onJobComplete: async (job, context) => {
 *       context.logger.info({ jobId: job.jobId }, 'Job completed');
 *     },
 *     onJobFailed: async (job, context, error) => {
 *       // Send to error tracking
 *       await appsignal.sendError(error, { tags: { jobId: job.jobId, jobName: job.jobName } });
 *     },
 *   },
 * });
 * ```
 */
export function bootstrapWorker(config: WorkerConfig) {
  // Build container with providers and jobs
  const container = buildContainer(config.module);
  const registry = buildJobRegistry(config.module.jobs);

  return async (event: SQSEvent, lambdaContext: Context): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

    for (const record of event.Records) {
      try {
        await processRecord(record, { container, registry, config });
      } catch (error) {
        // Report partial failure for this message
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    // Return partial failures for SQS to retry
    return { batchItemFailures };
  };
}

async function processRecord(
  record: SQSRecord,
  { container, registry, config }: ProcessContext
): Promise<void> {
  const message = JSON.parse(record.body);
  const job = registry.getOrThrow(message.jobName);

  const jobExecution: JobExecution = {
    jobId: message.jobId,
    jobName: message.jobName,
    payload: message.payload,
    attemptNumber: parseInt(record.attributes.ApproximateReceiveCount, 10),
    enqueuedAt: new Date(message.enqueuedAt),
  };

  const scope = container.createScope();
  const services = scope.cradle;
  const logger = services.logger.child({ jobId: message.jobId, jobName: message.jobName });

  const context: JobContext = {
    services,
    jobId: message.jobId,
    attemptNumber: jobExecution.attemptNumber,
    enqueuedAt: jobExecution.enqueuedAt,
    logger,
  };

  try {
    await config.hooks?.onJobStart?.(jobExecution, context);

    // Validate payload if schema provided
    if (job.schema) {
      const result = v.safeParse(job.schema, message.payload);
      if (!result.success) {
        throw new InvalidJobPayloadError(job.name, result.issues);
      }
    }

    await job.handler(message.payload, context);

    await config.hooks?.onJobComplete?.(jobExecution, context);
  } catch (error) {
    await config.hooks?.onJobFailed?.(jobExecution, context, error as Error);

    // Check if it's a permanent error (don't retry)
    if (error instanceof PermanentJobError) {
      logger.error({ error }, 'Job permanently failed');
      await config.hooks?.onJobDeadLetter?.(jobExecution, context, error);
      return; // Don't rethrow - message will be deleted
    }

    // Rethrow to trigger retry via SQS
    throw error;
  } finally {
    await scope.dispose();
  }
}
```

### Worker Module Definition

```typescript
// modules/worker.module.ts
import { defineModule } from 'glasswork';

// Import jobs
import { sendWelcomeEmailJob } from '../jobs/send-welcome-email.job';
import { processPaymentJob } from '../jobs/process-payment.job';
import { dailyCleanupJob } from '../jobs/daily-cleanup.job';

// Import services (same as HTTP Lambda)
import { UserService } from '../services/user.service';
import { EmailService } from '../services/email.service';
import { PaymentService } from '../services/payment.service';
import { CleanupService } from '../services/cleanup.service';

export const WorkerModule = defineModule({
  name: 'worker',
  providers: [
    // Shared services - same business logic as HTTP Lambda
    UserService,
    EmailService,
    PaymentService,
    CleanupService,
  ],
  jobs: [
    // All jobs must be explicitly registered
    sendWelcomeEmailJob,
    processPaymentJob,
    dailyCleanupJob,
  ],
});
```

---

## Periodic Jobs

### Static Schedules (EventBridge)

For jobs that run on a fixed schedule, use AWS EventBridge with infrastructure-as-code:

```typescript
// jobs/daily-cleanup.job.ts
import { definePeriodicJob } from 'glasswork/jobs';

/**
 * Periodic job - schedule defined in SAM template, not in code
 */
export const dailyCleanupJob = definePeriodicJob({
  name: 'daily-cleanup',
  handler: async ({ services, logger }) => {
    logger.info('Starting daily cleanup');

    const deleted = await services.cleanupService.removeStaleData();

    logger.info({ deletedCount: deleted }, 'Daily cleanup completed');
  },
});
```

```yaml
# template.yaml - EventBridge schedule
Resources:
  DailyCleanupSchedule:
    Type: AWS::Events::Rule
    Properties:
      Name: ${AWS::StackName}-daily-cleanup
      Description: Triggers daily cleanup job at 2 AM UTC
      ScheduleExpression: 'cron(0 2 * * ? *)'
      State: ENABLED
      Targets:
        - Id: WorkerLambda
          Arn: !GetAtt WorkerFunction.Arn
          Input: '{"source": "scheduler", "jobName": "daily-cleanup"}'

  DailyCleanupPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref WorkerFunction
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt DailyCleanupSchedule.Arn
```

### Dynamic Schedules (DynamoDB + EventBridge Scheduler)

For jobs scheduled dynamically via API (like `enqueueAt()`), use DynamoDB as a schedule store with EventBridge Scheduler:

```typescript
// The scheduler Lambda runs every minute and enqueues due jobs
export const schedulerHandler = async () => {
  const now = new Date();
  const currentMinute = now.toISOString().slice(0, 16);

  // Query DynamoDB for jobs scheduled in this minute
  const dueJobs = await queryScheduledJobs(currentMinute);

  for (const job of dueJobs) {
    // Enqueue to SQS for immediate processing
    await sqsDriver.enqueue({
      jobName: job.jobName,
      payload: JSON.parse(job.payload),
      queue: job.queue,
      jobId: job.sk, // Use the original job ID
    });

    // Delete from scheduler table
    await deleteScheduledJob(job.pk, job.sk);
  }
};
```

```yaml
# template.yaml - Scheduler Lambda (runs every minute)
Resources:
  SchedulerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: dist/scheduler.handler
      Timeout: 60
      Events:
        ScheduleEvent:
          Type: Schedule
          Properties:
            Schedule: rate(1 minute)

  ScheduledJobsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: ${AWS::StackName}-scheduled-jobs
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
        - AttributeName: sk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
        - AttributeName: sk
          KeyType: RANGE
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true
```

---

## Error Handling & Retries

### Error Types

```typescript
/**
 * Throw for permanent failures that should not be retried.
 * The job will be acknowledged (deleted from queue).
 *
 * @example
 * ```typescript
 * if (!user) {
 *   throw new PermanentJobError(`User ${userId} not found`);
 * }
 * ```
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/**
 * Throw for transient failures that should be retried.
 * Optionally specify a retry delay.
 *
 * @example
 * ```typescript
 * if (response.status === 429) {
 *   const retryAfter = response.headers['retry-after'];
 *   throw new TransientJobError('Rate limited', retryAfter);
 * }
 * ```
 */
export class TransientJobError extends Error {
  constructor(message: string, public retryAfter?: Duration) {
    super(message);
    this.name = 'TransientJobError';
  }
}

/**
 * Throw when job payload validation fails.
 */
export class InvalidJobPayloadError extends Error {
  constructor(jobName: string, public issues: unknown[]) {
    super(`Invalid payload for job "${jobName}"`);
    this.name = 'InvalidJobPayloadError';
  }
}

/**
 * Thrown when payload exceeds SQS 256KB limit.
 */
export class PayloadTooLargeError extends Error {
  constructor(actualSize: number, maxSize: number) {
    super(
      `Job payload size (${Math.round(actualSize / 1024)}KB) exceeds SQS limit (${Math.round(maxSize / 1024)}KB). ` +
      `Consider storing large data externally and passing a reference.`
    );
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Thrown when attempting to enqueue a duplicate job (uniqueness constraint).
 */
export class DuplicateJobError extends Error {
  constructor(jobName: string, dedupeKey: string) {
    super(`Duplicate job rejected: "${jobName}" with key "${dedupeKey}"`);
    this.name = 'DuplicateJobError';
  }
}
```

### Retry Strategy

Following [Sidekiq best practices](https://github.com/sidekiq/sidekiq/wiki/Best-Practices):

```typescript
interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxAttempts: number;

  /** Backoff strategy (default: exponential) */
  backoff: 'exponential' | 'linear' | 'fixed';

  /** Initial delay (default: 30s) */
  initialDelay: Duration;

  /** Maximum delay cap (default: 1h) */
  maxDelay?: Duration;

  /** Jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
}

// Exponential backoff with jitter (default)
// Attempt 1: 30s ± 15%
// Attempt 2: 60s ± 15%
// Attempt 3: 120s ± 15%
// ... capped at maxDelay
```

### Dead Letter Queue

Jobs that exhaust retries go to the DLQ:

```yaml
# template.yaml
Resources:
  JobQueue:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 300
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt JobDLQ.Arn
        maxReceiveCount: 3  # Goes to DLQ after 3 attempts

  JobDLQ:
    Type: AWS::SQS::Queue
    Properties:
      MessageRetentionPeriod: 1209600  # 14 days
```

---

## Lifecycle Hooks

Following the email module's hook pattern:

```typescript
interface WorkerHooks {
  /**
   * Called before job execution starts.
   * Use for logging, tracking, or setup.
   */
  onJobStart?: (job: JobExecution, context: JobContext) => Promise<void> | void;

  /**
   * Called after successful job execution.
   * Use for logging, metrics, or updating job status in database.
   *
   * @example
   * ```typescript
   * onJobComplete: async (job, context) => {
   *   await prisma.jobExecution.update({
   *     where: { id: job.jobId },
   *     data: { status: 'COMPLETED', completedAt: new Date() },
   *   });
   * }
   * ```
   */
  onJobComplete?: (job: JobExecution, context: JobContext) => Promise<void> | void;

  /**
   * Called when job fails (before retry decision).
   * Use for error tracking, alerting, or logging.
   *
   * @example
   * ```typescript
   * onJobFailed: async (job, context, error) => {
   *   await appsignal.sendError(error, {
   *     tags: { jobId: job.jobId, jobName: job.jobName },
   *   });
   * }
   * ```
   */
  onJobFailed?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;

  /**
   * Called when job exhausts retries and goes to DLQ.
   * Use for alerting operations team or escalation.
   */
  onJobDeadLetter?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;
}
```

---

## Testing

### Mock Queue Driver

```typescript
import { MockQueueDriver } from 'glasswork/jobs/testing';

describe('OrderService', () => {
  let mockDriver: MockQueueDriver;
  let jobService: JobService;

  beforeEach(() => {
    mockDriver = new MockQueueDriver();
    jobService = new JobService(mockDriver, { defaultQueue: 'default' });
  });

  it('should enqueue welcome email after user signup', async () => {
    await orderService.createUser({ email: 'test@example.com' });

    expect(mockDriver.enqueuedJobs).toHaveLength(1);
    expect(mockDriver.enqueuedJobs[0]).toMatchObject({
      jobName: 'send-welcome-email',
      payload: { userId: expect.any(String) },
    });
  });

  it('should schedule reminder 24 hours before event', async () => {
    const eventDate = new Date('2024-12-25T10:00:00Z');
    await eventService.createEvent({ date: eventDate });

    expect(mockDriver.scheduledJobs).toHaveLength(1);
    expect(mockDriver.scheduledJobs[0]).toMatchObject({
      jobName: 'send-reminder',
      scheduledAt: new Date('2024-12-24T10:00:00Z'),
    });
  });
});
```

### Job Handler Unit Testing

```typescript
import { sendWelcomeEmailJob } from './send-welcome-email.job';

describe('sendWelcomeEmailJob', () => {
  it('should send welcome email to user', async () => {
    const mockServices = {
      userService: {
        findById: vi.fn().mockResolvedValue({
          id: '123',
          email: 'test@example.com',
          name: 'Test User',
        }),
      },
      emailService: {
        send: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
      },
    };

    const mockContext = {
      services: mockServices,
      jobId: 'job-123',
      attemptNumber: 1,
      enqueuedAt: new Date(),
      logger: { info: vi.fn(), error: vi.fn() },
    };

    await sendWelcomeEmailJob.handler({ userId: '123' }, mockContext);

    expect(mockServices.emailService.send).toHaveBeenCalledWith('welcome', {
      to: 'test@example.com',
      context: { name: 'Test User' },
    });
  });

  it('should throw PermanentJobError when user not found', async () => {
    const mockServices = {
      userService: { findById: vi.fn().mockResolvedValue(null) },
      emailService: { send: vi.fn() },
    };

    await expect(
      sendWelcomeEmailJob.handler({ userId: '123' }, { services: mockServices, ...mockContext })
    ).rejects.toThrow(PermanentJobError);

    expect(mockServices.emailService.send).not.toHaveBeenCalled();
  });
});
```

### Integration Testing with LocalStack

```typescript
import { SQSDriver } from 'glasswork/jobs';

describe('SQS Integration', () => {
  const driver = new SQSDriver({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566', // LocalStack
    queues: { default: 'http://localhost:4566/000000000000/test-queue' },
  });

  it('should enqueue and receive job', async () => {
    await driver.enqueue({
      jobName: 'test-job',
      payload: { foo: 'bar' },
    });

    const jobs = await driver.receive({ maxMessages: 1 });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobName).toBe('test-job');
    expect(jobs[0].payload).toEqual({ foo: 'bar' });
  });
});
```

---

## Dependencies

### Required (Peer Dependencies)

```json
{
  "peerDependencies": {
    "@aws-sdk/client-sqs": "^3.0.0"
  }
}
```

### Optional (For Long Delays)

```json
{
  "peerDependencies": {
    "@aws-sdk/client-dynamodb": "^3.0.0"
  }
}
```

### Development Only

```json
{
  "devDependencies": {
    "@types/aws-lambda": "^8.10.0"
  }
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure
**Goal**: Basic job enqueuing and processing with SQS

**Deliverables**:
1. Queue driver interface (`QueueDriver`)
2. SQS driver implementation (immediate enqueue only)
3. `defineJob()` function with type inference
4. Job registry
5. `JobService` with `enqueue()`
6. Payload size validation (256KB limit)
7. Mock driver for testing
8. Basic error types (`PermanentJobError`, `PayloadTooLargeError`)
9. Unit tests

### Phase 2: Worker Lambda
**Goal**: Job processing in separate Lambda

**Deliverables**:
1. `bootstrapWorker()` function
2. SQS event handler with batch processing
3. Job dispatcher (routes to correct handler)
4. Basic lifecycle hooks (`onJobStart`, `onJobComplete`, `onJobFailed`)
5. Integration with Awilix DI (scoped containers)
6. Partial batch failure support (`ReportBatchItemFailures`)

### Phase 3: Delayed Jobs, Retries & Uniqueness
**Goal**: Full delay support, robust error handling, and deduplication

**Deliverables**:
1. `enqueueIn()` and `enqueueAt()` for delays ≤ 15min (SQS native)
2. DynamoDB scheduler for delays > 15min
3. Scheduler Lambda (runs every minute)
4. Configurable retry strategies
5. Exponential backoff with jitter
6. `TransientJobError` with custom retry timing
7. `onJobDeadLetter` hook
8. Job uniqueness via FIFO queue deduplication
9. `DuplicateJobError` for rejected duplicates

### Phase 4: Periodic Jobs
**Goal**: Scheduled/recurring jobs via EventBridge

**Deliverables**:
1. `definePeriodicJob()` function
2. EventBridge event handling in worker
3. SAM template examples for schedules
4. Documentation for infrastructure setup

### Phase 5: Observability & DX
**Goal**: Production-ready monitoring

**Deliverables**:
1. Structured logging for all lifecycle events
2. CloudWatch metrics integration
3. AppSignal error tracking examples
4. Batch enqueue (`enqueueBatch()`)
5. Complete documentation with examples

### Phase 6: Admin UI (Future)
**Goal**: Visual monitoring and management

**Deliverables**:
1. React-based dashboard (separate package)
2. Job queue overview
3. Failed job inspection
4. DLQ management (retry, delete)
5. Job history and metrics

---

## SAM Template Example

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Parameters:
  Stage:
    Type: String
    Default: dev

Resources:
  #############################################
  # Queues
  #############################################

  JobQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs
      VisibilityTimeout: 300  # 5 minutes - should be > Lambda timeout
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt JobDLQ.Arn
        maxReceiveCount: 3

  JobDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-jobs-dlq
      MessageRetentionPeriod: 1209600  # 14 days

  EmailQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-emails
      VisibilityTimeout: 300
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt EmailDLQ.Arn
        maxReceiveCount: 3

  EmailDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub ${AWS::StackName}-emails-dlq
      MessageRetentionPeriod: 1209600

  #############################################
  # DynamoDB for Scheduled Jobs
  #############################################

  ScheduledJobsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub ${AWS::StackName}-scheduled-jobs
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
        - AttributeName: sk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
        - AttributeName: sk
          KeyType: RANGE
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true

  #############################################
  # Worker Lambda
  #############################################

  WorkerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: dist/worker.handler
      Runtime: nodejs20.x
      Timeout: 300
      MemorySize: 512
      ReservedConcurrentExecutions: 10  # Control concurrency here
      Environment:
        Variables:
          STAGE: !Ref Stage
          JOB_QUEUE_URL: !Ref JobQueue
          EMAIL_QUEUE_URL: !Ref EmailQueue
      Policies:
        - SQSPollerPolicy:
            QueueName: !GetAtt JobQueue.QueueName
        - SQSPollerPolicy:
            QueueName: !GetAtt EmailQueue.QueueName
      Events:
        JobQueueEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt JobQueue.Arn
            BatchSize: 10
            FunctionResponseTypes:
              - ReportBatchItemFailures
        EmailQueueEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt EmailQueue.Arn
            BatchSize: 5
            FunctionResponseTypes:
              - ReportBatchItemFailures

  #############################################
  # Scheduler Lambda (for long delays)
  #############################################

  SchedulerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: dist/scheduler.handler
      Runtime: nodejs20.x
      Timeout: 60
      MemorySize: 256
      Environment:
        Variables:
          SCHEDULED_JOBS_TABLE: !Ref ScheduledJobsTable
          JOB_QUEUE_URL: !Ref JobQueue
          EMAIL_QUEUE_URL: !Ref EmailQueue
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ScheduledJobsTable
        - SQSSendMessagePolicy:
            QueueName: !GetAtt JobQueue.QueueName
        - SQSSendMessagePolicy:
            QueueName: !GetAtt EmailQueue.QueueName
      Events:
        ScheduleEvent:
          Type: Schedule
          Properties:
            Schedule: rate(1 minute)

  #############################################
  # Periodic Jobs (EventBridge)
  #############################################

  DailyCleanupSchedule:
    Type: AWS::Events::Rule
    Properties:
      Name: !Sub ${AWS::StackName}-daily-cleanup
      Description: Run daily cleanup at 2 AM UTC
      ScheduleExpression: 'cron(0 2 * * ? *)'
      State: ENABLED
      Targets:
        - Id: WorkerLambda
          Arn: !GetAtt WorkerFunction.Arn
          Input: '{"source": "scheduler", "jobName": "daily-cleanup"}'

  DailyCleanupPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref WorkerFunction
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt DailyCleanupSchedule.Arn

Outputs:
  JobQueueUrl:
    Value: !Ref JobQueue
  EmailQueueUrl:
    Value: !Ref EmailQueue
  WorkerFunctionArn:
    Value: !GetAtt WorkerFunction.Arn
```

---

## Success Criteria

A successful jobs solution for Glasswork will:

1. ✅ Provide a Sidekiq-like DX (`enqueue`, `enqueueAt`, `enqueueIn`)
2. ✅ Use function-based job definitions (aligns with route helpers)
3. ✅ Keep HTTP Lambda lightweight (queue, don't process)
4. ✅ Work out of box with AWS SQS
5. ✅ Support delays > 15 minutes via DynamoDB scheduler
6. ✅ Support custom queue drivers (Redis, NATS in future)
7. ✅ Provide robust retry handling with configurable strategies
8. ✅ Enable periodic jobs via EventBridge
9. ✅ Provide lifecycle hooks for tracking and monitoring
10. ✅ Validate payload size and provide clear errors
11. ✅ Support job uniqueness/deduplication via FIFO queues
12. ✅ Have comprehensive test utilities
13. ✅ Follow Glasswork's transparency principle
14. ✅ Integrate with Awilix DI system
15. ✅ Have clear documentation and examples

---

## Additional Design Decisions

### Payload Size Validation

SQS has a maximum message size of 256KB. Rather than adding S3 complexity, we:
- **Document the limitation** clearly
- **Validate payload size on enqueue** and throw a descriptive error

```typescript
class JobService {
  private readonly MAX_PAYLOAD_SIZE = 256 * 1024; // 256KB

  async enqueue<T>(job: JobDefinition<T>, payload: T): Promise<EnqueueResult> {
    this.validatePayload(job, payload);
    this.validatePayloadSize(payload);
    // ...
  }

  private validatePayloadSize(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    const sizeBytes = new TextEncoder().encode(serialized).length;

    if (sizeBytes > this.MAX_PAYLOAD_SIZE) {
      throw new PayloadTooLargeError(sizeBytes, this.MAX_PAYLOAD_SIZE);
    }
  }
}

export class PayloadTooLargeError extends Error {
  constructor(actualSize: number, maxSize: number) {
    super(
      `Job payload size (${Math.round(actualSize / 1024)}KB) exceeds SQS limit (${Math.round(maxSize / 1024)}KB). ` +
      `Consider storing large data externally and passing a reference.`
    );
    this.name = 'PayloadTooLargeError';
  }
}
```

### Job Uniqueness (Deduplication)

Support optional job uniqueness to prevent duplicate enqueuing. Two approaches:

**Option A: SQS FIFO Queues (Simple)**

```typescript
const processOrderJob = defineJob({
  name: 'process-order',
  queue: 'orders.fifo',  // FIFO queue
  unique: {
    // Deduplication ID derived from payload
    key: (payload) => payload.orderId,
    // Deduplication window (max 5 minutes for SQS FIFO)
    window: '5m',
  },
  handler: async ({ orderId }, { services }) => {
    await services.orderService.process(orderId);
  },
});
```

```yaml
# FIFO Queue in SAM template
OrderQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub ${AWS::StackName}-orders.fifo
    FifoQueue: true
    ContentBasedDeduplication: false  # We provide explicit deduplication ID
```

**Option B: DynamoDB-Based (Longer Windows)**

For deduplication windows longer than 5 minutes:

```typescript
const sendWelcomeEmail = defineJob({
  name: 'send-welcome-email',
  unique: {
    key: (payload) => `welcome-${payload.userId}`,
    window: '24h',  // Don't send duplicate welcomes within 24 hours
  },
  handler: async ({ userId }, { services }) => {
    // ...
  },
});
```

```typescript
// Implementation uses DynamoDB with TTL
async enqueue<T>(job: JobDefinition<T>, payload: T): Promise<EnqueueResult> {
  if (job.unique) {
    const dedupeKey = job.unique.key(payload);
    const isDuplicate = await this.checkDuplicate(job.name, dedupeKey, job.unique.window);

    if (isDuplicate) {
      throw new DuplicateJobError(job.name, dedupeKey);
    }

    await this.recordJob(job.name, dedupeKey, job.unique.window);
  }

  return this.driver.enqueue({ jobName: job.name, payload, queue: job.queue });
}
```

**Decision**: Implement FIFO-based deduplication first (Phase 3), add DynamoDB-based for longer windows later if needed.

### Job Priorities

**Decision**: Out of scope for the framework. Users can set up multiple queues with different Lambda reserved concurrency settings to achieve priority handling.

```typescript
// Example: User-managed priority queues
const criticalJob = defineJob({
  name: 'critical-alert',
  queue: 'high-priority',  // User creates this queue with higher concurrency
  handler: async (payload, { services }) => { /* ... */ },
});

const lowPriorityJob = defineJob({
  name: 'generate-report',
  queue: 'low-priority',  // User creates this queue with lower concurrency
  handler: async (payload, { services }) => { /* ... */ },
});
```

Document this pattern in the guides.

---

## Next Steps

1. **Technical Spike**: Validate SQS Lambda trigger patterns
   - Test batch processing with partial failures (`ReportBatchItemFailures`)
   - Verify Awilix scoped containers work in worker
   - Test DynamoDB scheduler for long delays
2. **Phase 1**: Build core infrastructure
3. **Iterate**: Get feedback and refine API
4. **Document**: Write guides alongside implementation
