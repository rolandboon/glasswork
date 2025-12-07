# Dispatching & Scheduling

The `JobService` is your primary interface for dispatching jobs. It supports immediate execution, delays, and scheduling.

:::: tip Long delays are self-rescheduled
Delays longer than 15 minutes are automatically split into 15-minute slices. The worker re-enqueues the job until the target time is reached, so you only pay for a handful of Lambda invocations (e.g., 60 minutes = 4 invocations). Make sure the same queue driver is provided to your worker so it can re-enqueue.
::::

## Prerequisite: Job configuration

Centralize queue settings through the config service (see [Environment Config](/configuration/environment-config)). The snippets below import `jobConfig`:

```typescript
// src/config/job-config.ts
import { createConfig, envProvider } from 'glasswork';
import { object, optional, string } from 'valibot';

export const jobConfig = await createConfig({
  schema: object({
    awsRegion: string(),
    jobQueueUrl: string(),
    scheduledJobsTable: optional(string()),
  }),
  providers: [envProvider()],
});
```

## Immediate Execution

To run a job as soon as possible:

```typescript
await jobService.enqueue(sendWelcomeEmail, { userId: '123' });
```

## Delayed Execution

To run a job after a specific duration.

```typescript
// Run in 10 minutes
await jobService.enqueueIn(sendReminder, { eventId: '456' }, '10m');

// Run in 3 days
await jobService.enqueueIn(sendFollowUp, { userId: '123' }, '3d');
```

Supported units: `s` (seconds), `m` (minutes), `h` (hours), `d` (days).

### How Delays Work

- **Short Delays (≤ 15 minutes)**: Glasswork uses SQS native `DelaySeconds`. This is precise and efficient.
- **Long Delays (> 15 minutes)**: SQS has a hard limit of 15 minutes. Glasswork embeds the target run time in the message and the worker re-enqueues the job in 15-minute slices until it is due. No DynamoDB table or per-minute scheduler is required.

If you prefer the previous DynamoDB-based scheduler (for centralized control or auditing), opt into it explicitly:

```typescript
new SQSQueueDriver({
  // ...
  longDelayStrategy: 'dynamodb',
  schedulerTable: jobConfig.get('scheduledJobsTable'),
})
```

## Scheduled Execution

To run a job at a specific date and time.

```typescript
const launchDate = new Date('2025-01-01T00:00:00Z');
await jobService.enqueueAt(launchProduct, { productId: 'p1' }, launchDate);
```

Like `enqueueIn`, this uses SQS native delays if the target time is within 15 minutes. For longer targets it self-reschedules in 15-minute slices by default (or uses the DynamoDB strategy if enabled).

## Batch Dispatching

To enqueue multiple jobs efficiently (e.g., sending emails to a list of users).

```typescript
const jobs = users.map(user => ({
  job: sendNewsletter,
  payload: { userId: user.id, issueId: 'dec-2024' }
}));

// Enqueues in parallel for better performance
await jobService.enqueueBatch(jobs);
```

## Periodic Jobs (Cron)

Periodic jobs are defined in code but triggered by infrastructure (EventBridge Scheduler).

1. **Define the Job**:

    ```typescript
    export const dailyReport = definePeriodicJob({
      name: 'daily-report',
      handler: async () => { /* ... */ }
    });
    ```

2. **Configure Infrastructure**:
    Add an EventBridge Schedule in your IaC (e.g., SAM template) that targets your Worker Lambda.

    ```yaml
    DailyReportSchedule:
      Type: AWS::Scheduler::Schedule
      Properties:
        ScheduleExpression: "cron(0 8 * * ? *)" # 8 AM daily
        Target:
          Arn: !GetAtt WorkerFunction.Arn
          RoleArn: !GetAtt SchedulerRole.Arn
          Input: '{"jobName": "daily-report", "payload": {}}'
    ```

## The Scheduler Handler (optional)

If you opt into the DynamoDB strategy (`longDelayStrategy: 'dynamodb'`), deploy a Scheduler Lambda that runs every minute to check DynamoDB.

```typescript
// src/scheduler.ts
import { createSchedulerHandler, SQSQueueDriver } from 'glasswork/jobs';
import { jobConfig } from './config/job-config';

export const handler = createSchedulerHandler({
  tableName: jobConfig.get('scheduledJobsTable')!, // required when using DynamoDB strategy
  region: jobConfig.get('awsRegion'),
  driver: new SQSQueueDriver({
    region: jobConfig.get('awsRegion'),
    queues: { default: jobConfig.get('jobQueueUrl') },
  }),
});
```

Trigger this Lambda every minute using EventBridge when the DynamoDB strategy is enabled.

## Minimal End-to-End (SQS + Lambda)

1. **Define a job**

   ```typescript
   export const sendPing = defineJob({
     name: 'send-ping',
     schema: v.object({ userId: v.string() }),
     handler: async ({ userId }, { services }) => {
       await services.notificationService.ping(userId);
     },
   });
   ```

2. **Worker handler**

   ```typescript
   import { jobConfig } from './config/job-config';

   export const handler = bootstrapWorker({
     module: defineModule({
       name: 'worker',
       providers: [NotificationService],
       jobs: [sendPing],
     }),
     driver: new SQSQueueDriver({
       region: jobConfig.get('awsRegion'),
       queues: { default: jobConfig.get('jobQueueUrl') },
       // Default: self-reschedule long delays in 15-minute slices
       // To use DynamoDB instead:
       // longDelayStrategy: 'dynamodb',
       // schedulerTable: jobConfig.get('scheduledJobsTable'),
     }),
   });
   ```

3. **SAM snippet**

   ```yaml
   Resources:
     JobQueue:
       Type: AWS::SQS::Queue
     Worker:
       Type: AWS::Serverless::Function
       Properties:
         Handler: dist/worker.handler
         Runtime: nodejs22.x
         Events:
           Jobs:
             Type: SQS
             Properties:
               Queue: !GetAtt JobQueue.Arn
         Environment:
           Variables:
             JOB_QUEUE_URL: !Ref JobQueue
   ```

## Learn More

- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/) - AWS SDK docs
- [SQS Developer Guide](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
