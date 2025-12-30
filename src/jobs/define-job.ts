import type { BaseIssue, BaseSchema, InferInput } from 'valibot';
import type { JobDefinition, RetryConfig } from './types.js';

/**
 * Define a background job with typed payload and handler.
 *
 * For dead-letter handling, configure your queue's redrive policy (e.g., SQS DLQ)
 * and optionally document the DLQ name via `deadLetterQueue`. Invalid payloads
 * will retry until the queue's DLQ threshold is reached.
 *
 * @example
 * ```typescript
 * // Basic job with schema validation
 * const sendEmailJob = defineJob({
 *   name: 'send-email',
 *   schema: emailPayloadSchema,
 *   handler: async (payload, ctx) => {
 *     await emailService.send(payload);
 *   },
 * });
 *
 * // Job with custom retry configuration
 * const webhookJob = defineJob({
 *   name: 'send-webhook',
 *   retry: { maxAttempts: 5 },
 *   handler: async (payload, ctx) => {
 *     await sendWebhook(payload);
 *   },
 * });
 *
 * // Fire-and-forget job (no retries)
 * const analyticsJob = defineJob({
 *   name: 'track-analytics',
 *   retry: false,
 *   handler: async (payload) => {
 *     await analytics.track(payload);
 *   },
 * });
 * ```
 */
export function defineJob<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(config: {
  name: string;
  queue?: string;
  deadLetterQueue?: string;
  schema: TSchema;
  retry?: RetryConfig | number | false;
  unique?: JobDefinition<InferInput<TSchema>>['unique'];
  handler: JobDefinition<InferInput<TSchema>>['handler'];
}): JobDefinition<InferInput<TSchema>>;

export function defineJob<TPayload>(config: {
  name: string;
  queue?: string;
  deadLetterQueue?: string;
  retry?: RetryConfig | number | false;
  unique?: JobDefinition<TPayload>['unique'];
  handler: JobDefinition<TPayload>['handler'];
}): JobDefinition<TPayload>;

export function defineJob(config: JobDefinition<unknown>): JobDefinition<unknown> {
  return {
    name: config.name,
    queue: config.queue,
    deadLetterQueue: config.deadLetterQueue,
    schema: config.schema,
    retry: config.retry,
    unique: config.unique,
    handler: config.handler,
  };
}
