// Email module main exports

export {
  type CompileOptions,
  type CompileResult,
  compileTemplates,
} from './compiler/compile-templates.js';
export type {
  CompiledTemplate,
  CompilerOptions,
  InferredType,
  Token,
  TokenType,
} from './compiler/index.js';
// Compiler (for build-time usage)
export { compile, extractTypes, generateInterface, tokenize } from './compiler/index.js';
// Configuration
export {
  type EmailConfigInput,
  EmailConfigSchema,
  type MockTransportConfigInput,
  MockTransportConfigSchema,
  type SESTransportConfigInput,
  SESTransportConfigSchema,
  type SMTPTransportConfigInput,
  SMTPTransportConfigSchema,
  type TransportConfigInput,
  TransportConfigSchema,
  validateEmailConfig,
} from './config.js';
// Services
export { EmailService, type SendOptions } from './email-service.js';
// Template registry
export {
  createTemplateRegistry,
  type TemplateDefinition,
  TemplateRegistry,
  type TemplateRenderFn,
} from './template-registry.js';
export {
  type SendTemplateOptions,
  TemplatedEmailService,
} from './templated-email-service.js';
export { MockTransport, type StoredEmail } from './transports/mock-transport.js';
// Transports
export { SESTransport } from './transports/ses-transport.js';
// Core types
export type {
  EmailAttachment,
  EmailConfig,
  EmailMessage,
  EmailModuleOptions,
  EmailResult,
  EmailTransport,
  OnSentHook,
  SESTransportConfig,
  SMTPTransportConfig,
} from './types.js';

// Webhooks (delivery tracking)
export {
  type BouncedEvent,
  type ComplaintEvent,
  type CreateWebhookHandlerOptions,
  clearCertCache,
  // Handler factory
  createSESWebhookHandler,
  type DeliveredEvent,
  type HandleSubscriptionOptions,
  handleSNSSubscription,
  // Parsers
  parseSESNotification,
  parseSNSMessage,
  type SESBounceNotification,
  type SESComplaintNotification,
  type SESDeliveryNotification,
  // Types
  type SESEvent,
  type SESNotification,
  type SESWebhookHandlers,
  type SNSMessage,
  type VerifySignatureOptions,
  // Middleware
  verifySNSSignature,
} from './webhooks/index.js';
