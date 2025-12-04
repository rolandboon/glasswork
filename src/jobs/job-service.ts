import { safeParse } from 'valibot';
import { InvalidJobPayloadError, PayloadTooLargeError } from './errors.js';
import type { EnqueueResult, JobDefinition, QueueDriver } from './types.js';
import { calculatePayloadSizeBytes } from './utils.js';

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
    this.defaultQueue = config.defaultQueue ?? 'default';
    this.maxPayloadBytes = config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  }

  /**
   * Enqueue a job for immediate processing.
   */
  async enqueue<TPayload>(job: JobDefinition<TPayload>, payload: TPayload): Promise<EnqueueResult> {
    this.validatePayload(job, payload);
    this.validatePayloadSize(payload);

    const queue = job.queue ?? this.defaultQueue;
    const result = await this.driver.enqueue({
      jobName: job.name,
      payload,
      queue,
    });

    await this.hooks?.onEnqueued?.(job, payload, result);
    return result;
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
}
