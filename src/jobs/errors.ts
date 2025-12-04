import type { BaseIssue } from 'valibot';

/**
 * Indicates a job should not be retried.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/**
 * Thrown when a job payload exceeds the allowed size.
 */
export class PayloadTooLargeError extends Error {
  readonly actualSize: number;
  readonly maxSize: number;

  constructor(actualSize: number, maxSize: number) {
    super(
      `Job payload size (${Math.round(actualSize / 1024)}KB) exceeds SQS limit (${Math.round(
        maxSize / 1024
      )}KB). Consider storing large data externally and passing a reference.`
    );
    this.name = 'PayloadTooLargeError';
    this.actualSize = actualSize;
    this.maxSize = maxSize;
  }
}

/**
 * Thrown when payload validation fails against the job schema.
 */
export class InvalidJobPayloadError extends Error {
  readonly jobName: string;
  readonly issues: BaseIssue<unknown>[];

  constructor(jobName: string, issues: BaseIssue<unknown>[]) {
    super(`Invalid payload for job "${jobName}"`);
    this.name = 'InvalidJobPayloadError';
    this.jobName = jobName;
    this.issues = issues;
  }
}
