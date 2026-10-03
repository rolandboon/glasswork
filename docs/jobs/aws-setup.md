---
description: AWS CDK infrastructure in TypeScript for SQS queues, Lambda workers, dead-letter queues, and EventBridge Scheduler.
---

# AWS Setup Guide

Glasswork's infrastructure examples use AWS CDK v2 in TypeScript. This guide sets
up an API that enqueues jobs and a worker that processes them. See
[Lambda Deployment](/deployment/lambda#aws-cdk) for CDK installation, the app entry
point, and deployment commands.

`bootstrapWorker` returns failed SQS record IDs in `batchItemFailures`. Enable
`reportBatchItemFailures: true` on **every** `SqsEventSource`. Without it, Lambda
can remove failed records from the queue after a normally returned invocation.
Update existing event source mappings as well; updating Glasswork does not change
your infrastructure. See [AWS partial batch responses](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html).

## Standard Setup

This stack creates a standard SQS queue, a dead-letter queue, an API Lambda, and
a worker Lambda. CDK bundles both TypeScript entry points with esbuild. Keep ESM
for top-level `await`, preserve names for Awilix, and externalize the AWS SDK
provided by the explicitly selected Lambda runtime.

```typescript
// lib/jobs-stack.ts
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

export class JobsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const deadLetterQueue = new Queue(this, 'JobDLQ', {
      retentionPeriod: Duration.days(14),
    });
    const jobQueue = new Queue(this, 'JobQueue', {
      visibilityTimeout: Duration.minutes(3), // At least 6 × the worker timeout
      retentionPeriod: Duration.days(7),
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 25 },
    });
    const bundling = {
      format: OutputFormat.ESM,
      target: 'node24',
      minify: true,
      keepNames: true,
      externalModules: ['@aws-sdk/*'],
      banner:
        "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    };
    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      entry: 'src/server.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling,
      environment: { NODE_ENV: 'production', JOB_QUEUE_URL: jobQueue.queueUrl },
    });
    jobQueue.grantSendMessages(apiFunction);

    const worker = new NodejsFunction(this, 'WorkerFunction', {
      entry: 'src/worker.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling,
      environment: { NODE_ENV: 'production', JOB_QUEUE_URL: jobQueue.queueUrl },
    });
    worker.addEventSource(
      new SqsEventSource(jobQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      })
    ); // CDK also grants the worker permission to consume the queue.

    new CfnOutput(this, 'JobQueueUrl', { value: jobQueue.queueUrl });
  }
}
```

Add the API's HTTP endpoint and application configuration as described in
[Lambda Deployment](/deployment/lambda). If jobs enqueue follow-up jobs,
also call `jobQueue.grantSendMessages(worker)`. Keep `maxReceiveCount` aligned
with the highest `maxAttempts` among the jobs using this queue; 25 is Glasswork's
default. The DLQ retains messages longer than the source queue.

The remaining snippets belong inside the stack constructor, with `jobQueue`,
`worker`, and `apiFunction` from the example above in scope.

## EventBridge Scheduler for Long Delays

Immediate jobs and normal retries use SQS alone. Delays longer than 15 minutes
use one-off EventBridge Scheduler schedules that send messages to SQS. No
periodic dispatcher is needed.

Create an execution role for Scheduler and allow the API to create/cancel only
Glasswork schedules in the default schedule group:

```typescript
import { ArnFormat } from 'aws-cdk-lib';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

const schedulerRole = new Role(this, 'SchedulerRole', {
  assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
});
jobQueue.grantSendMessages(schedulerRole);

apiFunction.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
apiFunction.addToRolePolicy(
  new PolicyStatement({
    actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule'],
    resources: [
      this.formatArn({
        service: 'scheduler',
        resource: 'schedule',
        resourceName: 'default/glasswork-*',
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      }),
    ],
  })
);
apiFunction.addToRolePolicy(
  new PolicyStatement({
    actions: ['iam:PassRole'],
    resources: [schedulerRole.roleArn],
    conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
  })
);
```

Apply the same producer permissions to the worker if it schedules follow-up jobs.
Configure the application's driver with that role:

```typescript
new SQSQueueDriver({
  region: config.get('awsRegion'),
  queues: { default: config.get('jobQueueUrl') },
  scheduler: {
    region: config.get('awsRegion'),
    roleArn: config.get('schedulerRoleArn'),
  },
});
```

## FIFO Queues

FIFO queues preserve ordering within a message group and deduplicate sends. Keep
side effects idempotent: deduplication does not guarantee exactly-once execution.

The worker detects FIFO queues by their ARN (`.fifo`) and stops the batch after
the first failure. Failed and unprocessed records, including other message
groups, are returned in `batchItemFailures`. Jobs acknowledged through
`retry: false` or exhausted retries with `dead: false` do not stop the batch.
Keep `reportBatchItemFailures: true` on the event source.

Replace both queue definitions in the standard setup:

```typescript
const deadLetterQueue = new Queue(this, 'JobDLQ', {
  fifo: true,
  retentionPeriod: Duration.days(14),
});
const jobQueue = new Queue(this, 'JobQueue', {
  fifo: true,
  contentBasedDeduplication: false, // Glasswork supplies a job ID for deduplication.
  visibilityTimeout: Duration.minutes(3),
  retentionPeriod: Duration.days(7),
  deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 25 },
});
```

## Periodic Jobs (Cron)

For jobs that actually run on a recurring schedule, use CDK's `Schedule` and
`LambdaInvoke` target. The target creates a dedicated Scheduler execution role
and grants `lambda:InvokeFunction`; the SQS scheduler role above is for a
different target and is not reused here.

```typescript
import {
  Schedule,
  ScheduleExpression,
  ScheduleTargetInput,
  TimeWindow,
} from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';

new Schedule(this, 'DailyCleanup', {
  schedule: ScheduleExpression.cron({ minute: '0', hour: '2' }), // 02:00 UTC
  timeWindow: TimeWindow.off(),
  target: new LambdaInvoke(worker, {
    input: ScheduleTargetInput.fromObject({ jobName: 'daily-cleanup', payload: {} }),
  }),
});
```

Scheduler delivery retries cover invoking Lambda, not completion of the job.
For queued execution and SQS job retries, use an `SqsSendMessage` target instead.
See [CDK Scheduler targets](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_scheduler_targets-readme.html).

## Environment Variables Summary

| Variable | Description | Source |
| --- | --- | --- |
| `JOB_QUEUE_URL` | SQS queue URL | `jobQueue.queueUrl` |
| `SCHEDULER_ROLE_ARN` | Execution role for one-off delayed jobs | `schedulerRole.roleArn` |
| `AWS_REGION` | AWS region, supplied by Lambda | Stack deployment region |

For dashboards and alarms, see [Worker Observability](./observability#dashboards-and-alarms-with-cdk).
