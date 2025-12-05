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
    // Mock fetch for certificate retrieval
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'CERT',
    });
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

    const middleware = verifySNSSignature();
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
});
