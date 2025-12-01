# Email Module - Getting Started

Glasswork's email module provides a type-safe, template-driven email solution optimized for serverless environments. It uses AWS SES as the primary transport and MJML for responsive email templates.

## Quick Start

### 1. Install Dependencies

```bash
npm add mjml html-to-text
npm add -D @types/mjml
```

For SES transport:

```bash
npm add @aws-sdk/client-sesv2
```

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
          region: config.get('AWS_REGION'),
          configurationSet: config.get('SES_CONFIGURATION_SET'),
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
            from: config.get('EMAIL_FROM'),
            replyTo: config.get('EMAIL_REPLY_TO'),
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
  useFactory: ({ emailTransport, templateRegistry, config, prismaService }) => {
    return new TemplatedEmailService(emailTransport, templateRegistry, {
      from: config.get('EMAIL_FROM'),
      onSent: async (result, message) => {
        // Log to database for tracking
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

## Environment Variables

Configure your email settings via environment variables:

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
