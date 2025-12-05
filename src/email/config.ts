import * as v from 'valibot';

/**
 * Valibot schema for SES transport configuration
 */
export const SESTransportConfigSchema = v.object({
  type: v.literal('ses'),
  region: v.pipe(v.string(), v.minLength(1)),
  configurationSet: v.optional(v.string()),
  endpoint: v.optional(v.string()),
});

/**
 * Valibot schema for SMTP transport configuration
 */
export const SMTPTransportConfigSchema = v.object({
  type: v.literal('smtp'),
  host: v.pipe(v.string(), v.minLength(1)),
  port: v.pipe(v.number(), v.minValue(1), v.maxValue(65535)),
  secure: v.optional(v.boolean()),
  auth: v.optional(
    v.object({
      user: v.string(),
      pass: v.string(),
    })
  ),
});

/**
 * Valibot schema for mock transport configuration (testing)
 */
export const MockTransportConfigSchema = v.object({
  type: v.literal('mock'),
});

/**
 * Union of all transport configurations
 */
export const TransportConfigSchema = v.union([
  SESTransportConfigSchema,
  SMTPTransportConfigSchema,
  MockTransportConfigSchema,
]);

/**
 * Valibot schema for email module configuration
 */
export const EmailConfigSchema = v.object({
  /** Default sender email address */
  from: v.pipe(v.string(), v.email()),
  /** Default reply-to address */
  replyTo: v.optional(v.pipe(v.string(), v.email())),
  /** Transport configuration */
  transport: TransportConfigSchema,
});

/**
 * Inferred types from schemas
 */
export type SESTransportConfigInput = v.InferInput<typeof SESTransportConfigSchema>;
export type SMTPTransportConfigInput = v.InferInput<typeof SMTPTransportConfigSchema>;
export type MockTransportConfigInput = v.InferInput<typeof MockTransportConfigSchema>;
export type TransportConfigInput = v.InferInput<typeof TransportConfigSchema>;
export type EmailConfigInput = v.InferInput<typeof EmailConfigSchema>;

/**
 * Validates email configuration
 */
export function validateEmailConfig(config: unknown): EmailConfigInput {
  return v.parse(EmailConfigSchema, config);
}
