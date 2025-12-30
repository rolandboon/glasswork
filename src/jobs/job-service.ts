import { safeParse } from 'valibot';
import { InvalidJobPayloadError, PayloadTooLargeError } from './errors.js';
import type { Duration, EnqueueResult, JobDefinition, QueueDriver } from './types.js';
import { calculatePayloadSizeBytes, durationToSeconds } from './utils.js';

const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024; // 256KB

export interface JobServiceConfig {
  /** Default queue name when a job does not specify one */
  defaultQueue?: string;
  /** Override the payload size limit (defaults to 256KB) */
  maxPayloadBytes?: number;
}

export interface JobServiceHooks {
  /** Called after a job is successfully enqueued */
  onEnqueued?: <TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    result: EnqueueResult
  ) => Promise<void> | void;
}

/**
 * Service responsible for enqueuing jobs.
 */
export class JobService {
  private readonly defaultQueue: string;
  private readonly maxPayloadBytes: number;

  constructor(
    private readonly driver: QueueDriver,
    config: JobServiceConfig = {},
    private readonly hooks?: JobServiceHooks
  ) {
    this.defaultQueue = config.defaultQueue ?? driver.defaultQueue ?? 'default';
    this.maxPayloadBytes = config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  }

  /**
   * Enqueue a job for immediate processing.
   */
  async enqueue<TPayload>(job: JobDefinition<TPayload>, payload: TPayload): Promise<EnqueueResult> {
    this.validatePayload(job, payload);
    this.validatePayloadSize(payload);

    const queue = job.queue ?? this.defaultQueue;
    const jobId = this.getJobId(job, payload);
    const result = await this.driver.enqueue({
      jobName: job.name,
      payload,
      queue,
      jobId,
    });

    await this.hooks?.onEnqueued?.(job, payload, result);
    return result;
  }

  /**
   * Enqueue a job to run after a delay.
   */
  async enqueueIn<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    delay: Duration
  ): Promise<EnqueueResult> {
    this.validatePayload(job, payload);
    this.validatePayloadSize(payload);

    if (!this.driver.enqueueIn) {
      const seconds = durationToSeconds(delay);
      return this.enqueueAt(job, payload, new Date(Date.now() + seconds * 1000));
    }

    const queue = job.queue ?? this.defaultQueue;
    const jobId = this.getJobId(job, payload);

    const result = await this.driver.enqueueIn(
      {
        jobName: job.name,
        payload,
        queue,
        jobId,
      },
      delay
    );

    await this.hooks?.onEnqueued?.(job, payload, result);
    return result;
  }

  /**
   * Enqueue a job to run at a specific time.
   */
  async enqueueAt<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    at: Date
  ): Promise<EnqueueResult> {
    this.validatePayload(job, payload);
    this.validatePayloadSize(payload);

    if (!this.driver.enqueueAt) {
      const delaySeconds = Math.max(0, Math.floor((at.getTime() - Date.now()) / 1000));
      return this.enqueueIn(job, payload, delaySeconds);
    }

    const queue = job.queue ?? this.defaultQueue;
    const jobId = this.getJobId(job, payload);

    const result = await this.driver.enqueueAt(
      {
        jobName: job.name,
        payload,
        queue,
        jobId,
      },
      at
    );

    await this.hooks?.onEnqueued?.(job, payload, result);
    return result;
  }

  /**
   * Enqueue multiple jobs sequentially.
   */
  async enqueueBatch<TPayload>(
    jobs: Array<{ job: JobDefinition<TPayload>; payload: TPayload }>
  ): Promise<EnqueueResult[]> {
    return Promise.all(jobs.map(({ job, payload }) => this.enqueue(job, payload)));
  }

  private validatePayload<TPayload>(job: JobDefinition<TPayload>, payload: TPayload): void {
    if (job.schema) {
      const result = safeParse(job.schema, payload);
      if (!result.success) {
        throw new InvalidJobPayloadError(job.name, result.issues);
      }
    }
  }

  private validatePayloadSize(payload: unknown): void {
    const sizeBytes = calculatePayloadSizeBytes(payload);
    if (sizeBytes > this.maxPayloadBytes) {
      throw new PayloadTooLargeError(sizeBytes, this.maxPayloadBytes);
    }
  }

  private getJobId<TPayload>(job: JobDefinition<TPayload>, payload: TPayload): string | undefined {
    if (job.unique) {
      return job.unique.key(payload);
    }
    return undefined;
  }
}
