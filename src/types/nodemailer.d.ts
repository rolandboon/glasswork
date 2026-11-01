// Compile-time shape of the optional `nodemailer` peer. Published declarations use the
// structural types in the SMTP transport, so applications need no @types/nodemailer.
declare module 'nodemailer' {
  export function createTransport(
    options: unknown
  ): import('../email/transports/smtp-transport.js').SmtpTransporter;
}
