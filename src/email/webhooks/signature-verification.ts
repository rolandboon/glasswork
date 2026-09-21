import { createPublicKey, createVerify } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { createLogger } from '../../utils/logger.js';
import type { SNSMessage, VerifySignatureOptions } from './types.js';

const logger = createLogger('SNS');

/**
 * Cache for SNS signing certificates
 */
const certCache = new Map<string, { cert: string; expiresAt: number }>();

/**
 * Default certificate cache TTL (1 hour)
 */
const DEFAULT_CERT_CACHE_TTL = 60 * 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const MAX_CERTIFICATE_LENGTH = 64 * 1024;
const MAX_CACHED_CERTIFICATES = 100;

/**
 * AWS SNS certificate domain pattern
 */
const SNS_CERT_DOMAIN_PATTERN = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

/**
 * Validates that a URL is a valid AWS SNS certificate URL
 */
function isValidCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      SNS_CERT_DOMAIN_PATTERN.test(parsed.hostname) &&
      parsed.pathname.endsWith('.pem') &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      (parsed.port === '' || parsed.port === '443')
    );
  } catch {
    return false;
  }
}

/**
 * Fetches the signing certificate from AWS
 */
async function fetchCertificate(certUrl: string, options: VerifySignatureOptions): Promise<string> {
  const now = Date.now();
  for (const [key, entry] of certCache) {
    if (entry.expiresAt <= now) certCache.delete(key);
  }
  const cached = certCache.get(certUrl);

  if (cached && cached.expiresAt > now) {
    return cached.cert;
  }

  const fetchFn = options.fetchFn || fetch;
  const response = await fetchFn(certUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch SNS certificate: ${response.status}`);
  }

  const cert = await readCertificate(response);
  const ttl = options.certCacheTTL ?? DEFAULT_CERT_CACHE_TTL;

  while (certCache.size >= MAX_CACHED_CERTIFICATES) {
    const oldest = certCache.keys().next().value;
    if (oldest !== undefined) certCache.delete(oldest);
  }
  certCache.set(certUrl, {
    cert,
    expiresAt: now + ttl,
  });

  return cert;
}

async function readCertificate(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty SNS signing certificate response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_CERTIFICATE_LENGTH) {
        await reader.cancel();
        throw new Error('SNS signing certificate is too large');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Builds the canonical string to sign for SNS message verification
 *
 * Ordering differs per message type:
 * - Notification: Message, MessageId, optional Subject, Timestamp, TopicArn, Type
 * - SubscriptionConfirmation/UnsubscribeConfirmation: Message, MessageId, SubscribeURL, Timestamp, Token, TopicArn, Type
 *
 * See: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */
export function buildStringToSign(message: SNSMessage): string {
  const fields: string[] = [];
  const append = (label: string, value: string | undefined) => {
    if (value === undefined) {
      throw new Error(`Missing required field "${label}" for SNS ${message.Type} message`);
    }
    fields.push(label, value);
  };

  append('Message', message.Message);
  append('MessageId', message.MessageId);

  if (message.Type === 'Notification') {
    if (message.Subject) {
      append('Subject', message.Subject);
    }
    append('Timestamp', message.Timestamp);
    append('TopicArn', message.TopicArn);
    append('Type', message.Type);
  } else if (
    message.Type === 'SubscriptionConfirmation' ||
    message.Type === 'UnsubscribeConfirmation'
  ) {
    append('SubscribeURL', message.SubscribeURL);
    append('Timestamp', message.Timestamp);
    append('Token', message.Token);
    append('TopicArn', message.TopicArn);
    append('Type', message.Type);
  } else {
    append('Timestamp', message.Timestamp);
    append('TopicArn', message.TopicArn);
    append('Type', message.Type);
  }

  return `${fields.join('\n')}\n`;
}

/**
 * Verifies the SNS message signature using Node.js crypto
 */
function verifySignature(message: SNSMessage, certificate: string): boolean {
  try {
    const stringToSign = buildStringToSign(message);
    // Extract public key from X.509 certificate
    const publicKey = createPublicKey(certificate);
    const algorithm = message.SignatureVersion === '2' ? 'SHA256' : 'SHA1';
    const verify = createVerify(algorithm);
    verify.update(stringToSign);
    verify.end();
    return verify.verify(publicKey, message.Signature, 'base64');
  } catch (error) {
    logger.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Middleware that verifies AWS SNS message signatures.
 *
 * Protects webhook endpoints from spoofed requests by validating
 * that messages are genuinely from AWS SNS.
 *
 * @example
 * ```typescript
 * import { verifySNSSignature } from 'glasswork/email';
 *
 * router.post('/webhooks/ses',
 *   verifySNSSignature({
 *     allowedTopicArns: ['arn:aws:sns:eu-west-1:123456789012:email-events'],
 *   }),
 *   async (c) => {
 *     // Message is verified to be from AWS SNS
 *     const body = await c.req.json();
 *     // ...
 *   }
 * );
 * ```
 */
export function verifySNSSignature(options: VerifySignatureOptions): MiddlewareHandler {
  if (options.allowedTopicArns.length === 0) {
    throw new Error('verifySNSSignature requires at least one allowed SNS topic ARN');
  }

  const allowedTopicArns = new Set(options.allowedTopicArns);

  return async (c, next) => {
    // Clone the request to read the body without consuming it
    const body = await c.req.text();

    let message: SNSMessage;
    try {
      message = JSON.parse(body) as SNSMessage;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Validate signature version
    if (message.SignatureVersion !== '1' && message.SignatureVersion !== '2') {
      return c.json({ error: 'Unsupported signature version' }, 400);
    }

    // A valid SNS signature only proves who signed the message. Restricting the
    // topic prevents other AWS customers from sending valid messages here.
    if (!allowedTopicArns.has(message.TopicArn)) {
      return c.json({ error: 'Unexpected SNS topic' }, 403);
    }

    // Validate certificate URL
    if (!isValidCertUrl(message.SigningCertURL)) {
      return c.json({ error: 'Invalid certificate URL' }, 400);
    }

    // Fetch and cache the certificate
    let certificate: string;
    try {
      certificate = await fetchCertificate(message.SigningCertURL, options);
    } catch (error) {
      logger.error('Failed to fetch certificate:', error);
      return c.json({ error: 'Failed to fetch signing certificate' }, 500);
    }

    // Verify the signature
    const isValid = verifySignature(message, certificate);

    if (!isValid) {
      logger.warn('Invalid signature for message:', message.MessageId);
      return c.json({ error: 'Invalid signature' }, 403);
    }

    // Store the parsed message for downstream handlers
    c.set('snsMessage', message);
    c.set('snsMessageRaw', body);

    await next();
  };
}

/**
 * Clears the certificate cache (useful for testing)
 */
export function clearCertCache(): void {
  certCache.clear();
}
