import type { Context } from 'hono';
import type {
  BouncedEvent,
  ComplaintEvent,
  DeliveredEvent,
  SESBounceNotification,
  SESComplaintNotification,
  SESDeliveryNotification,
  SESEvent,
  SESNotification,
  SNSMessage,
} from './types.js';

/**
 * Parses an SES notification from an SNS message.
 *
 * Returns null if the message is not a notification (e.g., subscription confirmation)
 * or if it's not an SES event we handle.
 *
 * @example
 * ```typescript
 * import { parseSESNotification, verifySNSSignature, handleSNSSubscription } from 'glasswork';
 *
 * router.post('/webhooks/ses',
 *   verifySNSSignature(),
 *   handleSNSSubscription(),
 *   async (c) => {
 *     const event = await parseSESNotification(c);
 *
 *     if (!event) {
 *       return c.json({ received: true });
 *     }
 *
 *     switch (event.type) {
 *       case 'delivered':
 *         console.log('Email delivered:', event.messageId);
 *         break;
 *       case 'bounced':
 *         console.log('Email bounced:', event.messageId, event.bounceType);
 *         break;
 *       case 'complaint':
 *         console.log('Complaint received:', event.messageId);
 *         break;
 *     }
 *
 *     return c.json({ received: true });
 *   }
 * );
 * ```
 */
export async function parseSESNotification(c: Context): Promise<SESEvent | null> {
  // Try to get the pre-parsed message from context
  let snsMessage: SNSMessage | undefined = c.get('snsMessage') as SNSMessage | undefined;

  if (!snsMessage) {
    // Parse from body
    try {
      const rawBody = c.get('snsMessageRaw') as string | undefined;
      const body = rawBody || (await c.req.text());
      snsMessage = JSON.parse(body) as SNSMessage;
    } catch {
      return null;
    }
  }

  // Only handle notifications
  if (snsMessage.Type !== 'Notification') {
    return null;
  }

  // Parse the inner SES notification
  let notification: Record<string, unknown>;
  try {
    notification = JSON.parse(snsMessage.Message) as Record<string, unknown>;
  } catch {
    console.error('[SES] Failed to parse notification message');
    return null;
  }

  // Route to the appropriate parser based on notification type
  // SES can use either notificationType (older) or eventType (newer format)
  const eventType =
    (notification.notificationType as string | undefined) ||
    (notification.eventType as string | undefined);

  switch (eventType) {
    case 'Delivery':
      return parseDeliveryNotification(notification as unknown as SESDeliveryNotification);
    case 'Bounce':
      return parseBounceNotification(notification as unknown as SESBounceNotification);
    case 'Complaint':
      return parseComplaintNotification(notification as unknown as SESComplaintNotification);
    default:
      // Send event is ignored (we track via onSent hook)
      return null;
  }
}

/**
 * Parses a delivery notification into a DeliveredEvent
 */
function parseDeliveryNotification(notification: SESDeliveryNotification): DeliveredEvent {
  const { mail, delivery } = notification;
  const recipient = delivery.recipients[0] || mail.destination[0];

  return {
    type: 'delivered',
    messageId: mail.messageId,
    timestamp: new Date(delivery.timestamp),
    recipient,
    processingTimeMs: delivery.processingTimeMillis,
    smtpResponse: delivery.smtpResponse,
    raw: notification,
  };
}

/**
 * Parses a bounce notification into a BouncedEvent
 */
function parseBounceNotification(notification: SESBounceNotification): BouncedEvent {
  const { mail, bounce } = notification;
  const recipient = bounce.bouncedRecipients[0]?.emailAddress || mail.destination[0];

  const bounceType: 'permanent' | 'transient' =
    bounce.bounceType === 'Permanent' ? 'permanent' : 'transient';

  // Build a human-readable reason
  const diagnosticCode = bounce.bouncedRecipients[0]?.diagnosticCode || 'Unknown reason';
  const reason = `${bounce.bounceSubType}: ${diagnosticCode}`;

  return {
    type: 'bounced',
    messageId: mail.messageId,
    timestamp: new Date(bounce.timestamp),
    recipient,
    bounceType,
    bounceSubType: bounce.bounceSubType,
    reason,
    raw: notification,
  };
}

/**
 * Parses a complaint notification into a ComplaintEvent
 */
function parseComplaintNotification(notification: SESComplaintNotification): ComplaintEvent {
  const { mail, complaint } = notification;
  const recipient = complaint.complainedRecipients[0]?.emailAddress || mail.destination[0];

  return {
    type: 'complaint',
    messageId: mail.messageId,
    timestamp: new Date(complaint.timestamp),
    recipient,
    complaintType: complaint.complaintFeedbackType || 'unknown',
    userAgent: complaint.userAgent,
    raw: notification,
  };
}

/**
 * Lower-level function to parse just the SNS message
 */
export async function parseSNSMessage(c: Context): Promise<SNSMessage> {
  // Try to get from context first
  const cached = c.get('snsMessage') as SNSMessage | undefined;
  if (cached) {
    return cached;
  }

  // Parse from body
  const rawBody = c.get('snsMessageRaw') as string | undefined;
  const body = rawBody || (await c.req.text());
  return JSON.parse(body) as SNSMessage;
}
