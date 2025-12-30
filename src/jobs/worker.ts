import { asValue, createContainer, InjectionMode } from 'awilix';
import type { Context, EventBridgeEvent, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { object, optional, record, safeParse, string, unknown } from 'valibot';
import { collectModules, registerModuleProviders, validateNoCycles } from '../core/bootstrap.js';
import type { ModuleConfig } from '../core/types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import {
  InvalidJobPayloadError,
  PermanentJobError,
  RetryExhaustedError,
  TransientJobError,
} from './errors.js';
import { createJobRegistry, type JobRegistry } from './job-registry.js';
import type { JobContext, RetryConfig } from './types.js';
import { generateJobId } from './utils.js';

/**
 * Default maximum retry attempts before a job is considered dead.
 */
const DEFAULT_MAX_ATTEMPTS = 25;

/**
 * Valibot schema for validating SQS job message structure.
 */
const JobMessageSchema = object({
  jobName: string(),
  payload: optional(unknown()),
  jobId: optional(string()),
  enqueuedAt: optional(string()),
  metadata: optional(record(string(), string())),
});

interface WorkerHooks {
  onJobStart?: (job: JobExecution, context: JobContext) => Promise<void> | void;
  onJobComplete?: (job: JobExecution, context: JobContext) => Promise<void> | void;
  onJobFailed?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;
  onJobDeadLetter?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;
}

export interface WorkerConfig {
  module: ModuleConfig;
  hooks?: WorkerHooks;
  logger?: Logger;
}

export interface JobExecution {
  jobId: string;
  jobName: string;
  payload: unknown;
  attemptNumber: number;
  enqueuedAt: Date;
  metadata?: Record<string, string>;
}

interface ProcessContext {
  registry: JobRegistry;
  moduleContainer: ReturnType<typeof createContainer>;
  hooks?: WorkerHooks;
  logger: Logger;
}

/**
 * Bootstrap a worker Lambda handler for processing jobs.
 */
export function bootstrapWorker(config: WorkerConfig) {
  const logger = config.logger ?? createLogger('JobsWorker');
  const statePromise = buildWorkerState(config.module, logger);

  return async (
    event: SQSEvent | EventBridgeEvent<string, unknown> | Record<string, unknown>,
    ctx?: Context
  ) => {
    const { container, registry } = await statePromise;

    if (isSQSEvent(event)) {
      const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

      for (const record of event.Records) {
        try {
          await processRecord(record, {
            registry,
            moduleContainer: container,
            hooks: config.hooks,
            logger,
          });
        } catch (_error) {
          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      }

      return { batchItemFailures };
    }

    // Non-SQS invocation (e.g., EventBridge periodic jobs)
    const jobName = extractJobName(event as Record<string, unknown>);
    const payload = extractPayload(event as Record<string, unknown>);
    if (!jobName) {
      throw new Error('Job name is required for non-SQS invocation');
    }

    // Extract attempt number from Lambda context retry metadata if available
    const attemptNumber = extractAttemptNumber(ctx);

    await executeJob(
      {
        jobName,
        jobId: `eb-${generateJobId()}`,
        payload,
        attemptNumber,
        enqueuedAt: new Date(),
      },
      { registry, moduleContainer: container, hooks: config.hooks, logger }
    );

    return { success: true };
  };
}

async function resolveAsyncFactories(
  container: ReturnType<typeof createContainer>,
  names: string[],
  logger: Logger
): Promise<void> {
  const resolutions = names.map(async (name) => {
    const resolved = container.resolve(name);
    const value = resolved instanceof Promise ? await resolved : resolved;
    container.register({ [name]: asValue(value) });
  });

  await Promise.all(resolutions).catch((error) => {
    logger.error('Failed to resolve async providers', { error });
    throw error;
  });
}

async function buildWorkerState(module: ModuleConfig, logger: Logger) {
  const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  const allModules = collectModules(module);
  validateNoCycles(allModules);

  // Register providers
  const asyncFactories: string[] = [];
  for (const mod of allModules) {
    const names = registerModuleProviders(mod, container, logger);
    asyncFactories.push(...names);
  }

  // Resolve async factories before processing jobs
  if (asyncFactories.length > 0) {
    await resolveAsyncFactories(container, asyncFactories, logger);
  }

  const registry = buildJobRegistry(allModules);

  return { container, registry };
}

function buildJobRegistry(modules: ModuleConfig[]): JobRegistry {
  const registry = createJobRegistry();
  for (const mod of modules) {
    if (mod.jobs) {
      for (const job of mod.jobs) {
        registry.register(job);
      }
    }
  }
  return registry;
}

async function processRecord(record: SQSRecord, context: ProcessContext): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.body);
  } catch (error) {
    context.logger.error('Failed to parse job message body', {
      error,
      messageId: record.messageId,
    });
    throw error;
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid job message payload');
  }

  // Validate message structure using Valibot
  const validationResult = safeParse(JobMessageSchema, parsed);
  if (!validationResult.success) {
    context.logger.error('Invalid job message structure', {
      messageId: record.messageId,
      issues: validationResult.issues,
    });
    throw new Error('Invalid job message structure');
  }

  const parsedMessage = parsed as {
    jobName: string;
    payload?: unknown;
    jobId?: string;
    enqueuedAt?: string;
    metadata?: Record<string, string>;
  };

  const jobName = parsedMessage.jobName;
  const payload = parsedMessage.payload;
  const jobId = parsedMessage.jobId ?? record.messageId;
  const enqueuedAt = parsedMessage.enqueuedAt ? new Date(parsedMessage.enqueuedAt) : new Date();
  const metadata = parsedMessage.metadata;

  const attemptNumber = record.attributes?.ApproximateReceiveCount
    ? Number.parseInt(record.attributes.ApproximateReceiveCount, 10) || 1
    : 1;

  const execution: JobExecution = {
    jobId,
    jobName,
    payload,
    attemptNumber,
    enqueuedAt,
    metadata,
  };

  await executeJob(execution, context);
}

async function executeJob(execution: JobExecution, context: ProcessContext): Promise<void> {
  const job = context.registry.getOrThrow(execution.jobName);

  // Normalize retry configuration
  const retryConfig = normalizeRetryConfig(job.retry);

  const scope = context.moduleContainer.createScope();
  const services = scope.cradle as Record<string, unknown>;

  const jobLogger = resolveJobLogger(context, execution);

  const jobContext: JobContext = {
    services,
    jobId: execution.jobId,
    attemptNumber: execution.attemptNumber,
    enqueuedAt: execution.enqueuedAt,
    logger: jobLogger,
  };

  try {
    await context.hooks?.onJobStart?.(execution, jobContext);

    if (job.schema) {
      const result = safeParse(job.schema, execution.payload);
      if (!result.success) {
        throw new InvalidJobPayloadError(job.name, result.issues);
      }
    }

    await job.handler(execution.payload, jobContext);

    await context.hooks?.onJobComplete?.(execution, jobContext);
  } catch (error) {
    await handleJobError(error as Error, execution, jobContext, context, retryConfig, jobLogger);
  } finally {
    await scope.dispose();
  }
}

/**
 * Resolve the logger for job execution, scoped to the job if possible.
 */
function resolveJobLogger(context: ProcessContext, execution: JobExecution): Logger | undefined {
  if (!context.moduleContainer.hasRegistration('logger')) {
    return context.logger;
  }
  const baseLogger = context.moduleContainer.resolve<Logger>('logger');
  return baseLogger?.child
    ? baseLogger.child({ jobId: execution.jobId, jobName: execution.jobName })
    : baseLogger;
}

/**
 * Handle job execution errors with retry logic.
 */
async function handleJobError(
  err: Error,
  execution: JobExecution,
  jobContext: JobContext,
  context: ProcessContext,
  retryConfig: { maxAttempts: number | false; dead: boolean },
  jobLogger: Logger | undefined
): Promise<never> {
  const { maxAttempts, dead: sendToDead } = retryConfig;

  // PermanentJobError: Never retry, go straight to DLQ
  if (err instanceof PermanentJobError) {
    jobLogger?.error('Job permanently failed', { err });
    await context.hooks?.onJobFailed?.(execution, jobContext, err);
    await context.hooks?.onJobDeadLetter?.(execution, jobContext, err);
    throw err;
  }

  // No retries configured: discard the job silently
  if (maxAttempts === false) {
    jobLogger?.warn('Job failed with retries disabled, discarding', {
      err,
      jobName: execution.jobName,
      jobId: execution.jobId,
    });
    await context.hooks?.onJobFailed?.(execution, jobContext, err);
    // Return without throwing to acknowledge and discard the message
    return undefined as never;
  }

  // Check if retries are exhausted
  if (execution.attemptNumber >= maxAttempts) {
    return handleExhaustedRetries(
      err,
      execution,
      jobContext,
      context,
      maxAttempts,
      sendToDead,
      jobLogger
    );
  }

  // Normal failure: log and throw to trigger SQS retry
  await context.hooks?.onJobFailed?.(execution, jobContext, err);
  logRetryableError(err, execution, maxAttempts, jobLogger);
  throw err;
}

/**
 * Handle the case when all retries are exhausted.
 */
async function handleExhaustedRetries(
  err: Error,
  execution: JobExecution,
  jobContext: JobContext,
  context: ProcessContext,
  maxAttempts: number,
  sendToDead: boolean,
  jobLogger: Logger | undefined
): Promise<never> {
  const exhaustedError = new RetryExhaustedError(
    execution.jobName,
    execution.attemptNumber,
    maxAttempts,
    err
  );

  jobLogger?.error('Job retries exhausted', {
    err,
    attemptNumber: execution.attemptNumber,
    maxAttempts,
    cause: err.message,
  });

  await context.hooks?.onJobFailed?.(execution, jobContext, err);
  await context.hooks?.onJobDeadLetter?.(execution, jobContext, exhaustedError);

  if (!sendToDead) {
    jobLogger?.info('Job discarded (dead: false)', {
      jobName: execution.jobName,
      jobId: execution.jobId,
    });
    // Return without throwing to discard
    return undefined as never;
  }

  throw exhaustedError;
}

/**
 * Log a retriable error with appropriate context.
 */
function logRetryableError(
  err: Error,
  execution: JobExecution,
  maxAttempts: number,
  jobLogger: Logger | undefined
): void {
  if (err instanceof InvalidJobPayloadError) {
    jobLogger?.warn('Invalid job payload, retrying until DLQ', {
      err,
      jobName: execution.jobName,
      jobId: execution.jobId,
      attemptNumber: execution.attemptNumber,
      maxAttempts,
    });
  } else if (err instanceof TransientJobError) {
    jobLogger?.warn('Job transient failure, retrying', {
      err,
      retryAfter: err.retryAfter,
      attemptNumber: execution.attemptNumber,
      maxAttempts,
    });
  } else {
    jobLogger?.warn('Job failed, will retry', {
      err,
      attemptNumber: execution.attemptNumber,
      maxAttempts,
      remainingAttempts: maxAttempts - execution.attemptNumber,
    });
  }
}

/**
 * Normalize retry configuration to a consistent format.
 * Zero or negative maxAttempts are treated as "no retries" (same as retry: false).
 */
function normalizeRetryConfig(config: RetryConfig | number | false | undefined): {
  maxAttempts: number | false;
  dead: boolean;
} {
  if (config === false) {
    return { maxAttempts: false, dead: false };
  }

  if (typeof config === 'number') {
    // Treat zero or negative as "no retries"
    if (config <= 0) {
      return { maxAttempts: false, dead: false };
    }
    return { maxAttempts: config, dead: true };
  }

  if (config === undefined) {
    return { maxAttempts: DEFAULT_MAX_ATTEMPTS, dead: true };
  }

  // Handle object config with potential invalid maxAttempts
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (maxAttempts <= 0) {
    return { maxAttempts: false, dead: false };
  }

  return {
    maxAttempts,
    dead: config.dead ?? true,
  };
}

/**
 * Type guard to check if an event is an SQS event.
 * Validates presence of Records array with SQS-specific properties.
 */
function isSQSEvent(event: unknown): event is SQSEvent {
  const maybeEvent = event as SQSEvent | undefined;
  if (!Array.isArray(maybeEvent?.Records) || maybeEvent.Records.length === 0) {
    return false;
  }
  const firstRecord = maybeEvent.Records[0];
  // Check for SQS-specific properties to distinguish from other AWS event types
  return (
    typeof firstRecord.messageId === 'string' &&
    typeof firstRecord.body === 'string' &&
    typeof firstRecord.receiptHandle === 'string'
  );
}

function extractJobName(event: Record<string, unknown>): string | undefined {
  if (typeof event.jobName === 'string') return event.jobName;
  const detail = event.detail as Record<string, unknown> | undefined;
  if (detail && typeof detail.jobName === 'string') return detail.jobName;
  if (detail && typeof detail.name === 'string') return detail.name;
  return undefined;
}

function extractPayload(event: Record<string, unknown>): unknown {
  if ('payload' in event) return (event as { payload: unknown }).payload;
  const detail = event.detail as Record<string, unknown> | undefined;
  if (detail && 'payload' in detail) return (detail as { payload: unknown }).payload;
  return undefined;
}

/**
 * Extract attempt number from Lambda context.
 * For EventBridge retries, checks for retry metadata in the context.
 */
function extractAttemptNumber(ctx?: Context): number {
  if (!ctx) return 1;
  // EventBridge retry information may be available in client context
  // or through environment variables in some configurations
  try {
    const clientContext = (ctx as { clientContext?: { custom?: { retryAttempt?: number } } })
      .clientContext;
    if (clientContext?.custom?.retryAttempt !== undefined) {
      return clientContext.custom.retryAttempt + 1;
    }
  } catch {
    // Ignore parsing errors
  }
  return 1;
}
