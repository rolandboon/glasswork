import type { BaseIssue, BaseSchema } from 'valibot';
import type { Logger } from '../utils/logger.js';

/**
 * Duration expressed as human-readable string (e.g. "5m") or seconds as number.
 */
export type Duration = string | number;

/**
 * Retry configuration for jobs.
 *
 * Glasswork relies on SQS visibility timeout for retry timing, but this
 * configuration influences how the worker handles failures and determines
 * when a job should be considered "dead" (retries exhausted).
 *
 * @example
 * ```typescript
 * // Default: 25 retries, send to DLQ
 * defineJob({ name: 'my-job', handler: ... })
 *
 * // Custom retry count
 * defineJob({ name: 'my-job', retry: { maxAttempts: 5 }, handler: ... })
 *
 * // No retries, discard on failure
 * defineJob({ name: 'my-job', retry: false, handler: ... })
 *
 * // Retry but don't save to DLQ
 * defineJob({ name: 'my-job', retry: { maxAttempts: 10, dead: false }, handler: ... })
 * ```
 */
export interface RetryConfig {
  /**
   * Maximum number of retries before the job is considered dead.
   * The default is 25 retries.
   *
   * @default 25
   */
  maxAttempts?: number;

  /**
   * Whether to save failed jobs to the dead letter queue after exhausting retries.
   * If false, jobs will be discarded (not re-thrown to SQS) after max attempts.
   *
   * @default true
   */
  dead?: boolean;
}

/**
 * Execution context passed to job handlers.
 */
export interface JobContext {
  /** DI container services (shaped by user module) */
  services: Record<string, unknown>;
  /** Job identifier */
  jobId: string;
  /** Current attempt number (starts at 1) */
  attemptNumber: number;
  /** Timestamp when the job was enqueued */
  enqueuedAt: Date;
  /** Optional logger scoped to the job */
  logger?: Logger;
}

/**
 * Job handler signature.
 */
export type JobHandler<TPayload> = (payload: TPayload, context: JobContext) => Promise<void> | void;

/**
 * Job definition with optional schema validation and retry configuration.
 */
export interface JobDefinition<TPayload> {
  /** Unique job name */
  name: string;
  /** Target queue (default resolved by JobService) */
  queue?: string;
  /**
   * Dead-letter queue name for operational documentation.
   * Configure the actual DLQ/redrive policy in your queue infrastructure
   * (e.g., SQS redrive policy pointing the primary queue to this DLQ).
   */
  deadLetterQueue?: string;
  /** Optional payload schema for validation */
  schema?: BaseSchema<TPayload, TPayload, BaseIssue<unknown>>;
  /**
   * Retry configuration for this job.
   *
   * - `undefined`: Default (25 retries, send to DLQ)
   * - `number`: Shorthand for { maxAttempts: N }
   * - `false`: Disable retries (discard on first failure)
   * - `RetryConfig`: Full configuration object
   */
  retry?: RetryConfig | number | false;
  /**
   * Optional uniqueness constraint. Intended for FIFO queues.
   * The deduplication key should be stable for the same logical job.
   */
  unique?: {
    key: (payload: TPayload) => string;
    /** Deduplication window (advisory; FIFO queues cap at 5 minutes) */
    window?: Duration;
  };
  /** Handler invoked by the worker */
  handler: JobHandler<TPayload>;
}

/**
 * Type-erased job definition for use in module registration.
 *
 * Use this type when registering jobs in modules to avoid the awkward
 * `as JobDefinition<unknown>` cast. This works because module registration
 * only needs to access the `name` property and invoke the handler dynamically.
 *
 * @example
 * ```typescript
 * // In your module:
 * export const MyModule = defineModule({
 *   jobs: [myJob], // No cast needed!
 * });
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Intentional - allows any JobDefinition to be registered
export type AnyJobDefinition = JobDefinition<any>;

/**
 * Job message sent to a queue.
 */
export interface JobMessage {
  /** Job type identifier */
  jobName: string;
  /** Serialized job payload */
  payload: unknown;
  /** Queue to use (default resolved by JobService/driver) */
  queue?: string;
  /** Optional client-provided job ID */
  jobId?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Result returned after enqueuing a job.
 */
export interface EnqueueResult {
  /** Queue-assigned message ID */
  messageId: string;
  /** Generated or provided job ID */
  jobId: string;
}

/**
 * Queue driver interface.
 *
 * Methods beyond `enqueue` are placeholders for later phases and may throw
 * until implemented by a driver.
 */
export interface QueueDriver {
  /** Driver name for logging/debugging */
  readonly name: string;
  /** Default queue name resolved by the driver (optional) */
  readonly defaultQueue?: string;

  /**
   * Enqueue a job for immediate processing.
   */
  enqueue(message: JobMessage): Promise<EnqueueResult>;

  /**
   * Enqueue a job for processing at a specific time.
   */
  enqueueAt?(message: JobMessage, at: Date): Promise<EnqueueResult>;

  /**
   * Enqueue a job for processing after a delay.
   */
  enqueueIn?(message: JobMessage, delay: Duration): Promise<EnqueueResult>;
}
