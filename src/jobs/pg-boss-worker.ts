import type { AwilixContainer } from 'awilix';
import { resolveJobServices } from '../core/job-services.js';
import { throwFailures } from '../core/lifecycle.js';
import { createLogger, type Logger } from '../utils/logger.js';
import type { PgBossSender } from './drivers/pg-boss-driver.js';
import { executeJob, type JobExecutionHooks } from './job-executor.js';
import { toJobExecution } from './job-message.js';
import type { JobMetricsConfig } from './observability/index.js';

/** The fields of a claimed pg-boss job the worker reads. */
export interface PgBossJob {
  id: string;
  name: string;
  data: unknown;
  retryCount: number;
  retryLimit: number;
}

interface PgBossWorkOptions {
  batchSize: number;
  includeMetadata: true;
  localConcurrency: number;
  pollingIntervalSeconds?: number;
}

/**
 * The pg-boss methods the worker uses. A started `PgBoss` from `pg-boss` 12 fits; the worker
 * does not import pg-boss itself.
 */
export interface PgBossConsumer extends PgBossSender {
  work(
    name: string,
    options: PgBossWorkOptions,
    handler: (jobs: PgBossJob[]) => Promise<void>
  ): Promise<string>;
  offWork(name: string, options?: { id?: string; wait?: boolean }): Promise<void>;
}

export interface PgBossWorkerConfig {
  /** A started pg-boss instance. The application creates, starts and stops it. */
  boss: PgBossConsumer;
  /**
   * The container of `bootstrap()` or `bootstrapRuntime()`. Each job runs in a new scope of
   * the module that declares it, as in the SQS worker.
   */
  container: AwilixContainer;
  /** pg-boss queues to work. */
  queues: string[];
  /** Jobs processed at the same time per queue in this process. Default 1. */
  concurrency?: number;
  /** Seconds between polls when a queue is empty, at least 0.5. Default pg-boss's 2. */
  pollingIntervalSeconds?: number;
  /**
   * Where a permanent failure goes before its last attempt. Use the driver's
   * `deadLetterQueue`. Without it, pg-boss retries the job until its retry limit.
   */
  deadLetterQueue?: string;
  hooks?: JobExecutionHooks;
  logger?: Logger;
  metrics?: JobMetricsConfig;
}

export interface PgBossWorker {
  /** Starts claiming jobs from the queues. Concurrent calls share completion and failures; a stopped worker cannot restart. */
  start(): Promise<void>;
  /**
   * Stops only this worker’s registrations and waits for their jobs in progress, including during startup. Use it as a drain step of
   * `serveNode()`, whose deadline bounds the wait.
   */
  stop(): Promise<void>;
}

/**
 * A long-running pg-boss consumer that runs each job through the same executor as the SQS
 * worker: same module scope, validation, hooks and failure classification. pg-boss claims
 * jobs with `SKIP LOCKED`, retries within the retry limit the driver set, and makes the work
 * of a crashed process available again once it expires.
 *
 * Outcomes map to pg-boss as follows: success and discarded failures complete the job; a
 * retryable failure fails the attempt, so pg-boss retries it; a permanent failure goes to
 * `deadLetterQueue` at once, and a failure on the last attempt to pg-boss's dead letter.
 */
export function createPgBossWorker(config: PgBossWorkerConfig): PgBossWorker {
  const logger = config.logger ?? createLogger('Glasswork:PgBoss');
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let stopRequested = false;
  let cleanup: Promise<void> | undefined;
  const registrations: Array<{ queue: string; id: string }> = [];

  function stopRegistrations(): Promise<void> {
    cleanup ??= Promise.allSettled(
      registrations.map(async ({ queue, id }) => config.boss.offWork(queue, { id, wait: true }))
    ).then((results) => {
      throwFailures(
        results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
        'Stopping pg-boss consumers failed'
      );
    });
    return cleanup;
  }

  async function releaseAfterFailure(): Promise<void> {
    try {
      await stopRegistrations();
    } catch (cleanupError) {
      try {
        logger.error('Cleanup after pg-boss worker startup failed', cleanupError);
      } catch {
        /* Preserve the startup error. */
      }
    }
  }

  async function register(): Promise<void> {
    try {
      for (const queue of config.queues) {
        if (stopRequested) break;
        const id = await config.boss.work(
          queue,
          {
            batchSize: 1,
            includeMetadata: true,
            localConcurrency: config.concurrency ?? 1,
            ...(config.pollingIntervalSeconds
              ? { pollingIntervalSeconds: config.pollingIntervalSeconds }
              : {}),
          },
          handle
        );
        registrations.push({ queue, id });
      }
    } catch (error) {
      await releaseAfterFailure();
      throw error;
    }
  }

  async function handle([job]: PgBossJob[]): Promise<void> {
    if (!job) return;
    const read = toJobExecution(job.data, {
      fallbackJobId: job.id,
      attemptNumber: job.retryCount + 1,
    });
    if ('issues' in read) {
      logger.error('Invalid job message structure', { jobId: job.id, queue: job.name });
      throw new Error('Invalid job message structure');
    }
    const scope = resolveJobServices(
      config.container.cradle as Record<string, unknown>,
      read.execution.jobName
    );
    if (!scope) throw new Error(`No module declares job "${read.execution.jobName}"`);

    const outcome = await executeJob(read.execution, {
      job: scope.job,
      openScope: () => scope,
      logger,
      hooks: config.hooks,
      metrics: config.metrics,
    });
    if (outcome.status === 'success' || outcome.status === 'failed') return;
    if (
      outcome.status === 'dead_letter' &&
      job.retryCount < job.retryLimit &&
      config.deadLetterQueue
    ) {
      // pg-boss would retry a permanent failure; move it to the dead letter queue instead.
      const id = await config.boss.send(config.deadLetterQueue, job.data as object);
      if (!id) throw new Error('pg-boss did not accept the dead-letter job');
      return;
    }
    throw outcome.error;
  }

  return {
    start() {
      if (stopRequested) return Promise.reject(new Error('The pg-boss worker has been stopped'));
      starting ??= register();
      return starting;
    },
    stop() {
      stopRequested = true;
      stopping ??= (async () => {
        // A pending work() registration must become visible before it can be stopped.
        try {
          await starting;
        } catch {
          /* register() already cleaned up partial startup. */
        }
        await stopRegistrations();
      })();
      return stopping;
    },
  };
}
