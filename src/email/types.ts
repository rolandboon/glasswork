/**
 * Email module types and interfaces
 */
import type { SendEmailCommandInput } from '@aws-sdk/client-sesv2';

/**
 * Attachment for an email message
 */
export interface EmailAttachment {
  /** Filename for the attachment */
  filename: string;
  /** Content of the attachment (base64 encoded or Buffer) */
  content: string | Buffer;
  /** MIME type of the attachment */
  contentType?: string;
  /** Content disposition (attachment or inline) */
  disposition?: 'attachment' | 'inline';
  /** Content ID for inline attachments */
  contentId?: string;
}

/**
 * Email message to be sent
 */
export interface EmailMessage {
  /** Recipient email address(es) */
  to: string | string[];
  /** Email subject */
  subject: string;
  /** HTML body content */
  html: string;
  /** Plain text body content (auto-generated if not provided) */
  text?: string;
  /** Sender email address (overrides default) */
  from?: string;
  /** Reply-to email address */
  replyTo?: string;
  /** CC recipients */
  cc?: string | string[];
  /** BCC recipients */
  bcc?: string | string[];
  /** Email attachments */
  attachments?: EmailAttachment[];
  /** Custom headers */
  headers?: Record<string, string>;
}

/**
 * Result of sending an email
 */
export interface EmailResult {
  /** Message ID returned by the email provider */
  messageId: string;
  /** Whether the send was successful */
  success: boolean;
  /** Additional metadata from the provider */
  metadata?: Record<string, unknown>;
}

/**
 * Email transport interface for sending emails
 */
export interface EmailTransport {
  /** Transport name for logging/debugging */
  readonly name: string;
  /**
   * Sends an email message
   * @param message - The email message to send
   * @returns Promise resolving to the send result
   */
  send(message: EmailMessage): Promise<EmailResult>;
}

/**
 * SES transport configuration
 */
export interface SESTransportConfig {
  /** AWS region for SES */
  region: string;
  /** SES configuration set name (enables delivery tracking) */
  configurationSet?: string;
  /** Custom endpoint (for local testing with LocalStack) */
  endpoint?: string;
  /** Optional pre-configured SES client (useful for testing/mocking) */
  client?: {
    send(command: unknown): Promise<{ MessageId?: string }>;
  };
  /** Optional SendEmailCommand constructor (useful for testing/mocking) */
  sendEmailCommand?: new (
    input: SendEmailCommandInput
  ) => unknown;
}

/**
 * SMTP transport configuration
 */
export interface SMTPTransportConfig {
  /** SMTP host */
  host: string;
  /** SMTP port */
  port: number;
  /** Use TLS */
  secure?: boolean;
  /** Authentication credentials */
  auth?: {
    user: string;
    pass: string;
  };
}

/**
 * Email module configuration
 */
export interface EmailConfig {
  /** Default sender email address */
  from: string;
  /** Default reply-to address */
  replyTo?: string;
  /** Transport configuration */
  transport: EmailTransport;
}

/**
 * Hook called after an email is successfully sent
 */
export type OnSentHook = (result: EmailResult, message: EmailMessage) => Promise<void> | void;

/**
 * Full email module options
 */
export interface EmailModuleOptions {
  /** Email configuration */
  config: EmailConfig;
  /** Hook called after successful send (for tracking) */
  onSent?: OnSentHook;
}
