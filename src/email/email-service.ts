import { createLogger } from '../utils/logger.js';
import { htmlToText } from './html-to-text.js';
import type {
  EmailConfig,
  EmailMessage,
  EmailResult,
  EmailSendContext,
  EmailTransport,
  OnSentHook,
} from './types.js';

/**
 * Options for sending an email
 */
export interface SendOptions {
  /** Override the default sender */
  from?: string;
  /** Override the default reply-to */
  replyTo?: string;
  /** Application correlation data for tracking; not email headers or template content. */
  metadata?: EmailSendContext['metadata'];
}

/**
 * Email service for sending emails through configured transport
 *
 * @example
 * ```typescript
 * const emailService = new EmailService({
 *   transport: new SESTransport({ region: 'eu-west-1' }),
 *   from: 'noreply@example.com',
 * });
 *
 * // Send raw email
 * await emailService.sendRaw({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   html: '<h1>Welcome to our app!</h1>',
 * });
 * ```
 */
export class EmailService {
  private readonly logger: import('../utils/logger.js').Logger;
  private readonly transport: EmailTransport;
  private readonly defaultFrom: string;
  private readonly defaultReplyTo?: string;
  private readonly onSent?: OnSentHook;

  constructor(config: EmailConfig, onSent?: OnSentHook) {
    this.logger = config.logger ?? createLogger('EmailService');
    this.transport = config.transport;
    this.defaultFrom = config.from;
    this.defaultReplyTo = config.replyTo;
    this.onSent = onSent;
  }

  /**
   * Sends a raw email message
   *
   * @param message - Email message to send
   * @param options - Optional overrides for sender/reply-to
   * @returns The send result with message ID
   */
  async sendRaw(
    message: Omit<EmailMessage, 'from'> & { from?: string },
    options?: SendOptions,
    context: Pick<EmailSendContext, 'template'> = {}
  ): Promise<EmailResult> {
    const fullMessage: EmailMessage = {
      ...message,
      from: options?.from || message.from || this.defaultFrom,
      replyTo: options?.replyTo || message.replyTo || this.defaultReplyTo,
      text: message.text || htmlToText(message.html),
    };

    const result = await this.transport.send(fullMessage);

    // Call onSent hook if configured
    if (this.onSent && result.success) {
      try {
        await this.onSent(result, fullMessage, {
          ...context,
          ...(options?.metadata ? { metadata: options.metadata } : {}),
        });
      } catch (error) {
        // Log but don't fail the send
        this.logger.error('onSent hook failed:', error);
      }
    }

    return result;
  }

  /**
   * Gets the transport name for debugging
   */
  get transportName(): string {
    return this.transport.name;
  }
}
