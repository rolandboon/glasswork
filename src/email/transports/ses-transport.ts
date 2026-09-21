import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { EmailMessage, EmailResult, EmailTransport, SESTransportConfig } from '../types.js';

type SESClient = NonNullable<SESTransportConfig['client']> | SESv2Client;

interface SESSendResult {
  MessageId?: string;
}

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
    if (this.client) {
      return this.client;
    }

    if (this.config.client) {
      this.client = this.config.client;
      return this.client;
    }

    this.client = new SESv2Client({
      region: this.config.region,
      ...(this.config.endpoint && { endpoint: this.config.endpoint }),
    });
    return this.client;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const client = await this.getClient();

    // If there are attachments or custom headers, use raw email format
    if ((message.attachments && message.attachments.length > 0) || message.headers) {
      return this.sendRawEmail(client, message);
    }

    // Otherwise use simple email format
    return this.sendSimpleEmail(client, message);
  }

  /**
   * Sends a simple email without attachments
   */
  private async sendSimpleEmail(client: SESClient, message: EmailMessage): Promise<EmailResult> {
    const SendEmailCommandCtor =
      this.config.sendEmailCommand !== undefined ? this.config.sendEmailCommand : SendEmailCommand;

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

    const command = new SendEmailCommandCtor({
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
    });

    const result = (await client.send(command as SendEmailCommand)) as SESSendResult;

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
    const SendEmailCommandCtor =
      this.config.sendEmailCommand !== undefined ? this.config.sendEmailCommand : SendEmailCommand;

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

    const command = new SendEmailCommandCtor({
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

    const result = (await client.send(command as SendEmailCommand)) as SESSendResult;

    if (!result.MessageId) {
      throw new Error('SES did not return a message ID');
    }

    return {
      messageId: result.MessageId,
      success: true,
      metadata: {
        provider: 'ses',
        region: this.config.region,
        hasAttachments: Boolean(message.attachments?.length),
      },
    };
  }

  /**
   * Builds a MIME multipart message with attachments
   */
  private buildMimeMessage(message: EmailMessage): string {
    this.validateMimeInputs(message);

    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const lines: string[] = [];

    this.addMimeHeaders(lines, message, boundary);
    this.addBodyParts(lines, message, boundary);
    this.addAttachments(lines, message, boundary);
    lines.push(`--${boundary}--`);
    lines.push('');

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
    if (message.headers) {
      for (const [headerName, headerValue] of Object.entries(message.headers)) {
        lines.push(`${headerName}: ${this.encodeHeader(headerValue)}`);
      }
    }
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
      `Content-Type: ${attachment.contentType || 'application/octet-stream'}; name*=UTF-8''${this.encodeMimeParameter(attachment.filename)}`
    );
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(
      `Content-Disposition: ${attachment.disposition || 'attachment'}; filename*=UTF-8''${this.encodeMimeParameter(attachment.filename)}`
    );
    if (attachment.contentId) {
      lines.push(`Content-ID: <${attachment.contentId}>`);
    }
    lines.push('');

    const content = this.encodeAttachmentContent(attachment.content);

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
    // Keep encoded words short enough to fold safely and never split a UTF-8 code point.
    const chunks: string[] = [];
    let chunk = '';
    for (const character of value) {
      if (Buffer.byteLength(chunk + character, 'utf8') > 30 && chunk) {
        chunks.push(chunk);
        chunk = '';
      }
      chunk += character;
    }
    if (chunk) chunks.push(chunk);

    return chunks
      .map((part) => `=?UTF-8?B?${Buffer.from(part, 'utf8').toString('base64')}?=`)
      .join('\r\n ');
  }

  /**
   * Encodes content as quoted-printable
   */
  private encodeQuotedPrintable(text: string): string {
    return text
      .replace(/\r\n|\r|\n/g, '\n')
      .split('\n')
      .map((line) => this.encodeQuotedPrintableLine(line))
      .join('\r\n');
  }

  private encodeQuotedPrintableLine(line: string): string {
    const bytes = Buffer.from(line, 'utf8');
    const tokens: string[] = [];

    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      const isTrailingWhitespace = index === bytes.length - 1 && (byte === 0x20 || byte === 0x09);
      const isPrintable =
        (byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126) || byte === 0x20 || byte === 0x09;
      tokens.push(
        isPrintable && !isTrailingWhitespace
          ? String.fromCharCode(byte)
          : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`
      );
    }

    const output: string[] = [];
    let currentLine = '';
    for (const token of tokens) {
      if (currentLine.length + token.length > 75) {
        output.push(`${currentLine}=`);
        currentLine = '';
      }
      currentLine += token;
    }
    output.push(currentLine);
    return output.join('\r\n');
  }

  private encodeMimeParameter(value: string): string {
    return encodeURIComponent(value).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
  }

  private encodeAttachmentContent(content: string | Buffer): string {
    if (Buffer.isBuffer(content)) {
      return content.toString('base64');
    }

    const compact = content.replace(/\s/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
      throw new Error('Attachment string content must be valid base64');
    }
    return Buffer.from(compact, 'base64').toString('base64');
  }

  private validateMimeInputs(message: EmailMessage): void {
    this.assertHeaderValue('From', message.from ?? '');
    this.assertAddressValues('To', message.to);
    if (message.cc) this.assertAddressValues('Cc', message.cc);
    if (message.bcc) this.assertAddressValues('Bcc', message.bcc);
    if (message.replyTo) this.assertHeaderValue('Reply-To', message.replyTo);
    this.assertHeaderValue('Subject', message.subject);

    this.validateCustomHeaders(message.headers);
    for (const attachment of message.attachments ?? []) {
      this.validateAttachmentMetadata(attachment);
    }
  }

  private validateCustomHeaders(headers: EmailMessage['headers']): void {
    const protectedHeaders = new Set([
      'from',
      'to',
      'cc',
      'bcc',
      'reply-to',
      'subject',
      'mime-version',
      'content-type',
      'content-transfer-encoding',
      'content-disposition',
    ]);
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
        throw new Error(`Invalid email header name: ${name}`);
      }
      if (protectedHeaders.has(name.toLowerCase())) {
        throw new Error(`Custom email header may not override ${name}`);
      }
      this.assertHeaderValue(name, value);
    }
  }

  private validateAttachmentMetadata(
    attachment: NonNullable<EmailMessage['attachments']>[number]
  ): void {
    if (
      attachment.disposition !== undefined &&
      attachment.disposition !== 'attachment' &&
      attachment.disposition !== 'inline'
    ) {
      throw new Error('Attachment disposition must be attachment or inline');
    }
    this.assertHeaderValue('Attachment filename', attachment.filename);
    if (Buffer.byteLength(attachment.filename, 'utf8') > 255) {
      throw new Error('Attachment filename exceeds 255 bytes');
    }
    if (
      attachment.contentType &&
      !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(attachment.contentType)
    ) {
      throw new Error(`Invalid attachment content type: ${attachment.contentType}`);
    }
    if (attachment.contentId) {
      this.assertHeaderValue('Attachment content ID', attachment.contentId);
      if (/[<>]/.test(attachment.contentId)) {
        throw new Error('Attachment content ID may not contain angle brackets');
      }
    }
  }

  private assertAddressValues(name: string, value: string | string[]): void {
    for (const address of Array.isArray(value) ? value : [value]) {
      this.assertHeaderValue(name, address);
    }
  }

  private assertHeaderValue(name: string, value: string): void {
    if (/\r|\n/.test(value)) {
      throw new Error(`${name} may not contain CR or LF characters`);
    }
    if (Buffer.byteLength(value, 'utf8') > 998) {
      throw new Error(`${name} exceeds the maximum header line length`);
    }
  }
}
