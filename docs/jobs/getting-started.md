---
title: Getting Started with Background Jobs
---

# Getting Started

Glasswork provides a first-class background jobs solution powered by AWS SQS and Lambda.

## Features

- **Type-Safe Jobs**: Define jobs with Valibot schemas for payload validation.
- **Zero Decorators**: Pure functions and configuration objects.
- **AWS SQS Native**: Optimized for serverless, with support for FIFO queues.
- **Flexible Scheduling**: Immediate, delayed, and scheduled execution.
- **Robust Error Handling**: Automatic retries, dead letter queues, and poison message handling.
- **Testing Friendly**: In-memory drivers for fast unit tests.

## Installation

The jobs module is part of the core Glasswork package, but you'll need the AWS SDK clients if you haven't installed them yet:

:::: code-group

```bash [npm]
npm install @aws-sdk/client-sqs @aws-sdk/client-dynamodb
```

```bash [pnpm]
pnpm add @aws-sdk/client-sqs @aws-sdk/client-dynamodb
```

```bash [yarn]
yarn add @aws-sdk/client-sqs @aws-sdk/client-dynamodb
```

::::

## Quick Start

### 1. Define a Job

Create a job definition file. We recommend placing them in a `src/jobs` directory.

```typescript
// src/jobs/send-welcome-email.job.ts
import * as v from 'valibot';
import { defineJob } from 'glasswork/jobs';

export const sendWelcomeEmail = defineJob({
  name: 'send-welcome-email',
  queue: 'emails', // Optional: defaults to 'default'
  schema: v.object({
    userId: v.string(),
    name: v.string(),
  }),
  handler: async ({ userId, name }, { services, logger }) => {
    logger.info({ userId }, 'Sending welcome email');
    await services.emailService.send('welcome', { to: userId, name });
  },
});
```

### 2. Create a Worker Module

Register your jobs in a worker module. This separates your HTTP logic from your background workers.

```typescript
// src/modules/worker.module.ts
import { defineModule } from 'glasswork';
import { sendWelcomeEmail } from '../jobs/send-welcome-email.job';
import { EmailService } from '../services/email.service';

export const WorkerModule = defineModule({
  name: 'worker',
  providers: [EmailService],
  jobs: [sendWelcomeEmail],
});
```

### 3. Set Up Job Configuration

Use the config service so queue settings are type-safe and centralized (see [Environment Config](/configuration/environment-config)).

```typescript
// src/config/job-config.ts
import { createConfig, envProvider } from 'glasswork';
import { object, string } from 'valibot';

export const jobConfig = await createConfig({
  schema: object({
    awsRegion: string(),
    jobQueueUrl: string(),
    emailQueueUrl: string(),
  }),
  providers: [envProvider()],
});
```

### 4. Create the Worker Handler

Create a Lambda handler for your worker.

```typescript
// src/worker.ts
import { bootstrapWorker, SQSQueueDriver } from 'glasswork/jobs';
import { WorkerModule } from './modules/worker.module';
import { jobConfig } from './config/job-config';

export const handler = bootstrapWorker({
  module: WorkerModule,
  driver: new SQSQueueDriver({
    region: jobConfig.get('awsRegion'),
    queues: {
      default: jobConfig.get('jobQueueUrl'),
      emails: jobConfig.get('emailQueueUrl'),
    },
  }),
});
```

### 5. Enqueue Jobs

Inject the `JobService` into your application and start enqueuing jobs.

```typescript
// src/services/user.service.ts
import { JobService } from 'glasswork/jobs';
import { sendWelcomeEmail } from '../jobs/send-welcome-email.job';

export class UserService {
  constructor(private jobService: JobService) {}

  async register(name: string, email: string) {
    // ... create user logic ...

    await this.jobService.enqueue(sendWelcomeEmail, {
      userId: user.id,
      name: user.name,
    });
  }
}
```

## Next Steps

- Learn how to [Define Jobs](./defining-jobs) with schemas and options.
- Configure your [Workers](./workers) with hooks and error handling.
- Explore [Dispatching & Scheduling](./dispatching) for delayed and periodic jobs.
- Read about [Best Practices](./best-practices) for production systems.
