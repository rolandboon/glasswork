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

## Quick Start

### 1. Define a Job

Create a job with a name, optional schema, and handler:

```typescript
// src/modules/notifications/send-notification.job.ts
import { defineJob } from 'glasswork';
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
import { defineModule } from 'glasswork';
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
import { defineModule, JobService, SQSQueueDriver, type Config } from 'glasswork';
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
import { JobService } from 'glasswork';
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
import { bootstrapWorker } from 'glasswork';
import { AppModule } from './app.module';

export const handler = bootstrapWorker({
  module: AppModule,
});
```

That's it! Jobs registered in any module imported by `AppModule` will be processed.

### 6. Configure AWS Infrastructure

Add an SQS queue and worker Lambda to your SAM template:

```yaml
Resources:
  JobsQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: my-app-jobs

  WorkerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: dist/worker.handler
      Runtime: nodejs22.x
      Environment:
        Variables:
          JOB_QUEUE_URL: !Ref JobsQueue
      Events:
        SQSEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt JobsQueue.Arn
            BatchSize: 10
      Policies:
        - SQSSendMessagePolicy:
            QueueName: !GetAtt JobsQueue.QueueName
```

## Common Use Case: Sending Emails

The most common background job is sending emails. The recommended pattern preserves the automatic type inference from your compiled templates:

### Define an Email Job

```typescript
// src/modules/email/send-email.job.ts
import { defineJob } from 'glasswork';
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
