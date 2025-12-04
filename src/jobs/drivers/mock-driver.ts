import type {
  Duration,
  EnqueueResult,
  JobMessage,
  QueueDriver,
  ReceivedJob,
  ReceiveOptions,
} from '../types.js';
import { generateJobId } from '../utils.js';

export interface MockEnqueuedJob {
  message: JobMessage & { jobId: string };
  at?: Date;
  delay?: Duration;
}

/**
 * In-memory queue driver for testing.
 */
export class MockQueueDriver implements QueueDriver {
  readonly name = 'mock';
  private counter = 0;
  private failNext?: Error;
  readonly enqueued: MockEnqueuedJob[] = [];
  readonly acks: ReceivedJob[] = [];
  readonly nacks: Array<{ job: ReceivedJob; error?: Error }> = [];

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
    this.acks.length = 0;
    this.nacks.length = 0;
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

  async receive(_options?: ReceiveOptions): Promise<ReceivedJob[]> {
    return this.enqueued.map(({ message }) => ({
      message,
      receiptHandle: message.jobId,
    }));
  }

  async ack(job: ReceivedJob): Promise<void> {
    this.acks.push(job);
  }

  async nack(job: ReceivedJob, error?: Error): Promise<void> {
    this.nacks.push({ job, error });
  }
}
