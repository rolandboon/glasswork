---
description: Enqueueing jobs immediately, with delays, or at specific times using the JobService, plus cron-based scheduling with EventBridge.
---

# Dispatching & Scheduling

The `JobService` provides methods for enqueueing jobs immediately, with delays, or at specific times.

## Immediate Execution

Run a job as soon as the worker picks it up:

```typescript
await jobService.enqueue(processOrderJob, { orderId: '123' });
```

## Delayed Execution

Run a job after a specific duration:

```typescript
// Run in 10 minutes
await jobService.enqueueIn(sendReminderJob, { eventId: '456' }, '10m');

// Run in 3 days
await jobService.enqueueIn(sendFollowUpJob, { userId: '123' }, '3d');
```

**Supported units:** `s` (seconds), `m` (minutes), `h` (hours), `d` (days)

### How Delays Work

| Delay Duration | Implementation |
|----------------|----------------|
| ≤ 15 minutes | SQS native `DelaySeconds` |
| > 15 minutes | AWS EventBridge Scheduler |

:::: tip Long Delays Use EventBridge Scheduler
For delays exceeding SQS's 15-minute limit, Glasswork automatically creates a one-off EventBridge Scheduler schedule. The schedule delivers the message to SQS at the specified time, then auto-deletes. This requires the `scheduler` config in your SQS driver.
::::

### Configuring Long Delays

To enable delays longer than 15 minutes, configure the scheduler in your queue driver:

```typescript
new SQSQueueDriver({
  region: config.get('awsRegion'),
  queues: {
    default: config.get('jobQueueUrl'),
  },
  scheduler: {
    region: config.get('awsRegion'),
    roleArn: config.get('schedulerRoleArn'),
  },
});
```

See [AWS Setup](./aws-setup) for the required IAM role configuration.

### Custom Drivers

Custom drivers must implement at least one of `enqueueIn` or `enqueueAt` to support delayed jobs. `JobService` converts between the two when only one is available and throws a clear error when neither is implemented.

## Scheduled Execution

Run a job at a specific date and time:

```typescript
const launchDate = new Date('2025-01-01T00:00:00Z');
await jobService.enqueueAt(launchProductJob, { productId: 'p1' }, launchDate);
```

Like `enqueueIn`, this uses SQS for times within 15 minutes, and EventBridge Scheduler for longer durations.

## Batch Dispatching

Enqueue multiple jobs efficiently:

```typescript
const jobs = users.map(user => ({
  job: sendNewsletterJob,
  payload: { userId: user.id, issueId: 'dec-2024' },
}));

await jobService.enqueueBatch(jobs);
```

Jobs are enqueued in parallel for better performance.

## Periodic Jobs (Cron)

Periodic jobs run on a schedule. They're defined in code but triggered by AWS EventBridge.

### 1. Define the Job

```typescript
import { definePeriodicJob } from 'glasswork/jobs';

export const dailyReportJob = definePeriodicJob({
  name: 'daily-report',
  handler: async (_payload, { services, logger }) => {
    logger.info('Generating daily report');
    await services.reportService.generateDaily();
  },
});
```

### 2. Register in a Module

```typescript
export const ReportsModule = defineModule({
  name: 'reports',
  providers: [ReportService],
  jobs: [dailyReportJob],
});
```

### 3. Configure the Schedule

Add an EventBridge Scheduler schedule in your CDK stack constructor, using the
existing `worker` Lambda:

```typescript
import {
  Schedule,
  ScheduleExpression,
  ScheduleTargetInput,
  TimeWindow,
} from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';

new Schedule(this, 'DailyReport', {
  schedule: ScheduleExpression.cron({ minute: '0', hour: '8' }), // 08:00 UTC
  timeWindow: TimeWindow.off(),
  target: new LambdaInvoke(worker, {
    input: ScheduleTargetInput.fromObject({ jobName: 'daily-report', payload: {} }),
  }),
});
```

CDK creates the Scheduler execution role and grants permission to invoke the
worker. The worker receives the event directly and executes the matching job.
Scheduler delivery retries cover invocation, not job completion; use an
`SqsSendMessage` target if the periodic job needs SQS retries and redrive.
See [AWS Setup](./aws-setup#periodic-jobs-cron).

## Complete Example

Here's a minimal end-to-end example:

```typescript
// 1. Define the job
export const sendPingJob = defineJob({
  name: 'send-ping',
  schema: v.object({ userId: v.string() }),
  handler: async ({ userId }, { services }) => {
    await services.notificationService.ping(userId);
  },
});

// 2. Enqueue from a route handler
router.post('/ping/:userId', ...route({
  handler: async ({ params }) => {
    await jobService.enqueue(sendPingJob, { userId: params.userId });
    return { queued: true };
  },
}));
```

## Learn More

- [AWS EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)
- [SQS Developer Guide](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
