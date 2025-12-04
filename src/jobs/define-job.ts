import type { BaseSchema, InferInput } from 'valibot';
import type { JobDefinition } from './types.js';

/**
 * Define a background job with typed payload and handler.
 */
export function defineJob<TSchema extends BaseSchema<unknown, unknown, unknown>>(config: {
  name: string;
  queue?: string;
  schema: TSchema;
  unique?: JobDefinition<InferInput<TSchema>>['unique'];
  handler: JobDefinition<InferInput<TSchema>>['handler'];
}): JobDefinition<InferInput<TSchema>>;

export function defineJob<TPayload>(config: {
  name: string;
  queue?: string;
  unique?: JobDefinition<TPayload>['unique'];
  handler: JobDefinition<TPayload>['handler'];
}): JobDefinition<TPayload>;

export function defineJob(config: JobDefinition<unknown>): JobDefinition<unknown> {
  return {
    name: config.name,
    queue: config.queue,
    schema: config.schema,
    retry: config.retry,
    unique: config.unique,
    handler: config.handler,
  };
}
