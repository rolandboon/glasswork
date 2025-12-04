import { asValue, createContainer, InjectionMode } from 'awilix';
import type { Context, EventBridgeEvent, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { safeParse } from 'valibot';
import { collectModules, registerModuleProviders, validateNoCycles } from '../core/bootstrap.js';
import type { ModuleConfig } from '../core/types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { InvalidJobPayloadError, PermanentJobError, TransientJobError } from './errors.js';
import { createJobRegistry, type JobRegistry } from './job-registry.js';
import type { JobContext, QueueDriver } from './types.js';

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
          });
        } catch (_error) {
          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      }

      return { batchItemFailures };
    }

    // Non-SQS invocation (e.g., EventBridge periodic jobs)
    const jobName = extractJobName(event);
    const payload = extractPayload(event);
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
    logger.error({ error }, 'Failed to resolve async providers');
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
  const parsed = JSON.parse(record.body);
  const jobName = parsed.jobName;
  const payload = parsed.payload;
  const jobId = parsed.jobId ?? record.messageId;
  const enqueuedAt = parsed.enqueuedAt ? new Date(parsed.enqueuedAt) : new Date();
  const attemptNumber = record.attributes?.ApproximateReceiveCount
    ? Number.parseInt(record.attributes.ApproximateReceiveCount, 10)
    : 1;

  const execution: JobExecution = {
    jobId,
    jobName,
    payload,
    attemptNumber,
    enqueuedAt,
  };

  await executeJob(execution, context);
}

async function executeJob(execution: JobExecution, context: ProcessContext): Promise<void> {
  const job = context.registry.getOrThrow(execution.jobName);
  const scope = context.moduleContainer.createScope();
  const services = scope.cradle;

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

    if (err instanceof PermanentJobError || err instanceof InvalidJobPayloadError) {
      jobLogger?.error({ err }, 'Job permanently failed');
      await context.hooks?.onJobDeadLetter?.(execution, jobContext, err);
      return;
    }

    if (err instanceof TransientJobError) {
      jobLogger?.warn({ err, retryAfter: err.retryAfter }, 'Job transient failure, retrying');
    }

    throw err;
  } finally {
    await scope.dispose();
  }
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
