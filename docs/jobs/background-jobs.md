---
title: Background Jobs
---

# Background Jobs

Glasswork ships a first-class jobs module for async work using AWS SQS by default. It follows the same transparency principles as the rest of the framework: plain functions, typed payloads, and minimal abstraction over AWS primitives.

## Capabilities

- Function-based jobs via `defineJob` (no decorators)
- Typed payload validation with Valibot schemas
- Immediate, delayed, and scheduled enqueueing
- FIFO-friendly deduplication (job-level unique keys)
- Worker bootstrap for SQS Lambda with lifecycle hooks
- Periodic jobs (EventBridge) and long delays via DynamoDB scheduler
- Mock driver and utilities for testing

## Quick start

### 1) Define a job

```typescript
import * as v from 'valibot';
import { defineJob, PermanentJobError } from 'glasswork/jobs';

export const sendWelcomeEmail = defineJob({
  name: 'send-welcome-email',
  queue: 'emails',
  schema: v.object({ userId: v.string() }),
  unique: { key: ({ userId }) => userId }, // FIFO dedupe
  handler: async ({ userId }, { services, logger }) => {
    const user = await services.userService.findById(userId);
    if (!user) throw new PermanentJobError(`User not found: ${userId}`);
    await services.emailService.send('welcome', { to: user.email });
    logger?.info({ userId }, 'Welcome email sent');
  },
});
```

### 2) Enqueue from your HTTP Lambda

```typescript
import { JobService, SQSQueueDriver } from 'glasswork/jobs';
import { sendWelcomeEmail } from './jobs/send-welcome-email.job';

const jobService = new JobService(
  new SQSQueueDriver({
    region: process.env.AWS_REGION!,
    queues: { default: process.env.JOB_QUEUE_URL! },
    schedulerTable: process.env.SCHEDULED_JOBS_TABLE, // required for >15m delays
  }),
  { defaultQueue: 'default' }
);

await jobService.enqueue(sendWelcomeEmail, { userId: '123' });
await jobService.enqueueIn(sendWelcomeEmail, { userId: '123' }, '10m');
await jobService.enqueueAt(sendWelcomeEmail, { userId: '123' }, new Date(Date.now() + 3600_000));
```

### 3) Register jobs on a module

```typescript
import { defineModule } from 'glasswork';
import { sendWelcomeEmail } from './jobs/send-welcome-email.job';

export const WorkerModule = defineModule({
  name: 'worker',
  providers: [UserService, EmailService],
  jobs: [sendWelcomeEmail], // collected by the worker bootstrap
});
```

### 4) Worker Lambda handler

```typescript
// worker.ts
import { bootstrapWorker, SQSQueueDriver } from 'glasswork/jobs';
import { WorkerModule } from './worker.module';

export const handler = bootstrapWorker({
  module: WorkerModule,
  driver: new SQSQueueDriver({
    region: process.env.AWS_REGION!,
    queues: { default: process.env.JOB_QUEUE_URL! },
    schedulerTable: process.env.SCHEDULED_JOBS_TABLE,
  }),
  hooks: {
    onJobStart: (job, ctx) => ctx.logger?.info({ jobId: job.jobId }, 'Starting job'),
    onJobComplete: (job, ctx) => ctx.logger?.info({ jobId: job.jobId }, 'Job complete'),
    onJobFailed: (job, ctx, err) => ctx.logger?.error({ err, job }, 'Job failed'),
    onJobDeadLetter: (job, ctx, err) => ctx.logger?.error({ err, job }, 'Sent to DLQ'),
  },
});
```

## Delays & scheduling

- **≤ 15 minutes**: SQS native delay is used automatically.
- **> 15 minutes**: Provide `schedulerTable` to the `SQSQueueDriver`; long delays are stored in DynamoDB and dispatched by the scheduler handler.

Create the scheduler Lambda to run every minute (e.g., EventBridge Schedule):

```typescript
import { createSchedulerHandler, SQSQueueDriver } from 'glasswork/jobs';

export const handler = createSchedulerHandler({
  tableName: process.env.SCHEDULED_JOBS_TABLE!,
  region: process.env.AWS_REGION!,
  driver: new SQSQueueDriver({
    region: process.env.AWS_REGION!,
    queues: { default: process.env.JOB_QUEUE_URL! },
  }),
});
```

## Periodic jobs (EventBridge)

Use `definePeriodicJob` for jobs triggered by EventBridge rules:

```typescript
import { definePeriodicJob } from 'glasswork/jobs';

export const dailyCleanup = definePeriodicJob({
  name: 'daily-cleanup',
  handler: async (_payload, { services, logger }) => {
    const deleted = await services.cleanupService.removeStaleData();
    logger?.info({ deleted }, 'Daily cleanup done');
  },
});
```

Add a rule in your IaC (SAM/CloudFormation/Terraform) to invoke the worker with `{ jobName: "daily-cleanup" }`.

## Errors & retries

- `PermanentJobError`: mark job as non-retriable; worker calls `onJobDeadLetter` and does not rethrow.
- `TransientJobError`: signals a retriable failure; job is re-queued by SQS.
- `InvalidJobPayloadError`: schema validation failed; treated as permanent.
- `PayloadTooLargeError`: payload exceeded 256KB limit.
- `DuplicateJobError`: uniqueness guard rejected the enqueue.

## Testing

Use the in-memory driver for fast, deterministic tests:

```typescript
import { JobService, MockQueueDriver, defineJob } from 'glasswork/jobs';

const driver = new MockQueueDriver();
const jobService = new JobService(driver);

const job = defineJob({ name: 'ping', handler: () => {} });
await jobService.enqueue(job, { ok: true });

expect(driver.enqueued[0].message.jobName).toBe('ping');
```

Worker tests can call `bootstrapWorker` directly with a constructed SQS event (see `test/jobs/worker.spec.ts`).

## When to choose custom drivers

The `QueueDriver` interface mirrors the email transport pattern. You can implement Redis/NATS/etc. by providing `enqueue`, `enqueueIn`, and `enqueueAt` (plus receive/ack/nack when you build a custom worker loop). Register your driver with `JobService` or the scheduler in place of `SQSQueueDriver`.
