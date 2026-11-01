/**
 * @module glasswork/email/ses
 * Amazon SES email transport. Requires `@aws-sdk/client-sesv2`.
 */
export { SESTransport } from './transports/ses-transport.js';
export type { SESTransportConfig } from './types.js';
