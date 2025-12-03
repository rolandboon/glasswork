import type { EmailMessage, EmailResult, EmailTransport, SESTransportConfig } from '../types.js';

/**
 * AWS SES email transport
 *
 * Sends emails using AWS Simple Email Service (SES).
 * Requires @aws-sdk/client-sesv2 as a peer dependency.
 *
 * @example
 * ```typescript
 * import { SESTransport } from '@glasswork/email';
 *
 * const transport = new SESTransport({
 *   region: 'eu-west-1',
 *   configurationSet: 'my-config-set',
 * });
 * ```
 */
export class SESTransport implements EmailTransport {
  readonly name = 'ses';
  private client: SESClient | null = null;
  private readonly config: SESTransportConfig;

  constructor(config: SESTransportConfig) {
    this.config = config;
  }

  /**
   * Lazily initializes the SES client
   */
  private async getClient(): Promise<SESClient> {
    if (!this.client) {
      // Dynamic import to avoid bundling AWS SDK when not used
      const { SESv2Client } = await import('@aws-sdk/client-sesv2');
      this.client = new SESv2Client({
        region: this.config.region,
        ...(this.config.endpoint && { endpoint: this.config.endpoint }),
      }) as SESClient;
    }
    return this.client;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const client = await this.getClient();

    // If there are attachments, use raw email format
    if (message.attachments && message.attachments.length > 0) {
      return this.sendRawEmail(client, message);
    }

    // Otherwise use simple email format
    return this.sendSimpleEmail(client, message);
  }

  /**
   * Sends a simple email without attachments
   */
  private async sendSimpleEmail(client: SESClient, message: EmailMessage): Promise<EmailResult> {
    const { SendEmailCommand } = await import('@aws-sdk/client-sesv2');

    const toAddresses = Array.isArray(message.to) ? message.to : [message.to];
    const ccAddresses = message.cc
      ? Array.isArray(message.cc)
        ? message.cc
        : [message.cc]
      : undefined;
    const bccAddresses = message.bcc
      ? Array.isArray(message.bcc)
        ? message.bcc
        : [message.bcc]
      : undefined;

    const command = new SendEmailCommand({
      FromEmailAddress: message.from,
      ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
      Destination: {
        ToAddresses: toAddresses,
        CcAddresses: ccAddresses,
        BccAddresses: bccAddresses,
      },
      Content: {
        Simple: {
          Subject: {
            Data: message.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: message.html,
              Charset: 'UTF-8',
            },
            ...(message.text && {
              Text: {
                Data: message.text,
                Charset: 'UTF-8',
              },
            }),
          },
        },
      },
      ConfigurationSetName: this.config.configurationSet,
      EmailTags: message.headers
        ? Object.entries(message.headers).map(([Name, Value]) => ({
            Name,
            Value,
          }))
        : undefined,
    });

    const result = await client.send(command);

    if (!result.MessageId) {
      throw new Error('SES did not return a message ID');
    }

    return {
      messageId: result.MessageId,
      success: true,
      metadata: {
        provider: 'ses',
        region: this.config.region,
      },
    };
  }

  /**
   * Sends a raw MIME email with attachments
   */
  private async sendRawEmail(client: SESClient, message: EmailMessage): Promise<EmailResult> {
    const { SendEmailCommand } = await import('@aws-sdk/client-sesv2');

    const rawMessage = this.buildMimeMessage(message);

    const toAddresses = Array.isArray(message.to) ? message.to : [message.to];
    const ccAddresses = message.cc
      ? Array.isArray(message.cc)
        ? message.cc
        : [message.cc]
      : undefined;
    const bccAddresses = message.bcc
      ? Array.isArray(message.bcc)
        ? message.bcc
        : [message.bcc]
      : undefined;

    const command = new SendEmailCommand({
      FromEmailAddress: message.from,
      Destination: {
        ToAddresses: toAddresses,
        CcAddresses: ccAddresses,
        BccAddresses: bccAddresses,
      },
      Content: {
        Raw: {
          Data: new TextEncoder().encode(rawMessage),
        },
      },
      ConfigurationSetName: this.config.configurationSet,
    });

    const result = await client.send(command);

    if (!result.MessageId) {
      throw new Error('SES did not return a message ID');
    }

    return {
      messageId: result.MessageId,
      success: true,
      metadata: {
        provider: 'ses',
        region: this.config.region,
        hasAttachments: true,
      },
    };
  }

  /**
   * Builds a MIME multipart message with attachments
   */
  private buildMimeMessage(message: EmailMessage): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const lines: string[] = [];

    this.addMimeHeaders(lines, message, boundary);
    this.addBodyParts(lines, message, boundary);
    this.addAttachments(lines, message, boundary);
    lines.push(`--${boundary}--`);

    return lines.join('\r\n');
  }

  /**
   * Adds MIME headers to the message
   */
  private addMimeHeaders(lines: string[], message: EmailMessage, boundary: string): void {
    lines.push(`From: ${message.from}`);
    lines.push(`To: ${Array.isArray(message.to) ? message.to.join(', ') : message.to}`);
    if (message.cc) {
      lines.push(`Cc: ${Array.isArray(message.cc) ? message.cc.join(', ') : message.cc}`);
    }
    if (message.replyTo) {
      lines.push(`Reply-To: ${message.replyTo}`);
    }
    lines.push(`Subject: ${this.encodeHeader(message.subject)}`);
    lines.push('MIME-Version: 1.0');
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
  }

  /**
   * Adds body parts (text and HTML) to the message
   */
  private addBodyParts(lines: string[], message: EmailMessage, boundary: string): void {
    const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push('');

    // Plain text part
    if (message.text) {
      lines.push(`--${altBoundary}`);
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: quoted-printable');
      lines.push('');
      lines.push(this.encodeQuotedPrintable(message.text));
      lines.push('');
    }

    // HTML part
    lines.push(`--${altBoundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: quoted-printable');
    lines.push('');
    lines.push(this.encodeQuotedPrintable(message.html));
    lines.push('');
    lines.push(`--${altBoundary}--`);
  }

  /**
   * Adds attachments to the message
   */
  private addAttachments(lines: string[], message: EmailMessage, boundary: string): void {
    if (!message.attachments) {
      return;
    }

    for (const attachment of message.attachments) {
      this.addSingleAttachment(lines, attachment, boundary);
    }
  }

  /**
   * Adds a single attachment to the message
   */
  private addSingleAttachment(
    lines: string[],
    attachment: NonNullable<EmailMessage['attachments']>[number],
    boundary: string
  ): void {
    lines.push(`--${boundary}`);
    lines.push(
      `Content-Type: ${attachment.contentType || 'application/octet-stream'}; name="${attachment.filename}"`
    );
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(
      `Content-Disposition: ${attachment.disposition || 'attachment'}; filename="${attachment.filename}"`
    );
    if (attachment.contentId) {
      lines.push(`Content-ID: <${attachment.contentId}>`);
    }
    lines.push('');

    const content =
      typeof attachment.content === 'string'
        ? attachment.content
        : Buffer.from(attachment.content).toString('base64');

    // Split base64 content into 76-character lines
    for (let i = 0; i < content.length; i += 76) {
      lines.push(content.slice(i, i + 76));
    }
    lines.push('');
  }

  /**
   * Encodes a header value for MIME (handles non-ASCII characters)
   */
  private encodeHeader(value: string): string {
    // Check if encoding is needed
    if (/^[\x20-\x7E]*$/.test(value)) {
      return value;
    }
    // Use RFC 2047 encoding
    const encoded = Buffer.from(value, 'utf-8').toString('base64');
    return `=?UTF-8?B?${encoded}?=`;
  }

  /**
   * Encodes content as quoted-printable
   */
  private encodeQuotedPrintable(text: string): string {
    return text
      .split('')
      .map((char) => {
        const code = char.charCodeAt(0);
        if (
          (code >= 33 && code <= 60) ||
          (code >= 62 && code <= 126) ||
          char === ' ' ||
          char === '\t'
        ) {
          return char;
        }
        if (char === '\r' || char === '\n') {
          return char;
        }
        // Encode as =XX
        return `=${code.toString(16).toUpperCase().padStart(2, '0')}`;
      })
      .join('')
      .replace(/(.{75})/g, '$1=\r\n'); // Soft line breaks
  }
}

// Type for the SES client (avoiding full import)
interface SESClient {
  send(command: unknown): Promise<{ MessageId?: string }>;
}
