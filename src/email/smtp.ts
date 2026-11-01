/**
 * @module glasswork/email/smtp
 * SMTP email transport. Requires `nodemailer`.
 */
export {
  SmtpTransport,
  type SmtpTransporter,
  type SmtpTransportOptions,
} from './transports/smtp-transport.js';
export type { SMTPTransportConfig } from './types.js';
