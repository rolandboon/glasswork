import { object, optional, record, safeParse, string, unknown } from 'valibot';
import type { JobExecution } from './job-executor.js';
import type { JobMessage } from './types.js';
import { generateJobId } from './utils.js';

/** The envelope a queue carries for one job, whatever the transport. @internal */
export const JobMessageSchema = object({
  jobName: string(),
  payload: optional(unknown()),
  jobId: optional(string()),
  enqueuedAt: optional(string()),
  metadata: optional(record(string(), string())),
});

/** The envelope for a message, as JSON values. @internal */
export function toJobEnvelope(message: JobMessage, jobId = message.jobId ?? generateJobId()) {
  return JSON.parse(
    JSON.stringify({
      jobName: message.jobName,
      payload: message.payload,
      jobId,
      metadata: message.metadata,
      enqueuedAt: new Date().toISOString(),
    })
  ) as {
    jobName: string;
    payload: unknown;
    jobId: string;
    metadata?: Record<string, string>;
    enqueuedAt: string;
  };
}

/**
 * Reads an envelope into one delivery. Returns the validation issues when the value is no
 * envelope. @internal
 */
export function toJobExecution(
  value: unknown,
  delivery: { fallbackJobId: string; attemptNumber: number }
): { execution: JobExecution } | { issues: unknown } {
  const result = safeParse(JobMessageSchema, value);
  if (!result.success) return { issues: result.issues };
  const message = result.output;
  return {
    execution: {
      jobId: message.jobId ?? delivery.fallbackJobId,
      jobName: message.jobName,
      payload: message.payload,
      attemptNumber: delivery.attemptNumber,
      enqueuedAt: message.enqueuedAt ? new Date(message.enqueuedAt) : new Date(),
      metadata: message.metadata,
    },
  };
}
