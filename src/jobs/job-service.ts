import { safeParse } from 'valibot';
import { EnqueueHookError, InvalidJobPayloadError, PayloadTooLargeError } from './errors.js';
import type {
  AnyJobDefinition,
  Duration,
  EnqueueableJob,
  EnqueueResult,
  QueueDriver,
} from './types.js';
import { calculatePayloadSizeBytes, durationToSeconds, toWirePayload } from './utils.js';

const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024; // 256KB

export interface JobServiceConfig {
  /** Default queue name when a job does not specify one */
  defaultQueue?: string;
  /** Override the payload size limit (defaults to 256KB) */
  maxPayloadBytes?: number;
}

/** One job in a batch; `key` identifies it in the per-item results. */
export interface BatchJob<TPayload, TOutput = TPayload> {
  job: EnqueueableJob<TPayload, TOutput>;
  payload: TPayload;
  key?: string;
}

/**
 * Outcome of one batch item, in input order. An accepted item whose `onEnqueued` hook failed
 * carries the hook's error in `hookError`; the job itself is enqueued.
 */
export type BatchEnqueueResult =
  | { index: number; key?: string; status: 'accepted'; result: EnqueueResult; hookError?: unknown }
  | { index: number; key?: string; status: 'rejected'; error: unknown };

export interface BatchEnqueueOptions {
  /** Maximum number of jobs being enqueued at the same time (default: 10). */
  concurrency?: number;
}

const DEFAULT_BATCH_CONCURRENCY = 10;

export interface JobServiceHooks {
  /** Called after a job is successfully enqueued */
  onEnqueued?: <TPayload, TOutput = TPayload>(
    job: EnqueueableJob<TPayload, TOutput>,
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
  async enqueue<TPayload, TOutput = TPayload>(
    job: EnqueueableJob<TPayload, TOutput>,
    payload: TPayload
  ): Promise<EnqueueResult> {
    this.validatePayload(job, payload);
    this.validatePayloadSize(payload);

    const queue = job.queue ?? this.defaultQueue;
    const jobId = this.getJobId(job, payload);
    const result = await this.driver.enqueue({
      jobName: job.name,
      payload,
      queue,
      jobId,
      __job: job as AnyJobDefinition,
    });

    return this.afterEnqueue(job, payload, result);
  }

  /**
   * Enqueue a job to run after a delay.
   */
  async enqueueIn<TPayload, TOutput = TPayload>(
    job: EnqueueableJob<TPayload, TOutput>,
    payload: TPayload,
    delay: Duration
  ): Promise<EnqueueResult> {
    this.validatePayload(job, payload);
    this.validatePayloadSize(payload);

    if (!this.driver.enqueueIn) {
      if (!this.driver.enqueueAt) {
        throw new Error(`Queue driver "${this.driver.name}" does not support delayed jobs`);
      }
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
        __job: job as AnyJobDefinition,
      },
      delay
    );

    return this.afterEnqueue(job, payload, result);
  }

  /**
   * Enqueue a job to run at a specific time.
   */
  async enqueueAt<TPayload, TOutput = TPayload>(
    job: EnqueueableJob<TPayload, TOutput>,
    payload: TPayload,
    at: Date
  ): Promise<EnqueueResult> {
    this.validatePayload(job, payload);
    this.validatePayloadSize(payload);

    if (!this.driver.enqueueAt) {
      if (!this.driver.enqueueIn) {
        throw new Error(`Queue driver "${this.driver.name}" does not support delayed jobs`);
      }
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
        __job: job as AnyJobDefinition,
      },
      at
    );

    return this.afterEnqueue(job, payload, result);
  }

  /**
   * Enqueue multiple jobs concurrently, all at once.
   *
   * Rejects with the first failure while the other jobs are still being enqueued, and those
   * can still be accepted afterwards. Use {@link enqueueBatchSettled} to learn which jobs
   * were accepted and to bound concurrency.
   */
  async enqueueBatch<TPayload, TOutput = TPayload>(
    jobs: Array<{ job: EnqueueableJob<TPayload, TOutput>; payload: TPayload }>
  ): Promise<EnqueueResult[]> {
    return Promise.all(jobs.map(({ job, payload }) => this.enqueue(job, payload)));
  }

  /**
   * Enqueue multiple jobs with bounded concurrency and report the outcome of each one.
   *
   * Never rejects because of a single job: every item gets an `accepted` or `rejected`
   * result in input order, so a caller can retry only the rejected items.
   */
  async enqueueBatchSettled<TPayload, TOutput = TPayload>(
    jobs: Array<BatchJob<TPayload, TOutput>>,
    options: BatchEnqueueOptions = {}
  ): Promise<BatchEnqueueResult[]> {
    const concurrency = options.concurrency ?? DEFAULT_BATCH_CONCURRENCY;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`Batch concurrency must be a positive integer, got ${concurrency}`);
    }

    const results: BatchEnqueueResult[] = new Array(jobs.length);
    let next = 0;
    const enqueueNext = async (): Promise<void> => {
      while (next < jobs.length) {
        const index = next++;
        const { job, payload, key } = jobs[index] as BatchJob<TPayload, TOutput>;
        const identity = key === undefined ? { index } : { index, key };
        try {
          results[index] = {
            ...identity,
            status: 'accepted',
            result: await this.enqueue(job, payload),
          };
        } catch (error) {
          results[index] =
            error instanceof EnqueueHookError
              ? { ...identity, status: 'accepted', result: error.result, hookError: error.cause }
              : { ...identity, status: 'rejected', error };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, enqueueNext));
    return results;
  }

  /** The job is enqueued once the driver returns; a failing hook must not hide that. */
  private async afterEnqueue<TPayload, TOutput>(
    job: EnqueueableJob<TPayload, TOutput>,
    payload: TPayload,
    result: EnqueueResult
  ): Promise<EnqueueResult> {
    try {
      await this.hooks?.onEnqueued?.(job, payload, result);
    } catch (error) {
      throw new EnqueueHookError(job.name, result, error);
    }
    return result;
  }

  private validatePayload<TPayload, TOutput>(
    job: EnqueueableJob<TPayload, TOutput>,
    payload: TPayload
  ): void {
    // Validate input here, but transport the original input. The worker parses it
    // independently so transforms are never applied to already transformed output.
    if (job.schema) {
      const result = safeParse(job.schema, payload);
      if (!result.success) {
        throw new InvalidJobPayloadError(job.name, result.issues);
      }
      // The worker receives the JSON form; reject input it would refuse on every attempt.
      const wire = safeParse(job.schema, toWirePayload(payload));
      if (!wire.success) {
        throw new InvalidJobPayloadError(
          job.name,
          wire.issues,
          'the payload no longer matches the schema after JSON transport. Send JSON values, ' +
            'for example a date as an ISO string with a transform to Date'
        );
      }
    }
  }

  private validatePayloadSize(payload: unknown): void {
    const sizeBytes = calculatePayloadSizeBytes(payload);
    if (sizeBytes > this.maxPayloadBytes) {
      throw new PayloadTooLargeError(sizeBytes, this.maxPayloadBytes);
    }
  }

  private getJobId<TPayload, TOutput>(
    job: EnqueueableJob<TPayload, TOutput>,
    payload: TPayload
  ): string | undefined {
    if (job.unique) {
      return job.unique.key(payload);
    }
    return undefined;
  }
}
