import { createLogger } from '../utils/logger.js';
import type {
  EmailConfig,
  EmailMessage,
  EmailResult,
  EmailTransport,
  OnSentHook,
} from './types.js';

const logger = createLogger('EmailService');

/**
 * Options for sending an email
 */
export interface SendOptions {
  /** Override the default sender */
  from?: string;
  /** Override the default reply-to */
  replyTo?: string;
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
  private readonly transport: EmailTransport;
  private readonly defaultFrom: string;
  private readonly defaultReplyTo?: string;
  private readonly onSent?: OnSentHook;

  constructor(config: EmailConfig, onSent?: OnSentHook) {
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
    options?: SendOptions
  ): Promise<EmailResult> {
    const fullMessage: EmailMessage = {
      ...message,
      from: options?.from || message.from || this.defaultFrom,
      replyTo: options?.replyTo || message.replyTo || this.defaultReplyTo,
      text: message.text || this.htmlToText(message.html),
    };

    const result = await this.transport.send(fullMessage);

    // Call onSent hook if configured
    if (this.onSent && result.success) {
      try {
        await this.onSent(result, fullMessage);
      } catch (error) {
        // Log but don't fail the send
        logger.error('onSent hook failed:', error);
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

  /**
   * Converts HTML to plain text for email clients that don't support HTML
   */
  private htmlToText(html: string): string {
    return (
      html
        // Remove style and script tags with content
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        // Convert line breaks
        .replace(/<br\s*\/?>/gi, '\n')
        // Convert block elements to newlines
        .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
        // Convert list items
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        // Remove remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Decode common HTML entities
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        // Clean up whitespace
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim()
    );
  }
}
