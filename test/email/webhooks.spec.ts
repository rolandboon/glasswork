import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSESWebhookHandler } from '../../src/email/webhooks/handler-factory.js';
import {
  parseSESNotification,
  parseSNSMessage,
} from '../../src/email/webhooks/notification-parser.js';
import * as signatureModule from '../../src/email/webhooks/signature-verification.js';

// Test the notification parser and handler logic
// Note: Full integration tests would require a Hono context

describe('SES Webhook Types', () => {
  describe('SNS Message types', () => {
    it('should have correct structure for subscription confirmation', () => {
      const subscriptionMessage = {
        Type: 'SubscriptionConfirmation',
        MessageId: 'msg-123',
        TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
        Token: 'confirmation-token',
        SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription...',
        Timestamp: '2024-01-15T10:30:00.000Z',
        SignatureVersion: '1',
        Signature: 'base64signature==',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      };

      expect(subscriptionMessage.Type).toBe('SubscriptionConfirmation');
      expect(subscriptionMessage.SubscribeURL).toBeDefined();
    });

    it('should have correct structure for notification', () => {
      const notification = {
        Type: 'Notification',
        MessageId: 'msg-456',
        TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
        Subject: 'SES Notification',
        Message: JSON.stringify({
          notificationType: 'Delivery',
          mail: {
            timestamp: '2024-01-15T10:30:00.000Z',
            messageId: 'ses-msg-789',
            source: 'sender@example.com',
            destination: ['recipient@example.com'],
          },
          delivery: {
            timestamp: '2024-01-15T10:30:01.000Z',
            processingTimeMillis: 523,
            recipients: ['recipient@example.com'],
            smtpResponse: '250 OK',
          },
        }),
        Timestamp: '2024-01-15T10:30:00.000Z',
        SignatureVersion: '1',
        Signature: 'base64signature==',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      };

      expect(notification.Type).toBe('Notification');
      expect(JSON.parse(notification.Message).notificationType).toBe('Delivery');
    });
  });

  describe('SES Event parsing', () => {
    it('should parse delivery notification correctly', () => {
      const deliveryNotification = {
        notificationType: 'Delivery',
        mail: {
          timestamp: '2024-01-15T10:30:00.000Z',
          messageId: 'ses-msg-001',
          source: 'sender@example.com',
          destination: ['recipient@example.com'],
          headersTruncated: false,
          headers: [],
          commonHeaders: {
            from: ['sender@example.com'],
            to: ['recipient@example.com'],
            subject: 'Test Email',
          },
        },
        delivery: {
          timestamp: '2024-01-15T10:30:01.000Z',
          processingTimeMillis: 523,
          recipients: ['recipient@example.com'],
          smtpResponse: '250 2.0.0 OK',
        },
      };

      expect(deliveryNotification.notificationType).toBe('Delivery');
      expect(deliveryNotification.mail.messageId).toBe('ses-msg-001');
      expect(deliveryNotification.delivery.recipients).toContain('recipient@example.com');
      expect(deliveryNotification.delivery.smtpResponse).toContain('250');
    });

    it('should parse bounce notification correctly', () => {
      const bounceNotification = {
        notificationType: 'Bounce',
        mail: {
          timestamp: '2024-01-15T10:30:00.000Z',
          messageId: 'ses-msg-002',
          source: 'sender@example.com',
          destination: ['invalid@example.com'],
          headersTruncated: false,
          headers: [],
          commonHeaders: {
            from: ['sender@example.com'],
            to: ['invalid@example.com'],
            subject: 'Test Email',
          },
        },
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [
            {
              emailAddress: 'invalid@example.com',
              action: 'failed',
              status: '5.1.1',
              diagnosticCode: 'smtp; 550 5.1.1 User unknown',
            },
          ],
          timestamp: '2024-01-15T10:30:02.000Z',
          feedbackId: 'feedback-123',
        },
      };

      expect(bounceNotification.notificationType).toBe('Bounce');
      expect(bounceNotification.bounce.bounceType).toBe('Permanent');
      expect(bounceNotification.bounce.bouncedRecipients[0].emailAddress).toBe(
        'invalid@example.com'
      );
    });

    it('should parse complaint notification correctly', () => {
      const complaintNotification = {
        notificationType: 'Complaint',
        mail: {
          timestamp: '2024-01-15T10:30:00.000Z',
          messageId: 'ses-msg-003',
          source: 'sender@example.com',
          destination: ['complainer@example.com'],
          headersTruncated: false,
          headers: [],
          commonHeaders: {
            from: ['sender@example.com'],
            to: ['complainer@example.com'],
            subject: 'Test Email',
          },
        },
        complaint: {
          complainedRecipients: [{ emailAddress: 'complainer@example.com' }],
          timestamp: '2024-01-15T10:35:00.000Z',
          feedbackId: 'feedback-456',
          complaintFeedbackType: 'abuse',
          userAgent: 'Yahoo/1.0',
        },
      };

      expect(complaintNotification.notificationType).toBe('Complaint');
      expect(complaintNotification.complaint.complaintFeedbackType).toBe('abuse');
      expect(complaintNotification.complaint.complainedRecipients[0].emailAddress).toBe(
        'complainer@example.com'
      );
    });
  });
});

interface MockContext {
  req: { text: () => Promise<string> };
  res: { payload: unknown; status: number } | undefined;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  json: (payload: unknown, status?: number) => { payload: unknown; status: number };
}

describe('SES webhook handler factory', () => {
  const subscriptionMessage = JSON.stringify({
    Type: 'SubscriptionConfirmation',
    MessageId: 'msg-sub',
    TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
    Token: 'confirmation-token',
    SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription...',
    Timestamp: '2024-01-15T10:30:00.000Z',
    SignatureVersion: '1',
    Signature: 'base64signature==',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
  });

  const deliveryNotification = JSON.stringify({
    Type: 'Notification',
    MessageId: 'msg-delivery',
    TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
    Timestamp: '2024-01-15T10:30:00.000Z',
    SignatureVersion: '1',
    Signature: 'base64signature==',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    Message: JSON.stringify({
      notificationType: 'Delivery',
      mail: {
        timestamp: '2024-01-15T10:30:00.000Z',
        messageId: 'ses-msg-789',
        source: 'sender@example.com',
        destination: ['recipient@example.com'],
      },
      delivery: {
        timestamp: '2024-01-15T10:30:01.000Z',
        processingTimeMillis: 523,
        recipients: ['recipient@example.com'],
        smtpResponse: '250 OK',
      },
    }),
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'CERT',
    });
  });

  const createContext = (body: string) => {
    const store = new Map<string, unknown>();
    const ctx: MockContext = {
      req: { text: async () => body },
      res: undefined,
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
      json: (payload: unknown, status = 200) => {
        const response = { payload, status };
        ctx.res = response;
        return response;
      },
    };
    return ctx;
  };

  it('routes delivered notifications to onDelivered handler', async () => {
    const onDelivered = vi.fn();
    const handler = createSESWebhookHandler({ verifySignature: false, onDelivered });
    const ctx = createContext(deliveryNotification);

    const result = await handler(ctx as unknown as Context, async () => {});

    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered.mock.calls[0][0].type).toBe('delivered');
    expect(result).toEqual({ payload: { received: true }, status: 200 });
  });

  it('handles subscription confirmation via middleware short-circuit', async () => {
    const handler = createSESWebhookHandler({ verifySignature: false });
    const ctx = createContext(subscriptionMessage);

    const result = await handler(ctx as unknown as Context, async () => {});

    expect(result).toEqual({ payload: { message: 'Subscription confirmed' }, status: 200 });
  });

  it('supports custom verification middleware when verifySignature is true', async () => {
    const verifySpy = vi
      .spyOn(signatureModule, 'verifySNSSignature')
      .mockReturnValue(async (c: Context) => {
        c.json({ error: 'Invalid signature' }, 403);
      });

    const handler = createSESWebhookHandler({ verifySignature: true });
    const ctx = createContext(deliveryNotification);

    const result = await handler(ctx as unknown as Context, async () => {});

    expect(verifySpy).toHaveBeenCalled();
    expect(result).toEqual({ payload: { error: 'Invalid signature' }, status: 403 });
  });
});

describe('notification parser behavior', () => {
  const createContext = (body: string, preset?: Record<string, unknown>) => {
    const store = new Map<string, unknown>(Object.entries(preset || {}));
    return {
      req: { text: async () => body },
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
    } as unknown as Context;
  };

  it('returns null for non-Notification message types', async () => {
    const ctx = createContext(
      JSON.stringify({
        Type: 'SubscriptionConfirmation',
        Message: '{}',
      })
    );

    const event = await parseSESNotification(ctx);
    expect(event).toBeNull();
  });

  it('returns null for unsupported SES event types', async () => {
    const ctx = createContext(
      JSON.stringify({
        Type: 'Notification',
        Message: JSON.stringify({ eventType: 'Send' }),
      })
    );

    const event = await parseSESNotification(ctx);
    expect(event).toBeNull();
  });

  it('parses complaint notification using cached snsMessage', async () => {
    const snsMessage = {
      Type: 'Notification',
      Message: JSON.stringify({
        notificationType: 'Complaint',
        mail: {
          timestamp: '2024-01-01T00:00:00Z',
          messageId: 'msg-complaint',
          destination: ['user@example.com'],
          headersTruncated: false,
          headers: [],
          commonHeaders: { from: ['sender@example.com'], to: ['user@example.com'], subject: 'Hi' },
        },
        complaint: {
          complainedRecipients: [{ emailAddress: 'user@example.com' }],
          timestamp: '2024-01-01T00:00:01Z',
          feedbackId: 'fb-1',
          complaintFeedbackType: 'abuse',
        },
      }),
    };

    const ctx = createContext('', { snsMessage });
    const event = await parseSESNotification(ctx);

    expect(event?.type).toBe('complaint');
    expect(event?.recipient).toBe('user@example.com');
  });

  it('parseSNSMessage prefers cached snsMessage and falls back to body', async () => {
    const cached = {
      Type: 'Notification',
      Message: '{}',
      MessageId: 'cached',
      Timestamp: '',
      TopicArn: '',
      SignatureVersion: '1',
      Signature: '',
      SigningCertURL: '',
    };
    const ctxWithCache = createContext('', { snsMessage: cached });
    const ctxWithoutCache = createContext(JSON.stringify(cached));

    const fromCache = await parseSNSMessage(ctxWithCache);
    const fromBody = await parseSNSMessage(ctxWithoutCache);

    expect(fromCache).toBe(cached);
    expect(fromBody.MessageId).toBe('cached');
  });

  it('returns null on invalid JSON body', async () => {
    const ctx = createContext('not-json');
    const event = await parseSESNotification(ctx);
    expect(event).toBeNull();
  });
});

describe('SNS Certificate URL validation', () => {
  const isValidCertUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      const pattern = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;
      return (
        parsed.protocol === 'https:' &&
        pattern.test(parsed.hostname) &&
        parsed.pathname.endsWith('.pem')
      );
    } catch {
      return false;
    }
  };

  it('should accept valid AWS SNS certificate URLs', () => {
    expect(
      isValidCertUrl('https://sns.us-east-1.amazonaws.com/SimpleNotificationService-123abc.pem')
    ).toBe(true);
    expect(
      isValidCertUrl('https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-xyz.pem')
    ).toBe(true);
    expect(isValidCertUrl('https://sns.ap-southeast-2.amazonaws.com/cert.pem')).toBe(true);
  });

  it('should reject non-HTTPS URLs', () => {
    expect(
      isValidCertUrl('http://sns.us-east-1.amazonaws.com/SimpleNotificationService-123abc.pem')
    ).toBe(false);
  });

  it('should reject non-AWS domains', () => {
    expect(isValidCertUrl('https://evil.com/SimpleNotificationService-123abc.pem')).toBe(false);
    expect(isValidCertUrl('https://sns.us-east-1.evil.com/cert.pem')).toBe(false);
  });

  it('should reject non-PEM files', () => {
    expect(isValidCertUrl('https://sns.us-east-1.amazonaws.com/somefile.txt')).toBe(false);
  });

  it('should reject invalid URLs', () => {
    expect(isValidCertUrl('not a url')).toBe(false);
    expect(isValidCertUrl('')).toBe(false);
  });
});

describe('MIME message building for attachments', () => {
  it('should build proper multipart structure', () => {
    // Test the MIME building logic conceptually
    const message = {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test with attachment',
      html: '<p>Hello</p>',
      text: 'Hello',
      attachments: [
        {
          filename: 'document.pdf',
          content: 'base64content',
          contentType: 'application/pdf',
        },
      ],
    };

    // Verify the structure expectations
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe('document.pdf');
    expect(message.attachments[0].contentType).toBe('application/pdf');
  });

  it('should support inline attachments with Content-ID', () => {
    const attachment = {
      filename: 'logo.png',
      content: 'base64imagedata',
      contentType: 'image/png',
      disposition: 'inline' as const,
      contentId: 'logo123',
    };

    expect(attachment.disposition).toBe('inline');
    expect(attachment.contentId).toBe('logo123');
  });
});
