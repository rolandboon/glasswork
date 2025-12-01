import type { MiddlewareHandler } from 'hono';
import type { SNSMessage } from './types.js';

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
    // Get the message from context (set by verifySNSSignature)
    // or parse it from the body
    let message: SNSMessage | undefined = c.get('snsMessage') as SNSMessage | undefined;

    if (!message) {
      try {
        const body = await c.req.text();
        message = JSON.parse(body) as SNSMessage;
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
    }

    // Handle subscription confirmation
    if (message.Type === 'SubscriptionConfirmation') {
      if (!autoConfirm) {
        console.log('[SNS] Subscription confirmation received but auto-confirm disabled');
        return c.json({ message: 'Subscription confirmation received' }, 200);
      }

      if (!message.SubscribeURL) {
        console.error('[SNS] Subscription confirmation missing SubscribeURL');
        return c.json({ error: 'Missing SubscribeURL' }, 400);
      }

      try {
        console.log('[SNS] Confirming subscription to:', message.TopicArn);
        const response = await fetchFn(message.SubscribeURL);

        if (!response.ok) {
          console.error('[SNS] Failed to confirm subscription:', response.status);
          return c.json({ error: 'Failed to confirm subscription' }, 500);
        }

        console.log('[SNS] Subscription confirmed successfully');
        return c.json({ message: 'Subscription confirmed' }, 200);
      } catch (error) {
        console.error('[SNS] Error confirming subscription:', error);
        return c.json({ error: 'Failed to confirm subscription' }, 500);
      }
    }

    // Handle unsubscribe confirmation
    if (message.Type === 'UnsubscribeConfirmation') {
      console.log('[SNS] Unsubscribe confirmation received for:', message.TopicArn);
      return c.json({ message: 'Unsubscribe confirmation received' }, 200);
    }

    // For regular notifications, continue to the next handler
    await next();
  };
}
