import type { JobRegistry } from '../job-registry.js';
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

  constructor(config: MockQueueDriverConfig = {}) {
    this.executeImmediately = config.executeImmediately ?? false;
    this.registry = config.registry;
    this.serviceResolver = config.serviceResolver;
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
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }

    const jobId = message.jobId ?? generateJobId();
    const result: EnqueueResult = {
      messageId: `mock-${++this.counter}`,
      jobId,
    };

    this.enqueued.push({
      message: { ...message, jobId },
    });

    // Execute immediately if configured
    if (this.executeImmediately && this.registry && this.serviceResolver) {
      const job = this.registry.getOrThrow(message.jobName);
      const context: JobContext = {
        services: this.serviceResolver(),
        jobId,
        attemptNumber: 1,
        enqueuedAt: new Date(),
      };
      await job.handler(message.payload, context);
    }

    return result;
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
