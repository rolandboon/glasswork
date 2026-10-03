---
description: Getting started with background jobs in Glasswork, including defining, enqueueing, and processing jobs with SQS and Lambda.
---

# Background Jobs

This guide covers creating, enqueueing, and processing background jobs with Glasswork.

After reading this guide, you will know:

- How to define type-safe jobs with payload validation
- How to enqueue jobs immediately, with delays, or at specific times
- How to set up a worker Lambda to process jobs
- How to send emails asynchronously via background jobs

:::: tip What are Background Jobs?
Background jobs allow you to offload work from the request-response cycle. Common examples include sending emails, processing uploads, generating reports, and syncing with external APIs. Glasswork uses AWS SQS + Lambda for reliable, serverless job processing.
::::

`bootstrapWorker` returns failed SQS record IDs in `batchItemFailures`. Every SQS
event source must enable `reportBatchItemFailures: true` in CDK's `SqsEventSource`.
Without it, Lambda treats a normally returned invocation as successful and can
remove failed records from the queue. Apply this setting to existing deployments
as well; updating the worker package does not update the event source mapping.
See [AWS partial batch responses](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html).

## Quick Start

### 1. Define a Job

Create a job with a name, optional schema, and handler:

```typescript
// src/modules/notifications/send-notification.job.ts
import { defineJob } from 'glasswork/jobs';
import * as v from 'valibot';

export const sendNotificationJob = defineJob({
  name: 'send-notification',
  schema: v.object({
    userId: v.string(),
    message: v.string(),
  }),
  handler: async ({ userId, message }, { services, logger }) => {
    logger.info({ userId }, 'Sending notification');
    await services.notificationService.send(userId, message);
  },
});
```

The `schema` uses [Valibot](https://valibot.dev/) for runtime validation. If a payload doesn't match, the job fails permanently.

### 2. Register the Job

Jobs are registered in modules using the `jobs` array:

```typescript
// src/modules/notifications/notification.module.ts
import { defineModule } from 'glasswork/core';
import { NotificationService } from './notification.service';
import { sendNotificationJob } from './send-notification.job';

export const NotificationModule = defineModule({
  name: 'notifications',
  providers: [NotificationService],
  jobs: [sendNotificationJob],
});
```

### 3. Create a JobService Provider

The `JobService` needs a queue driver to enqueue jobs. Register it in a module:

```typescript
// src/modules/jobs/worker.module.ts
import { defineModule, type Config } from 'glasswork/core';
import { JobService, SQSQueueDriver } from 'glasswork/jobs';
import type { ConfigSchema } from '../config/config.module';

export const WorkerModule = defineModule({
  name: 'worker',
  providers: [
    {
      provide: 'jobService',
      useFactory: ({ config }: { config: Config<typeof ConfigSchema> }) =>
        new JobService(
          new SQSQueueDriver({
            region: config.get('awsRegion'),
            queues: {
              default: config.get('jobQueueUrl'),
            },
          })
        ),
    },
  ],
  exports: ['jobService'],
});
```

### 4. Enqueue Jobs

Import `WorkerModule` wherever you need to enqueue jobs, then use `jobService.enqueue()`:

```typescript
// src/modules/users/user.service.ts
import { JobService } from 'glasswork/jobs';
import { sendNotificationJob } from '../notifications/send-notification.job';

export class UserService {
  constructor(private readonly jobService: JobService) {}

  async register(email: string, name: string) {
    const user = await this.createUser(email, name);

    // Queue a notification (processed by worker Lambda)
    await this.jobService.enqueue(sendNotificationJob, {
      userId: user.id,
      message: `Welcome, ${name}!`,
    });

    return user;
  }
}
```

### 5. Create the Worker Lambda

The worker processes jobs from SQS:

```typescript
// src/worker.ts
import { bootstrapWorker } from 'glasswork/jobs';
import { AppModule } from './app.module';

export const handler = bootstrapWorker({
  module: AppModule,
});
```

That's it! Jobs registered in any module imported by `AppModule` will be processed.

### 6. Configure AWS Infrastructure

Add a queue and worker in your CDK stack constructor. The existing API Lambda
(`apiFunction`) receives the queue URL and permission to enqueue jobs:

```typescript
import { Duration } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';

const dlq = new Queue(this, 'JobsDLQ', { retentionPeriod: Duration.days(14) });
const jobsQueue = new Queue(this, 'JobsQueue', {
  visibilityTimeout: Duration.minutes(3),
  deadLetterQueue: { queue: dlq, maxReceiveCount: 25 },
});
const worker = new NodejsFunction(this, 'WorkerFunction', {
  entry: 'src/worker.ts',
  handler: 'handler',
  runtime: Runtime.NODEJS_24_X,
  timeout: Duration.seconds(30),
  bundling: {
    format: OutputFormat.ESM,
    target: 'node24',
    keepNames: true,
    externalModules: ['@aws-sdk/*'],
    banner:
      "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  environment: { NODE_ENV: 'production', JOB_QUEUE_URL: jobsQueue.queueUrl },
});
worker.addEventSource(
  new SqsEventSource(jobsQueue, {
    batchSize: 10,
    reportBatchItemFailures: true,
  })
);
apiFunction.addEnvironment('JOB_QUEUE_URL', jobsQueue.queueUrl);
jobsQueue.grantSendMessages(apiFunction);
```

CDK grants the worker permission to consume the queue. Keep the DLQ's
`maxReceiveCount` aligned with your jobs' retry limits. See
[AWS Setup](./aws-setup) for the complete stack, FIFO queues, and scheduling.

## Common Use Case: Sending Emails

The most common background job is sending emails. The recommended pattern preserves the automatic type inference from your compiled templates:

### Define an Email Job

```typescript
// src/modules/email/send-email.job.ts
import { defineJob } from 'glasswork/jobs';
import type { EmailService, Templates } from './compiled';

// Derive payload type from compiled templates - no manual schema needed
type SendEmailPayload = {
  [K in keyof Templates & string]: {
    template: K;
    to: string | string[];
    context: Templates[K] extends { render: (ctx: infer C) => unknown } ? C : never;
  };
}[keyof Templates & string];

export const sendEmailJob = defineJob<SendEmailPayload>({
  name: 'send-email',
  handler: async (payload, { services }) => {
    const emailService = services.emailService as EmailService;
    await emailService.send(payload.template, {
      to: payload.to,
      context: payload.context,
    });
  },
});
```

This approach:
- **Preserves type inference** from your compiled email templates
- **No schema duplication** - types come from the templates
- **Full autocomplete** for template names and context fields

### Queue Emails from Services

```typescript
// Full type safety - context is inferred from the 'welcome' template
await this.jobService.enqueue(sendEmailJob, {
  template: 'welcome',
  to: user.email,
  context: { name: user.name, verificationLink: '...' },  // ← Type-checked!
});
```

This keeps email sending out of the request-response cycle, improving response times.

## Next Steps

- [Defining Jobs](./defining-jobs) - Schemas, queues, and uniqueness
- [Dispatching & Scheduling](./dispatching) - Delays and scheduled execution
- [Workers](./workers) - Lifecycle hooks and error handling
- [Error Handling & Retries](./error-handling) - Retry configuration and best practices
- [AWS Setup](./aws-setup) - Complete infrastructure guide
- [Testing](./testing) - Mock drivers for unit tests
