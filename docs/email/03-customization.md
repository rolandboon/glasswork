# Email Customization Guide

This guide covers advanced customization options including custom transports, delivery tracking via webhooks, and testing strategies.

## Custom Transports

### Transport Interface

All transports implement the `EmailTransport` interface:

```typescript
interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailResult>;
}
```

### Creating a Custom Transport

```typescript
import type { EmailTransport, EmailMessage, EmailResult } from 'glasswork';
import nodemailer from 'nodemailer';

export class SMTPTransport implements EmailTransport {
  readonly name = 'smtp';
  private transporter: nodemailer.Transporter;

  constructor(config: SMTPConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const result = await this.transporter.sendMail({
      from: message.from,
      to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      })),
    });

    return {
      messageId: result.messageId,
      success: true,
      metadata: { provider: 'smtp' },
    };
  }
}
```

### Using Multiple Transports

Implement a fallback strategy:

```typescript
class FallbackTransport implements EmailTransport {
  readonly name = 'fallback';

  constructor(
    private primary: EmailTransport,
    private secondary: EmailTransport,
  ) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      return await this.primary.send(message);
    } catch (error) {
      console.warn(`Primary transport failed, using fallback:`, error);
      return await this.secondary.send(message);
    }
  }
}

// Usage
const transport = new FallbackTransport(
  new SESTransport({ region: 'eu-west-1' }),
  new SMTPTransport({ host: 'smtp.backup.com', port: 587 }),
);
```

## Delivery Tracking with Webhooks

AWS SES can notify your application about delivery status via SNS webhooks.

### Setting Up the Webhook Handler

```typescript
import { Hono } from 'hono';
import {
  createSESWebhookHandler,
  verifySNSSignature,
  handleSNSSubscription,
  parseSESNotification,
} from 'glasswork';

const app = new Hono();

// Option 1: Use the convenience handler factory
app.post('/webhooks/ses',
  createSESWebhookHandler({
    verifySignature: true, // Enabled by default in production

    onDelivered: async (event, c) => {
      console.log(`Email ${event.messageId} delivered to ${event.recipient}`);

      // Update your database
      await db.email.update({
        where: { messageId: event.messageId },
        data: {
          status: 'DELIVERED',
          deliveredAt: event.timestamp,
        },
      });
    },

    onBounced: async (event, c) => {
      console.log(`Email ${event.messageId} bounced: ${event.reason}`);

      // Handle bounce
      await db.email.update({
        where: { messageId: event.messageId },
        data: {
          status: 'BOUNCED',
          bounceType: event.bounceType,
          bounceReason: event.reason,
        },
      });

      // For permanent bounces, mark email as invalid
      if (event.bounceType === 'permanent') {
        await db.user.update({
          where: { email: event.recipient },
          data: { emailValid: false },
        });
      }
    },

    onComplaint: async (event, c) => {
      console.log(`Complaint from ${event.recipient}`);

      // Unsubscribe user from marketing emails
      await db.emailPreference.update({
        where: { email: event.recipient },
        data: { unsubscribed: true },
      });
    },
  })
);
```

### Using Individual Middleware Components

For more control, use the middleware components directly:

```typescript
app.post('/webhooks/ses',
  // Step 1: Verify the SNS signature
  verifySNSSignature(),

  // Step 2: Handle subscription confirmations
  handleSNSSubscription(),

  // Step 3: Parse and handle the notification
  async (c) => {
    const event = await parseSESNotification(c);

    if (!event) {
      return c.json({ received: true });
    }

    // Custom handling logic
    switch (event.type) {
      case 'delivered':
        await handleDelivery(event);
        break;
      case 'bounced':
        await handleBounce(event);
        break;
      case 'complaint':
        await handleComplaint(event);
        break;
    }

    return c.json({ processed: true });
  }
);
```

### Event Types

```typescript
interface DeliveredEvent {
  type: 'delivered';
  messageId: string;
  timestamp: Date;
  recipient: string;
  processingTimeMs?: number;
  smtpResponse?: string;
}

interface BouncedEvent {
  type: 'bounced';
  messageId: string;
  timestamp: Date;
  recipient: string;
  bounceType: 'permanent' | 'transient';
  bounceSubType: string;
  reason: string;
}

interface ComplaintEvent {
  type: 'complaint';
  messageId: string;
  timestamp: Date;
  recipient: string;
  complaintType: string;
  userAgent?: string;
}
```

## Email Attachments

### Sending Attachments

```typescript
await emailService.send({
  to: 'user@example.com',
  subject: 'Your Invoice',
  html: '<p>Please find your invoice attached.</p>',
  attachments: [
    {
      filename: 'invoice.pdf',
      content: pdfBuffer, // Buffer or base64 string
      contentType: 'application/pdf',
    },
  ],
});
```

### Inline Images

Use Content-ID for inline images:

```typescript
await emailService.send({
  to: 'user@example.com',
  subject: 'Newsletter',
  html: '<img src="cid:logo" alt="Logo" /><p>Welcome to our newsletter!</p>',
  attachments: [
    {
      filename: 'logo.png',
      content: logoBuffer,
      contentType: 'image/png',
      disposition: 'inline',
      contentId: 'logo',
    },
  ],
});
```

## Testing

### Mock Transport

Use the built-in mock transport for testing:

```typescript
import { MockTransport, EmailService } from 'glasswork';

describe('Email notifications', () => {
  let transport: MockTransport;
  let emailService: EmailService;

  beforeEach(() => {
    transport = new MockTransport();
    emailService = new EmailService(transport, {
      from: 'test@example.com',
    });
  });

  it('should send welcome email', async () => {
    await emailService.send({
      to: 'user@example.com',
      subject: 'Welcome!',
      html: '<p>Hello</p>',
    });

    expect(transport.getSentEmails()).toHaveLength(1);
    expect(transport.getLastEmail()).toMatchObject({
      to: 'user@example.com',
      subject: 'Welcome!',
    });
  });

  it('should send to correct recipient', async () => {
    await emailService.send({
      to: 'admin@example.com',
      subject: 'Alert',
      html: '<p>Something happened</p>',
    });

    expect(transport.hasEmailTo('admin@example.com')).toBe(true);
    expect(transport.hasEmailTo('user@example.com')).toBe(false);
  });

  afterEach(() => {
    transport.clear(); // Reset between tests
  });
});
```

### Testing Templates

```typescript
import { render } from './compiled/welcome.js';

describe('Welcome template', () => {
  it('should render with all variables', () => {
    const result = render({
      name: 'John',
      dashboardUrl: 'https://app.example.com',
    });

    expect(result.html).toContain('John');
    expect(result.html).toContain('https://app.example.com');
    expect(result.text).toContain('John');
  });

  it('should use default values', () => {
    const result = render({
      dashboardUrl: 'https://app.example.com',
    });

    expect(result.html).toContain('there'); // Default for name
  });
});
```

### Integration Testing with LocalStack

```typescript
import { SESTransport } from 'glasswork';

const transport = new SESTransport({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566', // LocalStack
});

// Emails will be sent to LocalStack's SES mock
```

## Tracking Sent Emails

Use the `onSent` hook to track all outgoing emails:

```typescript
const emailService = new EmailService(transport, {
  from: 'noreply@example.com',
  onSent: async (result, message) => {
    // Log to database
    await db.emailLog.create({
      data: {
        messageId: result.messageId,
        to: Array.isArray(message.to) ? message.to : [message.to],
        subject: message.subject,
        sentAt: new Date(),
        metadata: result.metadata,
      },
    });

    // Send to analytics
    analytics.track('email_sent', {
      messageId: result.messageId,
      template: message.template,
    });
  },
});
```
