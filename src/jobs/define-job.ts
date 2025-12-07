import type { BaseIssue, BaseSchema, InferInput } from 'valibot';
import type { JobDefinition } from './types.js';

/**
 * Define a background job with typed payload and handler.
 *
 * For dead-letter handling, configure your queue's redrive policy (e.g., SQS DLQ)
 * and optionally document the DLQ name via `deadLetterQueue`. Invalid payloads
 * will now retry until the queue's DLQ threshold is reached.
 */
export function defineJob<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(config: {
  name: string;
  queue?: string;
  deadLetterQueue?: string;
  schema: TSchema;
  unique?: JobDefinition<InferInput<TSchema>>['unique'];
  handler: JobDefinition<InferInput<TSchema>>['handler'];
}): JobDefinition<InferInput<TSchema>>;

export function defineJob<TPayload>(config: {
  name: string;
  queue?: string;
  deadLetterQueue?: string;
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
