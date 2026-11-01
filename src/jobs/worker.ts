import type { Context, EventBridgeEvent, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { createApplicationRuntime } from '../core/application-runtime.js';
import type {
  Environment,
  ExceptionTrackingOptions,
  ModuleConfig,
  ProviderOverride,
} from '../core/types.js';
import type { ExceptionTracker } from '../observability/exception-tracking.js';
import { createSanitizedExceptionTracker } from '../observability/sanitizers.js';
import { detectEnvironment } from '../utils/environment.js';
import { flushBudget } from '../utils/lambda-deadline.js';
import { createLogger, type Logger } from '../utils/logger.js';
import {
  executeJob,
  type JobExecution,
  type JobExecutionHooks,
  type JobScope,
} from './job-executor.js';
import { toJobExecution } from './job-message.js';
import { createJobRegistry, type JobRegistry } from './job-registry.js';
import type { JobMetricsConfig } from './observability/index.js';
import { generateJobId } from './utils.js';

export type { JobExecution } from './job-executor.js';

export interface WorkerConfig {
  module: ModuleConfig;
  hooks?: JobExecutionHooks;
  /** Replace providers, as with `bootstrap()`. */
  providerOverrides?: ProviderOverride[];
  /** Outside `test`, the worker runs `onModuleInit` hooks before the first job. */
  environment?: Environment;
  /**
   * Reports every failed attempt to the tracker, and waits up to `flushTimeoutMs` (default
   * 2000, never past the invocation's deadline) for the reports before each invocation
   * returns.
   */
  exceptionTracking?: Pick<ExceptionTrackingOptions, 'tracker' | 'flushTimeoutMs'>;
  logger?: Logger;
  /** Per-attempt EMF telemetry, enabled automatically in Lambda. */
  metrics?: JobMetricsConfig;
}

interface ProcessContext {
  registry: JobRegistry;
  /** Opens the scope of one execution in the module that declares the job. */
  openScope: (jobName: string) => JobScope;
  /** The root module's `logger` provider, else the worker's logger. */
  logger: Logger;
  hooks?: JobExecutionHooks;
  metrics?: JobMetricsConfig;
  /** Receives every failed attempt when exception tracking is configured. */
  tracker?: ExceptionTracker;
}

/**
 * Bootstrap a worker Lambda handler for processing jobs.
 * SQS event source mappings must enable FunctionResponseTypes:
 * ['ReportBatchItemFailures'] so returned failures are retried by Lambda.
 */
export function bootstrapWorker(config: WorkerConfig) {
  const logger = config.logger ?? createLogger('JobsWorker');
  // Once per execution environment. A failed start fails every invocation with its error.
  const statePromise = buildWorkerState(config, logger);
  statePromise.catch((error) => {
    try {
      logger.error('Worker failed to initialize; every invocation fails with this error', error);
    } catch {
      // Keep the original init rejection; diagnostics must not create an unhandled one.
    }
  });

  return async (
    event: SQSEvent | EventBridgeEvent<string, unknown> | Record<string, unknown>,
    ctx?: Context
  ) => {
    const state = await statePromise;
    const processContext: ProcessContext = {
      registry: state.registry,
      openScope: state.openScope,
      logger: state.rootLogger,
      hooks: config.hooks,
      metrics: config.metrics,
      tracker: state.tracker,
    };
    try {
      return await handleEvent(event, ctx, processContext);
    } finally {
      // Before returning: Lambda may freeze the environment afterwards.
      const result = await state.flush(
        flushBudget(ctx, config.exceptionTracking?.flushTimeoutMs ?? 2000, 500)
      );
      if (!result.completed) {
        try {
          logger.warn('Exception reports were still being sent when the invocation returned', {
            pending: result.pending,
          });
        } catch {
          // Reporting a flush timeout must not replace the business result.
        }
      }
    }
  };
}

async function handleEvent(
  event: SQSEvent | EventBridgeEvent<string, unknown> | Record<string, unknown>,
  ctx: Context | undefined,
  processContext: ProcessContext
) {
  if (isSQSEvent(event)) {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
    const isFifo = event.Records.some((record) => record.eventSourceARN?.endsWith('.fifo'));
    let hasFifoFailure = false;

    for (const record of event.Records) {
      if (hasFifoFailure) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        await processRecord(record, processContext);
      } catch (_error) {
        hasFifoFailure = isFifo;
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

  await runExecution(
    {
      jobName,
      jobId: `eb-${generateJobId()}`,
      payload,
      attemptNumber: extractAttemptNumber(ctx),
      enqueuedAt: new Date(),
    },
    processContext
  );

  return { success: true };
}

/** The same runtime as bootstrap(), started once per worker instance outside tests. */
async function buildWorkerState(config: WorkerConfig, logger: Logger) {
  const runtime = await createApplicationRuntime(config.module, {
    logger,
    providerOverrides: config.providerOverrides,
    exceptionTracking: config.exceptionTracking,
  });
  try {
    if ((config.environment ?? detectEnvironment()) !== 'test') await runtime.start();

    const container = runtime.container;
    const registry = buildJobRegistry(runtime.modules);
    // The registry only holds jobs from modules' `jobs`, so every job has an owning module.
    const openScope = (jobName: string): JobScope =>
      runtime.moduleRuntime.jobServices(jobName) as JobScope;
    const rootLogger = container.hasRegistration('logger')
      ? container.resolve<Logger>('logger')
      : logger;

    const tracker = config.exceptionTracking
      ? createSanitizedExceptionTracker(config.exceptionTracking.tracker)
      : undefined;
    return { registry, openScope, rootLogger, tracker, flush: runtime.flush };
  } catch (error) {
    await runtime.release();
    throw error;
  }
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

  const attemptNumber = record.attributes?.ApproximateReceiveCount
    ? Number.parseInt(record.attributes.ApproximateReceiveCount, 10) || 1
    : 1;
  const read = toJobExecution(parsed, { fallbackJobId: record.messageId, attemptNumber });
  if ('issues' in read) {
    context.logger.error('Invalid job message structure', {
      messageId: record.messageId,
      issues: read.issues,
    });
    throw new Error('Invalid job message structure');
  }
  const execution = read.execution;

  await runExecution(execution, context);
}

/** Acknowledges success and discarded failures; throws so the transport delivers again. */
async function runExecution(execution: JobExecution, context: ProcessContext): Promise<void> {
  const job = context.registry.getOrThrow(execution.jobName);
  const outcome = await executeJob(execution, {
    job,
    openScope: () => context.openScope(execution.jobName),
    logger: context.logger,
    hooks: context.hooks,
    metrics: context.metrics,
  });
  if (outcome.status !== 'success') report(outcome.error, outcome.status, execution, context);
  if (outcome.status === 'retry' || outcome.status === 'dead_letter') throw outcome.error;
}

/** Telemetry is best effort: a failing tracker never changes the outcome. */
function report(
  error: Error,
  status: string,
  execution: JobExecution,
  context: ProcessContext
): void {
  try {
    context.tracker?.captureException(error, {
      jobName: execution.jobName,
      jobId: execution.jobId,
      attemptNumber: execution.attemptNumber,
      outcome: status,
    });
  } catch {
    try {
      context.logger.warn('Failed to report a job failure', { jobName: execution.jobName });
    } catch {
      // Keep the execution outcome when both tracker and logger are unavailable.
    }
  }
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
