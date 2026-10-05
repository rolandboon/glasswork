import type { Logger } from '../../utils/logger.js';
import { createLogger } from '../../utils/logger.js';
import type { JobRegistry } from '../job-registry.js';
import { runJobAttempt } from '../job-runner.js';
import type { Duration, EnqueueResult, JobContext, JobMessage, QueueDriver } from '../types.js';
import { generateJobId } from '../utils.js';

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
   */
  serviceResolver?: () => Record<string, unknown>;
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
  readonly enqueued: MockEnqueuedJob[] = [];
  private readonly logger?: Logger;

  constructor(config: MockQueueDriverConfig = {}) {
    this.executeImmediately = config.executeImmediately ?? false;
    this.registry = config.registry;
    this.serviceResolver = config.serviceResolver;
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

    const services = this.serviceResolver();
    const logger = this.resolveLogger(services);
    const context = this.createJobContext({
      services,
      logger,
      jobId,
      jobName: message.jobName,
    });

    try {
      await runJobAttempt(job, message.payload, context);
    } catch (error) {
      logger.error('Local job attempt failed', { jobId, jobName: message.jobName, error });
      throw error;
    }
  }

  private resolveLogger(services: Record<string, unknown>): Logger {
    if (this.logger) return this.logger;
    let logger: Logger = createLogger('MockQueueDriver');

    try {
      if (services.logger) {
        logger = services.logger as Logger;
      }
    } catch {
      // logger not registered in DI container, use console
    }

    return logger;
  }

  private createJobContext({
    services,
    logger,
    jobId,
    jobName,
  }: {
    services: Record<string, unknown>;
    logger: Logger;
    jobId: string;
    jobName: string;
  }): JobContext {
    return {
      services,
      jobId,
      attemptNumber: 1,
      enqueuedAt: new Date(),
      logger: logger.child ? logger.child({ jobId, jobName }) : logger,
    };
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
