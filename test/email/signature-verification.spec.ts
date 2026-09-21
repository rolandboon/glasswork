import { createVerify } from 'node:crypto';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateMock = vi.fn();
const verifyMock = vi.fn().mockReturnValue(true);
const endMock = vi.fn();

vi.mock('node:crypto', () => ({
  createPublicKey: vi.fn(() => 'public-key'),
  createVerify: vi.fn(() => ({
    update: updateMock,
    end: endMock,
    verify: verifyMock,
  })),
}));

import {
  buildStringToSign,
  clearCertCache,
  verifySNSSignature,
} from '../../src/email/webhooks/signature-verification.js';

function createContext(body: string) {
  const store = new Map<string, unknown>();
  return {
    req: {
      text: async () => body,
    },
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
    },
    json: (payload: unknown, status = 200) => ({ payload, status }),
    res: undefined as unknown,
  };
}

describe('SNS signature canonicalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCertCache();
    // Mock fetch for certificate retrieval
    global.fetch = vi.fn().mockImplementation(async () => new Response('CERT'));
  });

  it('builds canonical string for notification messages', () => {
    const notification = {
      Type: 'Notification' as const,
      Message: 'Hello',
      MessageId: 'msg-123',
      Subject: 'Subject line',
      Timestamp: '2024-01-01T00:00:00Z',
      TopicArn: 'arn:aws:sns:us-east-1:123:topic',
      SignatureVersion: '1',
      Signature: 'signature',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    };

    const stringToSign = buildStringToSign(notification);

    expect(stringToSign).toBe(
      'Message\nHello\n' +
        'MessageId\nmsg-123\n' +
        'Subject\nSubject line\n' +
        'Timestamp\n2024-01-01T00:00:00Z\n' +
        'TopicArn\narn:aws:sns:us-east-1:123:topic\n' +
        'Type\nNotification\n'
    );
  });

  it('builds canonical string for subscription confirmation messages', () => {
    const subscription = {
      Type: 'SubscriptionConfirmation' as const,
      Message: 'Please confirm',
      MessageId: 'msg-456',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/confirm',
      Token: 'token-abc',
      Timestamp: '2024-01-01T00:00:01Z',
      TopicArn: 'arn:aws:sns:us-east-1:123:topic',
      SignatureVersion: '1',
      Signature: 'signature',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    };

    const stringToSign = buildStringToSign(subscription);

    expect(stringToSign).toBe(
      'Message\nPlease confirm\n' +
        'MessageId\nmsg-456\n' +
        'SubscribeURL\nhttps://sns.us-east-1.amazonaws.com/confirm\n' +
        'Timestamp\n2024-01-01T00:00:01Z\n' +
        'Token\ntoken-abc\n' +
        'TopicArn\narn:aws:sns:us-east-1:123:topic\n' +
        'Type\nSubscriptionConfirmation\n'
    );
  });

  it('uses canonical string during verification', async () => {
    const message = {
      Type: 'Notification' as const,
      Message: 'Hello',
      MessageId: 'msg-789',
      Subject: 'Subject line',
      Timestamp: '2024-01-01T00:00:02Z',
      TopicArn: 'arn:aws:sns:us-east-1:123:topic',
      SignatureVersion: '1',
      Signature: 'signature',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    };

    const middleware = verifySNSSignature({ allowedTopicArns: [message.TopicArn] });
    let nextCalled = false;
    const ctx = createContext(JSON.stringify(message));

    await middleware(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      'Message\nHello\n' +
        'MessageId\nmsg-789\n' +
        'Subject\nSubject line\n' +
        'Timestamp\n2024-01-01T00:00:02Z\n' +
        'TopicArn\narn:aws:sns:us-east-1:123:topic\n' +
        'Type\nNotification\n'
    );
  });

  it('uses SHA-256 for signature version 2', async () => {
    const message = {
      Type: 'Notification' as const,
      Message: 'Hello',
      MessageId: 'msg-sha256',
      Timestamp: '2024-01-01T00:00:02Z',
      TopicArn: 'arn:aws:sns:us-east-1:123:topic',
      SignatureVersion: '2',
      Signature: 'signature',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    };

    const middleware = verifySNSSignature({ allowedTopicArns: [message.TopicArn] });

    await middleware(createContext(JSON.stringify(message)), async () => {});

    expect(createVerify).toHaveBeenCalledWith('SHA256');
  });
});

describe('certificate resource limits', () => {
  const topic = 'arn:aws:sns:eu-west-1:123456789012:events';
  function appFor(fetchFn: typeof fetch) {
    const app = new Hono();
    app.post('/', verifySNSSignature({ allowedTopicArns: [topic], fetchFn }), (c) => c.text('ok'));
    return app;
  }
  function request(app: Hono, path: string) {
    return app.request('/', {
      method: 'POST',
      body: JSON.stringify({
        Type: 'Notification',
        Message: 'test',
        MessageId: 'id',
        Timestamp: '2026-01-01',
        TopicArn: topic,
        SignatureVersion: '2',
        Signature: 'signature',
        SigningCertURL: `https://sns.eu-west-1.amazonaws.com/${path}.pem`,
      }),
    });
  }
  it('cancels oversized streams before buffering the whole response', async () => {
    clearCertCache();
    const cancel = vi.fn();
    const fetchFn = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(65537));
            },
            cancel,
          })
        )
    );
    expect((await request(appFor(fetchFn), 'large')).status).toBe(500);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('evicts certificates when the cache reaches capacity', async () => {
    clearCertCache();
    const fetchFn = vi.fn(async () => new Response('CERT'));
    const app = appFor(fetchFn);
    for (let i = 0; i < 101; i++) expect((await request(app, `cert-${i}`)).status).toBe(200);
    await request(app, 'cert-100');
    expect(fetchFn).toHaveBeenCalledTimes(101);
    await request(app, 'cert-0');
    expect(fetchFn).toHaveBeenCalledTimes(102);
  });
});
