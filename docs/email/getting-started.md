# Email Module - Getting Started

Glasswork's email module provides a type-safe, template-driven email solution optimized for serverless environments. It uses AWS SES as the primary transport and MJML for responsive email templates.

After reading this guide, you will know:

- How to create and compile MJML email templates
- How to configure the email service with AWS SES
- How to send emails synchronously and via background jobs
- How to track email delivery and test emails locally

## Quick Start

### 1. Install Dependencies

:::: code-group

```bash [npm]
npm install mjml html-to-text
npm install -D @types/mjml
```

```bash [pnpm]
pnpm add mjml html-to-text
pnpm add -D @types/mjml
```

```bash [yarn]
yarn add mjml html-to-text
yarn add -D @types/mjml
```

::::

For SES transport:

:::: code-group

```bash [npm]
npm install @aws-sdk/client-sesv2
```

```bash [pnpm]
pnpm add @aws-sdk/client-sesv2
```

```bash [yarn]
yarn add @aws-sdk/client-sesv2
```

::::

### 2. Create Your First Template

Create an MJML template with Glasswork's control flow syntax:

```xml
<!-- templates/welcome.mjml -->
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text font-size="24px" font-weight="bold">
          Welcome, {{name}}!
        </mj-text>
        <mj-text>
          Thanks for joining. Your account is ready to use.
        </mj-text>
        <mj-button href="{{dashboardUrl}}">
          Go to Dashboard
        </mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

### 3. Compile Templates

Add a build script to your `package.json`:

```json
{
  "scripts": {
    "build:emails": "tsx scripts/compile-emails.ts"
  }
}
```

Create the compilation script:

```typescript
// scripts/compile-emails.ts
import { compileTemplates } from 'glasswork';
import path from 'path';

const result = await compileTemplates({
  sourceDir: path.resolve(__dirname, '../templates'),
  outputDir: path.resolve(__dirname, '../src/email/compiled'),
  verbose: true,
});

if (result.errors.length > 0) {
  console.error('Compilation errors:', result.errors);
  process.exit(1);
}

console.log(`Compiled ${result.templates.length} templates`);
```

Run compilation:

```bash
npm run build:emails
```

### 4. Create the Email Module

Define an email module following Glasswork's module pattern:

```typescript
// src/email/email.module.ts
import { defineModule } from 'glasswork';
import {
  SESTransport,
  TemplatedEmailService,
} from 'glasswork';

// Import compiled templates
import { templates } from './compiled/index';

export const EmailModule = defineModule({
  name: 'email',
  providers: [
    // Transport provider
    {
      provide: 'emailTransport',
      useFactory: ({ config }) => {
        return new SESTransport({
          region: config.get('awsRegion'),
          configurationSet: config.get('sesConfigurationSet'),
        });
      },
    },
    // Email service provider
    {
      provide: 'emailService',
      useFactory: ({ emailTransport, config }) => {
        return new TemplatedEmailService({
          config: {
            transport: emailTransport,
            from: config.get('emailFrom'),
            replyTo: config.get('emailReplyTo'),
          },
          templates,
        });
      },
    },
  ],
  exports: ['emailService'],
});
```

### 5. Import in Your App Module

```typescript
// src/app.module.ts
import { defineModule } from 'glasswork';
import { ConfigModule } from './config/config.module';
import { EmailModule } from './email/email.module';
import { UserModule } from './users/user.module';

export const AppModule = defineModule({
  name: 'app',
  imports: [ConfigModule, EmailModule, UserModule],
});
```

### 6. Inject and Use in Services

```typescript
// src/users/user.service.ts
import type { TemplatedEmailService } from 'glasswork';
import type { WelcomeContext } from '../email/compiled/welcome.js';

export class UserService {
  private readonly emailService: TemplatedEmailService;
  private readonly prismaService: PrismaService;

  constructor({
    emailService,
    prismaService,
  }: {
    emailService: TemplatedEmailService;
    prismaService: PrismaService;
  }) {
    this.emailService = emailService;
    this.prismaService = prismaService;
  }

  async createUser(email: string, name: string) {
    const user = await this.prismaService.user.create({
      data: { email, name },
    });

    // Type-safe template rendering
    await this.emailService.send({
      template: 'welcome',
      to: email,
      subject: 'Welcome to Our Platform',
      context: {
        name,
        dashboardUrl: 'https://app.example.com/dashboard',
      } satisfies WelcomeContext,
    });

    return user;
  }
}
```

## Adding Delivery Tracking

Track sent emails using the `onSent` hook:

```typescript
// src/email/email.module.ts
{
  provide: 'emailService',
  useFactory: ({ emailTransport, config, prismaService }) => {
    return new TemplatedEmailService({
      config: {
        transport: emailTransport,
        from: config.get('emailFrom'),
      },
      templates,
      onSent: async (result, message) => {
        await prismaService.emailLog.create({
          data: {
            messageId: result.messageId,
            to: Array.isArray(message.to) ? message.to : [message.to],
            subject: message.subject,
            status: 'SENT',
            sentAt: new Date(),
          },
        });
      },
    });
  },
}
```

## Sending Emails via Background Jobs

For better performance, send emails asynchronously using background jobs. This prevents slow email operations from blocking your API responses.

:::: tip Why Use Background Jobs?
Sending emails synchronously blocks the request until the email is accepted by SES. Using a background job returns immediately and processes the email in a worker Lambda.
::::

### 1. Define an Email Job

The job payload type is derived from your compiled templates, preserving full type safety:

```typescript
// src/modules/email/send-email.job.ts
import { defineJob } from 'glasswork';
import type { EmailService, Templates } from './compiled';

// Derive payload type from compiled templates - no manual schema needed!
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

### 2. Register the Job

```typescript
// src/modules/email/email.module.ts
import { sendEmailJob } from './send-email.job';

export const EmailModule = defineModule({
  name: 'email',
  providers: [/* ... */],
  jobs: [sendEmailJob],  // Register the job
  exports: ['emailService'],
});
```

### 3. Queue Emails from Services

```typescript
// src/users/user.service.ts
import { JobService } from 'glasswork';
import { sendEmailJob } from '../email/send-email.job';

export class UserService {
  constructor(
    private readonly jobService: JobService,
    private readonly prismaService: PrismaService,
  ) {}

  async createUser(email: string, name: string) {
    const user = await this.prismaService.user.create({
      data: { email, name },
    });

    // Queue email (processed by worker Lambda)
    await this.jobService.enqueue(sendEmailJob, {
      template: 'welcome',
      to: email,
      context: { name, dashboardUrl: 'https://...' },
    });

    return user;
  }
}
```

See [Background Jobs](/jobs/getting-started) for the full setup guide.

## Environment Variables

Configure email settings via environment variables:

```env
# AWS SES Configuration
AWS_REGION=eu-west-1
SES_CONFIGURATION_SET=production-emails

# Email Defaults
EMAIL_FROM=noreply@example.com
EMAIL_REPLY_TO=support@example.com

# For local development with LocalStack
SES_ENDPOINT=http://localhost:4566
```

## Testing Emails

### Unit Testing with Mock Transport

Create a mock transport for unit tests:

```typescript
import type { EmailTransport, SendEmailResult } from 'glasswork';

export class MockTransport implements EmailTransport {
  public sentEmails: Array<{ to: string | string[]; subject: string; html: string }> = [];

  async send(message: { to: string | string[]; subject: string; html: string; text: string }): Promise<SendEmailResult> {
    this.sentEmails.push(message);
    return { messageId: `mock-${Date.now()}` };
  }
}

// In your test
const transport = new MockTransport();
const emailService = new TemplatedEmailService({
  config: { transport, from: 'test@example.com' },
  templates,
});

await emailService.send('welcome', { to: 'user@example.com', context: { name: 'Test' } });

expect(transport.sentEmails).toHaveLength(1);
expect(transport.sentEmails[0].to).toBe('user@example.com');
```

### Local Development with LocalStack

For end-to-end testing with a real SES API:

```bash
# Start LocalStack
docker run -d -p 4566:4566 localstack/localstack

# Verify SES identity (required even for LocalStack)
aws --endpoint-url=http://localhost:4566 ses verify-email-identity --email-address noreply@example.com
```

Configure your transport:

```typescript
const transport = new SESTransport({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566', // LocalStack endpoint
});
```

### Testing Email Jobs

When using background jobs for email, test the job enqueuing separately:

```typescript
import { MockQueueDriver, JobService } from 'glasswork';
import { sendEmailJob } from './send-email.job';

const driver = new MockQueueDriver();
const jobService = new JobService(driver);

await jobService.enqueue(sendEmailJob, {
  template: 'welcome',
  to: 'user@example.com',
  context: { name: 'Test' },
});

expect(driver.enqueued).toHaveLength(1);
expect(driver.enqueued[0].message.payload.template).toBe('welcome');
```

## Next Steps

- [Email Templates](/email/templates) - Control flow syntax and type inference
- [AWS Setup](/email/aws-setup) - SES configuration and domain verification
- [Email API](/email/api) - Complete API reference
- [Background Jobs](/jobs/getting-started) - Send emails asynchronously
