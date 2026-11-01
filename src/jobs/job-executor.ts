import { requestContextStorage } from '../observability/request-context.js';
import { runWithoutTenant } from '../rls/context.js';
import type { Logger } from '../utils/logger.js';
import {
  InvalidJobPayloadError,
  PermanentJobError,
  RetryExhaustedError,
  TransientJobError,
} from './errors.js';
import { runJobAttempt } from './job-runner.js';
import {
  emitJobMetric,
  type JobExecutionStatus,
  type JobMetricsConfig,
} from './observability/index.js';
import type { AnyJobDefinition, JobContext, RetryConfig } from './types.js';

/** Default maximum attempts before a job is considered dead. */
const DEFAULT_MAX_ATTEMPTS = 25;

/** One delivery of a job, as a transport received it. */
export interface JobExecution {
  jobId: string;
  jobName: string;
  payload: unknown;
  attemptNumber: number;
  enqueuedAt: Date;
  /** Message metadata; `correlationId` becomes the request id of the execution's logs. */
  metadata?: Record<string, string>;
}

/** Hooks around each execution, with the same meaning for every transport. */
export interface JobExecutionHooks {
  onJobStart?: (job: JobExecution, context: JobContext) => Promise<void> | void;
  onJobComplete?: (job: JobExecution, context: JobContext) => Promise<void> | void;
  onJobFailed?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;
  onJobDeadLetter?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;
}

/** Services for one execution, and the disposal of their scope. */
export interface JobScope {
  services: Record<string, unknown>;
  dispose(): Promise<void>;
}

/**
 * What the transport should do with the delivery:
 * - `success`: acknowledge it.
 * - `failed`: acknowledge it; the job failed for good without a dead letter (retries
 *   disabled, or exhausted with `dead: false`).
 * - `retry`: deliver it again.
 * - `dead_letter`: move it to the dead-letter destination (on SQS: keep failing it until
 *   the queue's redrive policy does).
 */
export type JobOutcome =
  | { status: 'success' }
  | { status: 'failed' | 'retry' | 'dead_letter'; error: Error };

export interface ExecuteJobOptions {
  job: AnyJobDefinition;
  /** Opens the scope of this execution; it is disposed when the execution ends. */
  openScope: () => JobScope;
  /** Used when the scope has no `logger` provider. */
  logger?: Logger;
  /** Used instead of the scope's `logger` provider, for an explicitly configured logger. */
  overrideLogger?: Logger;
  hooks?: JobExecutionHooks;
  metrics?: JobMetricsConfig;
}

/**
 * Runs one delivery of a job and decides its outcome. Every transport uses it, so payload
 * validation, the job's own hooks, worker hooks, retry classification, logging, metrics and
 * scope disposal behave the same in-process, on SQS and on other queues. Transports only
 * map the outcome to their acknowledgement and retry mechanism.
 *
 * Each execution runs in its own context: it does not see the tenant or request context of
 * the code that started it, and logs carry `metadata.correlationId` or the job id as
 * request id.
 * @internal
 */
export async function executeJob(
  execution: JobExecution,
  options: ExecuteJobOptions
): Promise<JobOutcome> {
  const startedAt = new Date();
  const startTime = performance.now();
  const outcome = await isolate(execution, () => runInScope(execution, options));
  emitMetric(execution, outcome.status, startedAt, performance.now() - startTime, options);
  return outcome;
}

async function runInScope(execution: JobExecution, options: ExecuteJobOptions) {
  const scope = options.openScope();
  let logger: Logger | undefined;
  let outcome: JobOutcome;
  try {
    logger = options.overrideLogger
      ? bind(options.overrideLogger, execution)
      : scopedLogger(scope.services, options.logger, execution);
    const context: JobContext = {
      services: scope.services,
      jobId: execution.jobId,
      attemptNumber: execution.attemptNumber,
      enqueuedAt: execution.enqueuedAt,
      logger,
    };

    outcome = await attempt(execution, context, options);
  } catch (error) {
    // Only a throwing logger gets here; the scope is still disposed below.
    outcome = { status: 'retry', error: toError(error) };
  }
  try {
    await scope.dispose();
  } catch (error) {
    try {
      logger?.error('Failed to dispose the job scope', { err: error, jobId: execution.jobId });
    } catch {
      // Diagnostics must not replace the cleanup outcome.
    }
    // Cleanup errors reject an otherwise acknowledged delivery.
    if (outcome.status === 'success' || outcome.status === 'failed') {
      outcome = { status: 'retry', error: toError(error) };
    }
  }
  return outcome;
}

async function attempt(
  execution: JobExecution,
  context: JobContext,
  options: ExecuteJobOptions
): Promise<JobOutcome> {
  const { job, hooks } = options;
  try {
    await runJobAttempt(job, execution.payload, context, {
      onStart: () => hooks?.onJobStart?.(execution, context),
      onComplete: () => hooks?.onJobComplete?.(execution, context),
    });
    return { status: 'success' };
  } catch (error) {
    return classifyFailure(toError(error), execution, context, options);
  }
}

async function classifyFailure(
  error: Error,
  execution: JobExecution,
  context: JobContext,
  { job, hooks }: ExecuteJobOptions
): Promise<JobOutcome> {
  const decision = decide(error, execution, job, context.logger);
  try {
    await hooks?.onJobFailed?.(execution, context, error);
    if (decision.status === 'dead_letter' || decision.deadLetterHook) {
      await hooks?.onJobDeadLetter?.(execution, context, decision.error);
    }
  } catch (hookError) {
    // A failing hook must not acknowledge the delivery.
    return {
      status: decision.status === 'failed' ? 'retry' : decision.status,
      error: toError(hookError),
    };
  }
  return { status: decision.status, error: decision.error };
}

/** Classifies a failed attempt and logs it; hooks run afterwards. */
function decide(
  error: Error,
  execution: JobExecution,
  job: AnyJobDefinition,
  logger: Logger | undefined
): { status: 'failed' | 'retry' | 'dead_letter'; error: Error; deadLetterHook?: boolean } {
  const { maxAttempts, dead } = normalizeRetryConfig(job.retry);

  if (error instanceof PermanentJobError) {
    logger?.error('Job permanently failed', { err: error });
    return { status: 'dead_letter', error };
  }

  if (maxAttempts === false) {
    logger?.warn('Job failed with retries disabled, discarding', {
      err: error,
      jobName: execution.jobName,
      jobId: execution.jobId,
    });
    return { status: 'failed', error };
  }

  if (execution.attemptNumber >= maxAttempts) {
    const exhausted = new RetryExhaustedError(
      execution.jobName,
      execution.attemptNumber,
      maxAttempts,
      error
    );
    logger?.error('Job retries exhausted', {
      err: error,
      attemptNumber: execution.attemptNumber,
      maxAttempts,
      cause: error.message,
    });
    if (!dead) {
      logger?.info('Job discarded (dead: false)', {
        jobName: execution.jobName,
        jobId: execution.jobId,
      });
      return { status: 'failed', error: exhausted, deadLetterHook: true };
    }
    return { status: 'dead_letter', error: exhausted };
  }

  logRetry(error, execution, maxAttempts, logger);
  return { status: 'retry', error };
}

function logRetry(
  error: Error,
  execution: JobExecution,
  maxAttempts: number,
  logger: Logger | undefined
): void {
  if (error instanceof InvalidJobPayloadError) {
    logger?.warn('Invalid job payload, retrying until DLQ', {
      err: error,
      jobName: execution.jobName,
      jobId: execution.jobId,
      attemptNumber: execution.attemptNumber,
      maxAttempts,
    });
  } else if (error instanceof TransientJobError) {
    logger?.warn('Job transient failure, retrying', {
      err: error,
      retryAfter: error.retryAfter,
      attemptNumber: execution.attemptNumber,
      maxAttempts,
    });
  } else {
    logger?.warn('Job failed, will retry', {
      err: error,
      attemptNumber: execution.attemptNumber,
      maxAttempts,
      remainingAttempts: maxAttempts - execution.attemptNumber,
    });
  }
}

/** Runs an execution without the caller's tenant, under its own request context. */
function isolate<T>(execution: JobExecution, fn: () => Promise<T>): Promise<T> {
  return runWithoutTenant(() =>
    requestContextStorage.run(
      {
        requestId: execution.metadata?.correlationId ?? execution.jobId,
        method: 'JOB',
        path: execution.jobName,
        custom: { jobId: execution.jobId, attemptNumber: execution.attemptNumber },
      },
      fn
    )
  );
}

/** The scope's own `logger` provider, else the fallback, bound to the job. */
function scopedLogger(
  services: Record<string, unknown>,
  fallback: Logger | undefined,
  execution: JobExecution
): Logger | undefined {
  let logger = fallback;
  try {
    if ('logger' in services && services.logger) logger = services.logger as Logger;
  } catch {
    // An unregistered logger in a strict container; keep the fallback.
  }
  return logger && bind(logger, execution);
}

function bind(logger: Logger, execution: JobExecution): Logger {
  return logger.child
    ? logger.child({ jobId: execution.jobId, jobName: execution.jobName })
    : logger;
}

/** Telemetry must never turn a successful job into a retry or hide its original failure. */
function emitMetric(
  execution: JobExecution,
  status: JobExecutionStatus,
  startedAt: Date,
  durationMs: number,
  options: ExecuteJobOptions
): void {
  try {
    emitJobMetric(
      {
        jobName: execution.jobName,
        jobId: execution.jobId,
        status,
        attemptNumber: execution.attemptNumber,
        durationMs,
        enqueuedAt: execution.enqueuedAt,
        startedAt,
      },
      options.metrics
    );
  } catch {
    try {
      options.logger?.warn('Failed to emit job metrics', { jobName: execution.jobName });
    } catch {
      // A custom logger may also fail; observability remains best-effort.
    }
  }
}

/**
 * Normalize retry configuration. Zero or negative maxAttempts mean "no retries", like
 * `retry: false`.
 */
export function normalizeRetryConfig(config: RetryConfig | number | false | undefined): {
  maxAttempts: number | false;
  dead: boolean;
} {
  if (config === false) return { maxAttempts: false, dead: false };
  if (typeof config === 'number') {
    return config <= 0 ? { maxAttempts: false, dead: false } : { maxAttempts: config, dead: true };
  }
  if (config === undefined) return { maxAttempts: DEFAULT_MAX_ATTEMPTS, dead: true };
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (maxAttempts <= 0) return { maxAttempts: false, dead: false };
  return { maxAttempts, dead: config.dead ?? true };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
