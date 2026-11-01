import { resolveJobServices } from '../../core/job-services.js';
import type { Logger } from '../../utils/logger.js';
import { createLogger } from '../../utils/logger.js';
import { executeJob, type JobExecutionHooks } from '../job-executor.js';
import type { JobRegistry } from '../job-registry.js';
import type { Duration, EnqueueResult, JobMessage, QueueDriver } from '../types.js';
import { generateJobId, toWirePayload } from '../utils.js';

export interface MockEnqueuedJob {
  message: JobMessage & { jobId: string };
  at?: Date;
  delay?: Duration;
}

/**
 * Configuration for MockQueueDriver.
 */
export interface MockQueueDriverConfig {
  logger?: Logger;
  /**
   * Execute jobs synchronously when enqueued.
   * Useful for local development to test job handlers immediately.
   * @default false
   */
  executeImmediately?: boolean;

  /**
   * Job registry for looking up job definitions.
   * Required when executeImmediately is true.
   */
  registry?: JobRegistry;

  /**
   * Resolver to get DI services for job execution.
   * Called when a job is executed, returning the services container.
   * Required when executeImmediately is true.
   *
   * When it returns a module's injected services (the cradle a factory receives), a job
   * declared in a module's `jobs` runs in a new scope of that module, like in the worker.
   * Other jobs, and plain objects, use the returned services as-is.
   */
  serviceResolver?: () => Record<string, unknown>;

  /**
   * Hooks around each local execution, with the same meaning as `bootstrapWorker`'s hooks.
   */
  hooks?: JobExecutionHooks;
}

/**
 * In-memory queue driver for testing and local development.
 *
 * @example Testing mode (default)
 * ```typescript
 * const driver = new MockQueueDriver();
 * await jobService.enqueue(myJob, payload);
 * expect(driver.enqueued).toHaveLength(1);
 * ```
 *
 * @example Development mode with immediate execution
 * ```typescript
 * const driver = new MockQueueDriver({
 *   executeImmediately: true,
 *   registry: createJobRegistry([myJob]),
 *   serviceResolver: () => diContainer,
 * });
 * ```
 */
export class MockQueueDriver implements QueueDriver {
  readonly name = 'mock';
  private counter = 0;
  private failNext?: Error;
  private readonly executeImmediately: boolean;
  private readonly registry?: JobRegistry;
  private readonly serviceResolver?: () => Record<string, unknown>;
  private readonly hooks?: JobExecutionHooks;
  readonly enqueued: MockEnqueuedJob[] = [];
  private readonly logger?: Logger;

  constructor(config: MockQueueDriverConfig = {}) {
    this.executeImmediately = config.executeImmediately ?? false;
    this.registry = config.registry;
    this.serviceResolver = config.serviceResolver;
    this.hooks = config.hooks;
    this.logger = config.logger;
  }

  /**
   * Simulate the next enqueue call failing.
   */
  simulateFailure(error = new Error('Mock enqueue failure')): void {
    this.failNext = error;
  }

  /**
   * Clear stored jobs and reset counters.
   */
  clear(): void {
    this.enqueued.length = 0;
    this.counter = 0;
    this.failNext = undefined;
  }

  get lastJob(): MockEnqueuedJob | undefined {
    return this.enqueued.at(-1);
  }

  async enqueue(message: JobMessage): Promise<EnqueueResult> {
    this.throwPendingFailure();

    const jobId = message.jobId ?? generateJobId();
    const result: EnqueueResult = {
      messageId: `mock-${++this.counter}`,
      jobId,
    };

    this.storeEnqueuedMessage(message, jobId);

    await this.executeEnqueuedJob(message, jobId);

    return result;
  }

  private throwPendingFailure(): void {
    if (!this.failNext) {
      return;
    }

    const error = this.failNext;
    this.failNext = undefined;
    throw error;
  }

  private storeEnqueuedMessage(message: JobMessage, jobId: string): void {
    this.enqueued.push({
      message: { ...message, jobId },
    });
  }

  private async executeEnqueuedJob(message: JobMessage, jobId: string): Promise<void> {
    if (!this.executeImmediately || !this.serviceResolver) {
      return;
    }

    const job =
      message.__job || (this.registry ? this.registry.getOrThrow(message.jobName) : undefined);

    if (!job) {
      this.warnMissingJobDefinition(message.jobName);
      return;
    }

    const resolved = this.serviceResolver();
    // A job declared in a module runs in a new scope of that module, like in the worker.
    const openScope = () =>
      resolveJobServices(resolved, message.jobName) ?? {
        services: resolved,
        dispose: async () => {},
      };

    // Run with the payload a worker would receive after JSON transport. There is no
    // redelivery here, so every failure reaches the caller of enqueue().
    const outcome = await executeJob(
      {
        jobId,
        jobName: message.jobName,
        payload: toWirePayload(message.payload),
        attemptNumber: 1,
        enqueuedAt: new Date(),
        metadata: message.metadata,
      },
      {
        job,
        openScope,
        logger: createLogger('MockQueueDriver'),
        overrideLogger: this.logger,
        hooks: this.hooks,
      }
    );
    if (outcome.status !== 'success') throw outcome.error;
  }

  private warnMissingJobDefinition(jobName: string): void {
    (this.logger ?? createLogger('MockQueueDriver')).warn(
      `[MockQueueDriver] Could not execute job "${jobName}" immediately because ` +
        `no job definition was provided and no JobRegistry is configured.`
    );
  }

  async enqueueAt(message: JobMessage, at: Date): Promise<EnqueueResult> {
    const result = await this.enqueue(message);
    const last = this.enqueued[this.enqueued.length - 1];
    if (last) {
      last.at = at;
    }
    return result;
  }

  async enqueueIn(message: JobMessage, delay: Duration): Promise<EnqueueResult> {
    const result = await this.enqueue(message);
    const last = this.enqueued[this.enqueued.length - 1];
    if (last) {
      last.delay = delay;
    }
    return result;
  }
}
