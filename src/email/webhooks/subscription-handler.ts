import type { Context, MiddlewareHandler } from 'hono';
import { createLogger } from '../../utils/logger.js';
import type { SNSMessage } from './types.js';

const logger = createLogger('SNS');

/**
 * Options for SNS subscription handling
 */
export interface HandleSubscriptionOptions {
  /** Custom fetch function for testing */
  fetchFn?: typeof fetch;
  /** Whether to auto-confirm subscriptions (default: true) */
  autoConfirm?: boolean;
}

/**
 * Middleware that automatically handles SNS subscription confirmations.
 *
 * When AWS SNS first sends notifications to an endpoint, it sends a
 * SubscriptionConfirmation message that must be confirmed by visiting
 * the SubscribeURL. This middleware handles that automatically.
 *
 * Should be used after `verifySNSSignature()` to ensure the confirmation
 * request is genuine.
 *
 * @example
 * ```typescript
 * import { verifySNSSignature, handleSNSSubscription } from 'glasswork';
 *
 * router.post('/webhooks/ses',
 *   verifySNSSignature(),
 *   handleSNSSubscription(),
 *   async (c) => {
 *     // This only runs for actual notifications, not subscription confirmations
 *     const event = await parseSESNotification(c);
 *     // ...
 *   }
 * );
 * ```
 */
export function handleSNSSubscription(options: HandleSubscriptionOptions = {}): MiddlewareHandler {
  const { fetchFn = fetch, autoConfirm = true } = options;

  return async (c, next) => {
    const message = await getSNSMessage(c);
    if (!message) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Handle subscription confirmation
    if (message.Type === 'SubscriptionConfirmation') {
      const result = await handleSubscriptionConfirmation(c, message, autoConfirm, fetchFn);
      if (result) return result;
    }

    // Handle unsubscribe confirmation
    if (message.Type === 'UnsubscribeConfirmation') {
      return handleUnsubscribeConfirmation(c, message);
    }

    // For regular notifications, continue to the next handler
    await next();
  };
}

/**
 * Gets SNS message from context or parses from body
 */
async function getSNSMessage(c: Context): Promise<SNSMessage | null> {
  let message: SNSMessage | undefined = c.get('snsMessage') as SNSMessage | undefined;

  if (!message) {
    try {
      const body = await c.req.text();
      message = JSON.parse(body) as SNSMessage;
    } catch {
      return null;
    }
  }

  return message;
}

/**
 * Handles subscription confirmation
 */
async function handleSubscriptionConfirmation(
  c: Context,
  message: SNSMessage,
  autoConfirm: boolean,
  fetchFn: typeof fetch
): Promise<Response | null> {
  if (!autoConfirm) {
    logger.info('Subscription confirmation received but auto-confirm disabled');
    return c.json({ message: 'Subscription confirmation received' }, 200);
  }

  if (!message.SubscribeURL) {
    logger.error('Subscription confirmation missing SubscribeURL');
    return c.json({ error: 'Missing SubscribeURL' }, 400);
  }

  try {
    logger.info('Confirming subscription to:', message.TopicArn);
    const response = await fetchFn(message.SubscribeURL);

    if (!response.ok) {
      logger.error('Failed to confirm subscription:', response.status);
      return c.json({ error: 'Failed to confirm subscription' }, 500);
    }

    logger.info('Subscription confirmed successfully');
    return c.json({ message: 'Subscription confirmed' }, 200);
  } catch (error) {
    logger.error('Error confirming subscription:', error);
    return c.json({ error: 'Failed to confirm subscription' }, 500);
  }
}

/**
 * Handles unsubscribe confirmation
 */
function handleUnsubscribeConfirmation(c: Context, message: SNSMessage): Response {
  logger.info('Unsubscribe confirmation received for:', message.TopicArn);
  return c.json({ message: 'Unsubscribe confirmation received' }, 200);
}
