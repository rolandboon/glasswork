/**
 * Types for SES webhook events delivered via SNS
 */

/**
 * Base SES event properties
 */
interface BaseSESEvent {
  /** SES message ID */
  messageId: string;
  /** When the event occurred */
  timestamp: Date;
  /** The recipient email address */
  recipient: string;
}

/**
 * Email successfully delivered
 */
export interface DeliveredEvent extends BaseSESEvent {
  type: 'delivered';
  /** Processing time in milliseconds */
  processingTimeMs?: number;
  /** SMTP response from receiving server */
  smtpResponse?: string;
  /** Raw SES notification data */
  raw: SESDeliveryNotification;
}

/**
 * Email bounced (permanent or transient)
 */
export interface BouncedEvent extends BaseSESEvent {
  type: 'bounced';
  /** Whether the bounce is permanent or transient */
  bounceType: 'permanent' | 'transient';
  /** Specific bounce sub-type */
  bounceSubType: string;
  /** Human-readable bounce reason */
  reason: string;
  /** Raw SES notification data */
  raw: SESBounceNotification;
}

/**
 * Recipient filed a complaint (marked as spam)
 */
export interface ComplaintEvent extends BaseSESEvent {
  type: 'complaint';
  /** Type of complaint feedback */
  complaintType: string;
  /** User agent that filed the complaint */
  userAgent?: string;
  /** Raw SES notification data */
  raw: SESComplaintNotification;
}

/**
 * Union of all SES events
 */
export type SESEvent = DeliveredEvent | BouncedEvent | ComplaintEvent;

/**
 * Raw SNS message envelope
 */
export interface SNSMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  UnsubscribeURL?: string;
  SubscribeURL?: string;
  Token?: string;
}

/**
 * Raw SES mail object
 */
export interface SESMailObject {
  timestamp: string;
  messageId: string;
  source: string;
  sourceArn?: string;
  sendingAccountId?: string;
  destination: string[];
  headersTruncated: boolean;
  headers: Array<{ name: string; value: string }>;
  commonHeaders: {
    from: string[];
    to: string[];
    subject: string;
    messageId?: string;
    date?: string;
  };
  tags?: Record<string, string[]>;
}

/**
 * Raw SES delivery notification
 */
export interface SESDeliveryNotification {
  notificationType: 'Delivery';
  mail: SESMailObject;
  delivery: {
    timestamp: string;
    processingTimeMillis: number;
    recipients: string[];
    smtpResponse: string;
    reportingMTA?: string;
    remoteMtaIp?: string;
  };
}

/**
 * Raw SES bounce notification
 */
export interface SESBounceNotification {
  notificationType: 'Bounce';
  mail: SESMailObject;
  bounce: {
    bounceType: 'Undetermined' | 'Permanent' | 'Transient';
    bounceSubType: string;
    bouncedRecipients: Array<{
      emailAddress: string;
      action?: string;
      status?: string;
      diagnosticCode?: string;
    }>;
    timestamp: string;
    feedbackId: string;
    reportingMTA?: string;
    remoteMtaIp?: string;
  };
}

/**
 * Raw SES complaint notification
 */
export interface SESComplaintNotification {
  notificationType: 'Complaint';
  mail: SESMailObject;
  complaint: {
    complainedRecipients: Array<{
      emailAddress: string;
    }>;
    timestamp: string;
    feedbackId: string;
    complaintSubType?: string;
    complaintFeedbackType?: string;
    userAgent?: string;
    arrivalDate?: string;
  };
}

/**
 * Union of raw SES notifications
 */
export type SESNotification =
  | SESDeliveryNotification
  | SESBounceNotification
  | SESComplaintNotification;

/**
 * Options for SNS signature verification
 */
export interface VerifySignatureOptions {
  /** Cache TTL for signing certificates in milliseconds (default: 1 hour) */
  certCacheTTL?: number;
  /** Custom fetch function for testing */
  fetchFn?: typeof fetch;
}

/**
 * Event handler functions for the factory
 */
export interface SESWebhookHandlers {
  /** Called when an email is delivered */
  onDelivered?: (event: DeliveredEvent, c: HonoContext) => Promise<void> | void;
  /** Called when an email bounces */
  onBounced?: (event: BouncedEvent, c: HonoContext) => Promise<void> | void;
  /** Called when a complaint is received */
  onComplaint?: (event: ComplaintEvent, c: HonoContext) => Promise<void> | void;
}

/**
 * Options for the webhook handler factory
 */
export interface CreateWebhookHandlerOptions extends SESWebhookHandlers {
  /** Whether to verify SNS signatures (default: true in production) */
  verifySignature?: boolean;
  /** Options for signature verification */
  signatureOptions?: VerifySignatureOptions;
}

// Hono context type placeholder
type HonoContext = {
  req: { json: () => Promise<unknown>; text: () => Promise<string> };
  json: (data: unknown, status?: number) => Response;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
};
