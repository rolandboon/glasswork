import type { BaseIssue, BaseSchema } from 'valibot';
import type { Logger } from '../utils/logger.js';

/**
 * Duration expressed as human-readable string (e.g. "5m") or seconds as number.
 */
export type Duration = string | number;

/**
 * Retry configuration for jobs.
 * Phase 1 does not implement retries but the shape is defined for forward compatibility.
 */
export interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxAttempts?: number;
  /** Backoff strategy (default: exponential) */
  backoff?: 'exponential' | 'linear' | 'fixed';
  /** Initial delay between retries (default: 30s) */
  initialDelay?: Duration;
  /** Maximum delay cap (default: 1h) */
  maxDelay?: Duration;
  /** Whether to apply jitter to backoff timing (default: true) */
  jitter?: boolean;
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
  /** Optional payload schema for validation */
  schema?: BaseSchema<TPayload, TPayload, BaseIssue<unknown>>;
  /** Retry behavior (future phases) */
  retry?: RetryConfig;
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
 * Options for receiving jobs from a queue.
 */
export interface ReceiveOptions {
  /** Queue name to poll */
  queue?: string;
  /** Visibility timeout in seconds */
  visibilityTimeout?: number;
  /** Maximum number of messages to receive */
  maxMessages?: number;
  /** Long polling wait time in seconds */
  waitTimeSeconds?: number;
}

/**
 * Job representation when received from a driver.
 */
export interface ReceivedJob {
  /** Parsed message */
  message: JobMessage & { jobId: string };
  /** Driver-specific receipt handle */
  receiptHandle?: string;
  /** Raw driver payload */
  raw?: unknown;
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

  /**
   * Receive jobs from the queue (for worker processing).
   */
  receive?(options?: ReceiveOptions): Promise<ReceivedJob[]>;

  /**
   * Acknowledge successful job completion.
   */
  ack?(job: ReceivedJob): Promise<void>;

  /**
   * Reject a job (will be retried or sent to DLQ).
   */
  nack?(job: ReceivedJob, error?: Error): Promise<void>;
}
