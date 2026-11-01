import { optionalDependency } from '../../utils/optional-dependency.js';
import type { EmailMessage, EmailResult, EmailTransport, SMTPTransportConfig } from '../types.js';

const loadNodemailer = optionalDependency(
  'nodemailer',
  'SmtpTransport',
  () => import('nodemailer')
);

/** The part of a Nodemailer transporter that the SMTP transport uses. */
export interface SmtpTransporter {
  sendMail(mail: Record<string, unknown>): Promise<{
    messageId?: string;
    accepted?: unknown[];
    rejected?: unknown[];
    response?: string;
  }>;
  close?(): void;
}

export interface SmtpTransportOptions extends Partial<SMTPTransportConfig> {
  /**
   * A Nodemailer transporter you created. It stays yours: `close()` leaves it open.
   * Without it, the transport creates one from the connection options on first send.
   */
  transporter?: SmtpTransporter;
  /** More options for Nodemailer's `createTransport`, such as `pool`, `tls` or `name`. */
  nodemailer?: Record<string, unknown>;
}

/**
 * SMTP transport backed by Nodemailer, for SMTP relays and local mail catchers such as
 * Mailpit. Requires the `nodemailer` package.
 *
 * @example
 * ```typescript
 * import { SmtpTransport } from 'glasswork/email/smtp';
 *
 * const transport = new SmtpTransport({ host: 'localhost', port: 1025 });
 * ```
 */
export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp';
  readonly #options: SmtpTransportOptions;
  #transporter: Promise<SmtpTransporter> | undefined;

  constructor(options: SmtpTransportOptions) {
    if (!options.transporter && !options.host && !options.nodemailer) {
      throw new Error('SmtpTransport needs a transporter, a host or nodemailer options');
    }
    this.#options = options;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const transporter = await this.#getTransporter();
    const info = await transporter.sendMail({
      from: message.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
        contentDisposition: attachment.disposition,
        cid: attachment.contentId,
      })),
    });

    return {
      messageId: info.messageId ?? '',
      success: (info.rejected?.length ?? 0) === 0,
      metadata: { accepted: info.accepted, rejected: info.rejected, response: info.response },
    };
  }

  /** Close a transporter this transport created. A transporter you passed in stays open. */
  async close(): Promise<void> {
    const transporter = this.#transporter;
    this.#transporter = undefined;
    if (transporter) (await transporter).close?.();
  }

  #getTransporter(): Promise<SmtpTransporter> {
    if (this.#options.transporter) return Promise.resolve(this.#options.transporter);
    this.#transporter ??= loadNodemailer().then(({ createTransport }) => {
      const { host, port, secure, auth, nodemailer } = this.#options;
      return createTransport({ host, port, secure, auth, ...nodemailer });
    });
    return this.#transporter;
  }
}
