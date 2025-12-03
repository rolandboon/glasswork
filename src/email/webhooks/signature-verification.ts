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
      parsed.pathname.endsWith('.pem')
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
  const cached = certCache.get(certUrl);

  if (cached && cached.expiresAt > now) {
    return cached.cert;
  }

  const fetchFn = options.fetchFn || fetch;
  const response = await fetchFn(certUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch SNS certificate: ${response.status}`);
  }

  const cert = await response.text();
  const ttl = options.certCacheTTL ?? DEFAULT_CERT_CACHE_TTL;

  certCache.set(certUrl, {
    cert,
    expiresAt: now + ttl,
  });

  return cert;
}

/**
 * Builds the string to sign for SNS message verification
 */
function buildStringToSign(message: SNSMessage): string {
  const fields: string[] = [];

  // Fields must be in alphabetical order
  fields.push('Message', message.Message);
  fields.push('MessageId', message.MessageId);

  if (message.Subject) {
    fields.push('Subject', message.Subject);
  }

  if (message.SubscribeURL) {
    fields.push('SubscribeURL', message.SubscribeURL);
  }

  fields.push('Timestamp', message.Timestamp);
  fields.push('Token', message.Token || '');
  fields.push('TopicArn', message.TopicArn);
  fields.push('Type', message.Type);

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
    // SNS uses SHA-1 for SignatureVersion 1
    const verify = createVerify('SHA1');
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
 * import { verifySNSSignature } from 'glasswork';
 *
 * router.post('/webhooks/ses',
 *   verifySNSSignature(),
 *   async (c) => {
 *     // Message is verified to be from AWS SNS
 *     const body = await c.req.json();
 *     // ...
 *   }
 * );
 * ```
 */
export function verifySNSSignature(options: VerifySignatureOptions = {}): MiddlewareHandler {
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
    if (message.SignatureVersion !== '1') {
      return c.json({ error: 'Unsupported signature version' }, 400);
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
