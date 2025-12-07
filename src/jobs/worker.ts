import { asValue, createContainer, InjectionMode } from 'awilix';
import type { Context, EventBridgeEvent, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { safeParse } from 'valibot';
import { collectModules, registerModuleProviders, validateNoCycles } from '../core/bootstrap.js';
import type { ModuleConfig } from '../core/types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { InvalidJobPayloadError, PermanentJobError, TransientJobError } from './errors.js';
import { createJobRegistry, type JobRegistry } from './job-registry.js';
import { MAX_SQS_DELAY_SECONDS, RUN_AT_METADATA_KEY } from './schedule-constants.js';
import type { JobContext, JobDefinition, QueueDriver } from './types.js';

interface WorkerHooks {
  onJobStart?: (job: JobExecution, context: JobContext) => Promise<void> | void;
  onJobComplete?: (job: JobExecution, context: JobContext) => Promise<void> | void;
  onJobFailed?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;
  onJobDeadLetter?: (job: JobExecution, context: JobContext, error: Error) => Promise<void> | void;
}

export interface WorkerConfig {
  module: ModuleConfig;
  driver?: QueueDriver;
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
  driver?: QueueDriver;
}

/**
 * Bootstrap a worker Lambda handler for processing jobs.
 */
export function bootstrapWorker(config: WorkerConfig) {
  const logger = config.logger ?? createLogger('JobsWorker');
  const statePromise = buildWorkerState(config.module, logger);

  return async (
    event: SQSEvent | EventBridgeEvent<string, unknown> | Record<string, unknown>,
    _ctx?: Context
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
            driver: config.driver,
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

    await executeJob(
      {
        jobName,
        jobId: 'event',
        payload,
        attemptNumber: 1,
        enqueuedAt: new Date(),
      },
      { registry, moduleContainer: container, hooks: config.hooks, logger, driver: config.driver }
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

  const parsedMessage = parsed as {
    jobName?: string;
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
  if (!jobName) {
    throw new Error('Job name is required');
  }
  const attemptNumber = record.attributes?.ApproximateReceiveCount
    ? Number.parseInt(record.attributes.ApproximateReceiveCount, 10)
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

  if (await rescheduleIfNotDue(execution, job, context)) {
    return;
  }

  const scope = context.moduleContainer.createScope();
  const services = scope.cradle as Record<string, unknown>;

  let jobLogger: Logger | undefined = context.logger;
  if (context.moduleContainer.hasRegistration('logger')) {
    const baseLogger = context.moduleContainer.resolve<Logger>('logger');
    jobLogger = baseLogger?.child
      ? baseLogger.child({ jobId: execution.jobId, jobName: execution.jobName })
      : baseLogger;
  }

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
    const err = error as Error;
    await context.hooks?.onJobFailed?.(execution, jobContext, err);

    if (err instanceof PermanentJobError) {
      jobLogger?.error('Job permanently failed', { err });
      await context.hooks?.onJobDeadLetter?.(execution, jobContext, err);
      return;
    }

    if (err instanceof InvalidJobPayloadError) {
      jobLogger?.warn('Invalid job payload, retrying until DLQ', {
        err,
        jobName: execution.jobName,
        jobId: execution.jobId,
        attemptNumber: execution.attemptNumber,
      });
      throw err;
    }

    if (err instanceof TransientJobError) {
      jobLogger?.warn('Job transient failure, retrying', { err, retryAfter: err.retryAfter });
    }

    throw err;
  } finally {
    await scope.dispose();
  }
}

async function rescheduleIfNotDue(
  execution: JobExecution,
  job: JobDefinition<unknown>,
  context: ProcessContext
): Promise<boolean> {
  const runAtValue = execution.metadata?.[RUN_AT_METADATA_KEY];
  if (!runAtValue) {
    return false;
  }

  const runAt = new Date(runAtValue);
  if (Number.isNaN(runAt.getTime())) {
    context.logger.warn('Ignoring invalid runAt metadata; executing immediately', {
      jobName: execution.jobName,
      jobId: execution.jobId,
      runAt: runAtValue,
    });
    return false;
  }

  const remainingMs = runAt.getTime() - Date.now();
  if (remainingMs <= 1000) {
    return false;
  }

  const driver = context.driver;
  if (!driver || (!driver.enqueueIn && !driver.enqueueAt)) {
    context.logger.warn('Job scheduled in future but worker has no driver; executing now', {
      jobName: execution.jobName,
      jobId: execution.jobId,
      runAt: runAtValue,
    });
    return false;
  }

  const delaySeconds = Math.min(MAX_SQS_DELAY_SECONDS, Math.max(1, Math.floor(remainingMs / 1000)));

  const message = {
    jobName: job.name,
    payload: execution.payload,
    queue: job.queue,
    jobId: execution.jobId,
    metadata: {
      ...execution.metadata,
      [RUN_AT_METADATA_KEY]: runAtValue,
    },
  };

  if (driver.enqueueIn) {
    await driver.enqueueIn(message, delaySeconds);
  } else if (driver.enqueueAt) {
    await driver.enqueueAt(message, runAt);
  }

  context.logger.info('Deferred job that is not due yet', {
    jobName: execution.jobName,
    jobId: execution.jobId,
    runAt: runAtValue,
    delaySeconds,
  });

  return true;
}

function isSQSEvent(event: unknown): event is SQSEvent {
  return Boolean((event as SQSEvent)?.Records);
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
