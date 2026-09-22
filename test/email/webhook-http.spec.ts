import { generateKeyPairSync, sign } from 'node:crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSESWebhookHandler } from '../../src/email/webhooks/handler-factory.js';
import {
  buildStringToSign,
  clearCertCache,
} from '../../src/email/webhooks/signature-verification.js';
import type { SNSMessage } from '../../src/email/webhooks/types.js';

const topic = 'arn:aws:sns:eu-west-1:123456789012:events';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certificate = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
function message(type: SNSMessage['Type'] = 'Notification'): SNSMessage {
  const value: SNSMessage = {
    Type: type,
    MessageId: 'sns-id',
    TopicArn: topic,
    Timestamp: '2026-01-01T00:00:00Z',
    SignatureVersion: '2',
    Signature: '',
    SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    Token: 'token',
    SubscribeURL: `https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=token&TopicArn=${encodeURIComponent(topic)}`,
    Message: JSON.stringify({
      notificationType: 'Delivery',
      mail: {
        messageId: 'ses-id',
        timestamp: '2026-01-01T00:00:00Z',
        source: 'from@example.com',
        destination: ['to@example.com'],
      },
      delivery: {
        timestamp: '2026-01-01T00:00:00Z',
        recipients: ['to@example.com'],
        smtpResponse: '250 OK',
        processingTimeMillis: 1,
      },
    }),
  };
  value.Signature = sign('SHA256', Buffer.from(buildStringToSign(value)), keys.privateKey).toString(
    'base64'
  );
  return value;
}
function appWith(options: Parameters<typeof createSESWebhookHandler>[0] = {}) {
  const app = new Hono();
  app.post(
    '/',
    createSESWebhookHandler({
      allowedTopicArns: [topic],
      signatureOptions: { fetchFn: async () => new Response(certificate) },
      ...options,
    })
  );
  return app;
}
function send(app: Hono, value: SNSMessage) {
  return app.request('/', { method: 'POST', body: JSON.stringify(value) });
}

describe('SES webhook HTTP responses', () => {
  beforeEach(clearCertCache);
  it('preserves signature rejection responses', async () => {
    const callback = vi.fn();
    const value = message();
    value.SignatureVersion = '9';
    const response = await send(appWith({ onDelivered: callback }), value);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unsupported signature version' });
    value.SignatureVersion = '2';
    value.Signature = 'invalid';
    expect((await send(appWith({ onDelivered: callback }), value)).status).toBe(403);
    expect(callback).not.toHaveBeenCalled();
  });
  it('preserves certificate and subscription failures', async () => {
    const app = appWith({
      signatureOptions: { fetchFn: async () => new Response('', { status: 503 }) },
    });
    expect((await send(app, message())).status).toBe(500);
    const subscriptionApp = appWith({
      subscriptionOptions: { fetchFn: async () => new Response('', { status: 503 }) },
    });
    expect((await send(subscriptionApp, message('SubscriptionConfirmation'))).status).toBe(500);
  });
  it('acknowledges a successfully confirmed subscription', async () => {
    const fetchFn = vi.fn(async () => new Response('confirmed'));
    const response = await send(
      appWith({ subscriptionOptions: { fetchFn } }),
      message('SubscriptionConfirmation')
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'Subscription confirmed' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
  it('returns 503 after callback failure and acknowledges a successful retry', async () => {
    const callback = vi
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(undefined);
    const app = appWith({ onDelivered: callback });
    const value = message();
    const failure = await send(app, value);
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ error: 'Event processing failed' });
    const retry = await send(app, value);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ received: true });
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
