import type { Context, MiddlewareHandler } from 'hono';
import { createLogger } from '../../utils/logger.js';
import { parseSESNotification } from './notification-parser.js';
import { verifySNSSignature } from './signature-verification.js';
import { handleSNSSubscription } from './subscription-handler.js';
import type {
  BouncedEvent,
  ComplaintEvent,
  CreateWebhookHandlerOptions,
  DeliveredEvent,
  SESEvent,
} from './types.js';

const logger = createLogger('SES Webhook');

/**
 * Creates a complete SES webhook handler with signature verification,
 * subscription handling, and event parsing.
 *
 * This is a convenience factory that combines the individual middleware
 * components. For more control, use the individual utilities directly.
 *
 * @example
 * ```typescript
 * import { createSESWebhookHandler } from 'glasswork';
 *
 * router.post('/webhooks/ses',
 *   createSESWebhookHandler({
 *     onDelivered: async (event, c) => {
 *       const logger = c.get('logger');
 *       logger.info({ messageId: event.messageId }, 'Email delivered');
 *       await db.email.update({
 *         where: { messageId: event.messageId },
 *         data: { status: 'DELIVERED', deliveredAt: event.timestamp },
 *       });
 *     },
 *     onBounced: async (event, c) => {
 *       await db.email.update({
 *         where: { messageId: event.messageId },
 *         data: { status: 'BOUNCED', bounceType: event.bounceType },
 *       });
 *     },
 *     onComplaint: async (event, c) => {
 *       await db.email.update({
 *         where: { messageId: event.messageId },
 *         data: { status: 'COMPLAINT' },
 *       });
 *     },
 *   })
 * );
 * ```
 */
export function createSESWebhookHandler(
  options: CreateWebhookHandlerOptions = {}
): MiddlewareHandler {
  const {
    verifySignature = process.env.NODE_ENV === 'production',
    signatureOptions,
    onDelivered,
    onBounced,
    onComplaint,
  } = options;

  return async (c, _next) => {
    // Step 1: Verify signature (optional, enabled by default in production)
    const verifyResult = await handleSignatureVerification(c, verifySignature, signatureOptions);
    if (verifyResult) return verifyResult;

    // Step 2: Handle subscription confirmations
    const subscriptionResult = await handleSubscriptionConfirmation(c);
    if (subscriptionResult) return subscriptionResult;

    // Step 3: Parse the SES event
    const event = await parseSESNotification(c);
    if (!event) {
      // Not an SES notification we handle (e.g., Send event)
      return c.json({ received: true }, 200);
    }

    // Step 4: Route to the appropriate handler
    await routeSESEvent(event, c, { onDelivered, onBounced, onComplaint });

    return c.json({ received: true }, 200);
  };
}

/**
 * Handles signature verification step
 */
async function handleSignatureVerification(
  c: Context,
  verifySignature: boolean,
  signatureOptions?: Parameters<typeof verifySNSSignature>[0]
): Promise<Response | undefined> {
  if (verifySignature) {
    const verifyMiddleware = verifySNSSignature(signatureOptions);
    return await runMiddleware(verifyMiddleware, c);
  }

  // Still parse the body even without verification
  try {
    const body = await c.req.text();
    c.set('snsMessageRaw', body);
    c.set('snsMessage', JSON.parse(body));
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  return undefined;
}

/**
 * Handles subscription confirmation step
 */
async function handleSubscriptionConfirmation(c: Context): Promise<Response | undefined> {
  const subscriptionMiddleware = handleSNSSubscription();
  return await runMiddleware(subscriptionMiddleware, c);
}

/**
 * Routes SES events to appropriate handlers
 */
async function routeSESEvent(
  event: SESEvent,
  c: Context,
  handlers: {
    onDelivered?: (event: DeliveredEvent, c: Context) => Promise<void> | void;
    onBounced?: (event: BouncedEvent, c: Context) => Promise<void> | void;
    onComplaint?: (event: ComplaintEvent, c: Context) => Promise<void> | void;
  }
): Promise<void> {
  try {
    switch (event.type) {
      case 'delivered':
        if (handlers.onDelivered) {
          await handlers.onDelivered(event, c);
        }
        break;
      case 'bounced':
        if (handlers.onBounced) {
          await handlers.onBounced(event, c);
        }
        break;
      case 'complaint':
        if (handlers.onComplaint) {
          await handlers.onComplaint(event, c);
        }
        break;
    }
  } catch (error) {
    logger.error('Handler error:', error);
    // Don't fail the request - we don't want SNS to retry indefinitely
    // The error is logged and can be tracked
  }
}

/**
 * Helper to run middleware and capture early responses
 */
async function runMiddleware(
  middleware: MiddlewareHandler,
  c: Context
): Promise<Response | undefined> {
  let earlyResponse: Response | undefined;
  let nextCalled = false;

  await middleware(c, async () => {
    nextCalled = true;
  });

  // Check if middleware returned early (didn't call next)
  if (!nextCalled) {
    // The middleware returned a response
    earlyResponse = c.res;
  }

  return earlyResponse;
}
