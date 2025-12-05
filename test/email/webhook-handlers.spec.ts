import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSESWebhookHandler } from '../../src/email/webhooks/handler-factory.js';
import {
  parseSESNotification,
  parseSNSMessage,
} from '../../src/email/webhooks/notification-parser.js';
import {
  clearCertCache,
  verifySNSSignature,
} from '../../src/email/webhooks/signature-verification.js';
import { handleSNSSubscription } from '../../src/email/webhooks/subscription-handler.js';
import type { BouncedEvent, ComplaintEvent, SNSMessage } from '../../src/email/webhooks/types.js';

/**
 * Creates a mock Hono context for testing
 */
function createMockContext(body: string | object): Context {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  const contextData = new Map<string, unknown>();

  return {
    req: {
      text: async () => bodyText,
      json: async () => (typeof body === 'object' ? body : JSON.parse(bodyText)),
    },
    json: vi.fn((data: unknown, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
    get: (key: string) => contextData.get(key),
    set: (key: string, value: unknown) => {
      contextData.set(key, value);
    },
    res: new Response(),
  } as unknown as Context;
}

describe('parseSESNotification', () => {
  it('should parse delivery notification', async () => {
    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: JSON.stringify({
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
          smtpResponse: '250 OK',
        },
      }),
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const event = await parseSESNotification(c);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('delivered');
    expect(event?.messageId).toBe('ses-msg-001');
    expect(event?.recipient).toBe('recipient@example.com');
  });

  it('should parse bounce notification', async () => {
    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-456',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: JSON.stringify({
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
      }),
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const event = await parseSESNotification(c);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('bounced');
    expect(event?.messageId).toBe('ses-msg-002');
    expect((event as BouncedEvent)?.bounceType).toBe('permanent');
  });

  it('should parse complaint notification', async () => {
    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-789',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: JSON.stringify({
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
      }),
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const event = await parseSESNotification(c);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('complaint');
    expect(event?.messageId).toBe('ses-msg-003');
    expect((event as ComplaintEvent)?.complaintType).toBe('abuse');
  });

  it('should return null for non-notification messages', async () => {
    const snsMessage: SNSMessage = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-sub',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Token: 'token',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      Message: '',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const event = await parseSESNotification(c);

    expect(event).toBeNull();
  });

  it('should parse message from body if not in context', async () => {
    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: JSON.stringify({
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
          smtpResponse: '250 OK',
        },
      }),
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);

    const event = await parseSESNotification(c);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('delivered');
  });
});

describe('parseSNSMessage', () => {
  it('should parse SNS message from context', async () => {
    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const result = await parseSNSMessage(c);

    expect(result.MessageId).toBe('msg-123');
    expect(result.Type).toBe('Notification');
  });

  it('should parse SNS message from body', async () => {
    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);

    const result = await parseSNSMessage(c);

    expect(result.MessageId).toBe('msg-123');
  });
});

describe('handleSNSSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle subscription confirmation with auto-confirm', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const snsMessage: SNSMessage = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-sub',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Token: 'token',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      Message: '',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const handler = handleSNSSubscription({ fetchFn: mockFetch, autoConfirm: true });
    const next = vi.fn();

    const result = await handler(c, next);

    expect(mockFetch).toHaveBeenCalledWith(snsMessage.SubscribeURL);
    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should handle subscription confirmation failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const snsMessage: SNSMessage = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-sub',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Token: 'token',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      Message: '',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const handler = handleSNSSubscription({ fetchFn: mockFetch, autoConfirm: true });
    const next = vi.fn();

    const result = await handler(c, next);

    expect(mockFetch).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should handle subscription confirmation network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const snsMessage: SNSMessage = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-sub',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Token: 'token',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      Message: '',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const handler = handleSNSSubscription({ fetchFn: mockFetch, autoConfirm: true });
    const next = vi.fn();

    const result = await handler(c, next);

    expect(mockFetch).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should handle missing SubscribeURL', async () => {
    const snsMessage: SNSMessage = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-sub',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Token: 'token',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      Message: '',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const handler = handleSNSSubscription({ autoConfirm: true });
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should handle invalid JSON when getting message from body', async () => {
    const c = createMockContext('invalid json');

    const handler = handleSNSSubscription({ autoConfirm: true });
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should skip confirmation when auto-confirm is disabled', async () => {
    const mockFetch = vi.fn();

    const snsMessage: SNSMessage = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-sub',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Token: 'token',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      Message: '',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const handler = handleSNSSubscription({ fetchFn: mockFetch, autoConfirm: false });
    const next = vi.fn();

    const result = await handler(c, next);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should handle unsubscribe confirmation', async () => {
    const snsMessage: SNSMessage = {
      Type: 'UnsubscribeConfirmation',
      MessageId: 'msg-unsub',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
      Message: '',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const handler = handleSNSSubscription();
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should continue to next handler for regular notifications', async () => {
    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-notif',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);

    const handler = handleSNSSubscription();
    const next = vi.fn();

    await handler(c, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('createSESWebhookHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCertCache();
  });

  it('should call onDelivered handler for delivery events', async () => {
    const onDelivered = vi.fn();
    const onBounced = vi.fn();
    const onComplaint = vi.fn();

    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: JSON.stringify({
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
          smtpResponse: '250 OK',
        },
      }),
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);
    c.set('snsMessageRaw', JSON.stringify(snsMessage));

    const handler = createSESWebhookHandler({
      verifySignature: false,
      onDelivered,
      onBounced,
      onComplaint,
    });

    await handler(c, vi.fn());

    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onBounced).not.toHaveBeenCalled();
    expect(onComplaint).not.toHaveBeenCalled();
  });

  it('should call onBounced handler for bounce events', async () => {
    const onDelivered = vi.fn();
    const onBounced = vi.fn();
    const onComplaint = vi.fn();

    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-456',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: JSON.stringify({
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
      }),
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);
    c.set('snsMessageRaw', JSON.stringify(snsMessage));

    const handler = createSESWebhookHandler({
      verifySignature: false,
      onDelivered,
      onBounced,
      onComplaint,
    });

    await handler(c, vi.fn());

    expect(onBounced).toHaveBeenCalledTimes(1);
    expect(onDelivered).not.toHaveBeenCalled();
    expect(onComplaint).not.toHaveBeenCalled();
  });

  it('should handle handler errors gracefully', async () => {
    const onDelivered = vi.fn().mockRejectedValue(new Error('Handler failed'));

    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: JSON.stringify({
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
          smtpResponse: '250 OK',
        },
      }),
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);
    c.set('snsMessageRaw', JSON.stringify(snsMessage));

    const handler = createSESWebhookHandler({
      verifySignature: false,
      onDelivered,
    });

    // Should not throw
    await expect(handler(c, vi.fn())).resolves.toBeDefined();
  });

  it('should call onComplaint handler for complaint events', async () => {
    const onDelivered = vi.fn();
    const onBounced = vi.fn();
    const onComplaint = vi.fn();

    const snsMessage: SNSMessage = {
      Type: 'Notification',
      MessageId: 'msg-789',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: JSON.stringify({
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
        },
      }),
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    c.set('snsMessage', snsMessage);
    c.set('snsMessageRaw', JSON.stringify(snsMessage));

    const handler = createSESWebhookHandler({
      verifySignature: false,
      onDelivered,
      onBounced,
      onComplaint,
    });

    await handler(c, vi.fn());

    expect(onComplaint).toHaveBeenCalledTimes(1);
    expect(onDelivered).not.toHaveBeenCalled();
    expect(onBounced).not.toHaveBeenCalled();
  });

  it('should handle invalid JSON when verifySignature is false', async () => {
    const c = createMockContext('invalid json');

    const handler = createSESWebhookHandler({
      verifySignature: false,
    });

    const result = await handler(c, vi.fn());

    expect(result).toBeDefined();
  });
});

describe('verifySNSSignature', () => {
  beforeEach(() => {
    clearCertCache();
  });

  it('should reject invalid JSON body', async () => {
    const c = createMockContext('invalid json');
    const handler = verifySNSSignature();
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should reject unsupported signature version', async () => {
    const snsMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '2',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    const handler = verifySNSSignature();
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should reject invalid certificate URL', async () => {
    const snsMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://evil.com/cert.pem',
    };

    const c = createMockContext(snsMessage);
    const handler = verifySNSSignature();
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should reject certificate URL without .pem extension', async () => {
    const snsMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.crt',
    };

    const c = createMockContext(snsMessage);
    const handler = verifySNSSignature();
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should reject certificate URL without https', async () => {
    const snsMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'http://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    const handler = verifySNSSignature();
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should handle certificate fetch failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const snsMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'base64signature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    const handler = verifySNSSignature({ fetchFn: mockFetch });
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('should reject invalid signature', async () => {
    // Mock certificate (self-signed for testing)
    const mockCert = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4P6JK3TANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
o5e7VkI7TyDPfLLsKvPPfuHqMIkVMVIPBEwJFPBJkjIVvbLkVYJqSyIqYJBCjDJh
a0QjFEJSJ0HlVHTvnJlJHSqFc5c7uHGLKM8R0Q6L7nZNFCVVnPREE0LR2LNxHgd0
DPAf8WOKIEvXbQJxAcL6EIgF8T8GvQZJ0LBJkGJLVSZV3WJZ3aJGi8VzVjKFSSPM
PqXa0lbL6FdFzF0LL7E3fHDqNDzXlr/O5RVSE8ZWLsC3yH8kZNL8R9pD8C0qJQ8Z
KOJn/xMxAE3HqLlxLV8H+JpQgL8zQJLEH3VzJwPJBQKZWqLm7D3H9A0RVNFJ7C0L
y8vJ4QmDpN0C3WQvAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAEDjE3TJ8TnhCo5K
-----END CERTIFICATE-----`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockCert,
    });

    const snsMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test message',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'invalidsignature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    const handler = verifySNSSignature({ fetchFn: mockFetch });
    const next = vi.fn();

    const result = await handler(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should cache fetched certificates', async () => {
    const mockCert = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4P6JK3TANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
-----END CERTIFICATE-----`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockCert,
    });

    const snsMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Message: 'test message',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'invalidsignature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c1 = createMockContext(snsMessage);
    const c2 = createMockContext(snsMessage);
    const handler = verifySNSSignature({ fetchFn: mockFetch });
    const next = vi.fn();

    // First request - should fetch certificate
    await handler(c1, next);

    // Second request - should use cached certificate
    await handler(c2, next);

    // Certificate should only be fetched once due to caching
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should build string to sign with Subject field', async () => {
    const mockCert = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4P6JK3TANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
-----END CERTIFICATE-----`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockCert,
    });

    const snsMessage = {
      Type: 'Notification',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      Subject: 'Test Subject',
      Message: 'test message',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'invalidsignature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    const handler = verifySNSSignature({ fetchFn: mockFetch });
    const next = vi.fn();

    await handler(c, next);

    expect(mockFetch).toHaveBeenCalled();
  });

  it('should build string to sign with SubscribeURL field', async () => {
    const mockCert = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4P6JK3TANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
-----END CERTIFICATE-----`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockCert,
    });

    const snsMessage = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-123',
      TopicArn: 'arn:aws:sns:us-east-1:123456789:ses-notifications',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      Message: 'test message',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SignatureVersion: '1',
      Signature: 'invalidsignature==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xxx.pem',
    };

    const c = createMockContext(snsMessage);
    const handler = verifySNSSignature({ fetchFn: mockFetch });
    const next = vi.fn();

    await handler(c, next);

    expect(mockFetch).toHaveBeenCalled();
  });
});
