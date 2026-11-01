import { normalizeRetryConfig } from '../job-executor.js';
import { toJobEnvelope } from '../job-message.js';
import type { Duration, EnqueueResult, JobMessage, QueueDriver } from '../types.js';
import { durationToSeconds } from '../utils.js';

/**
 * The pg-boss method the driver uses. A started `PgBoss` from `pg-boss` 12 fits; the driver
 * does not import pg-boss itself.
 */
export interface PgBossSender {
  send(name: string, data: object, options?: object): Promise<string | null>;
}

/** A pg-boss database adapter for one transaction, such as the result of `fromPrisma(tx)`. */
export interface PgBossDatabase {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface SendOptions {
  startAfter?: number | Date;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  deadLetter?: string;
  db?: PgBossDatabase;
}

export interface PgBossDriverConfig {
  /** A started pg-boss instance. The application creates, starts and stops it. */
  boss: PgBossSender;
  /** pg-boss queue for jobs without a `queue`. Default `default`. */
  defaultQueue?: string;
  /** Glasswork queue names mapped to pg-boss queue names; others are used as they are. */
  queues?: Record<string, string>;
  /**
   * pg-boss queue that receives a job whose last attempt failed, unless its `retry.dead` is
   * false. Create it like any queue. Without it, such jobs stay `failed` in their queue.
   */
  deadLetterQueue?: string;
  /** Seconds before a failed attempt is retried. Default 30. */
  retryDelaySeconds?: number;
  /** Doubles the retry delay per attempt. Default true. */
  retryBackoff?: boolean;
  /** Connection to insert through, set by `inTransaction()`. */
  db?: PgBossDatabase;
}

/**
 * Enqueues jobs into pg-boss queues, in the envelope the SQS driver also uses. A job's
 * `retry.maxAttempts` becomes pg-boss's retry limit, so pg-boss and the worker agree on the
 * last attempt.
 *
 * Requires the optional peer `pg-boss` 12 or later, which needs Node.js 22.12 or later.
 */
export class PgBossQueueDriver implements QueueDriver {
  readonly name = 'pg-boss';
  readonly defaultQueue: string;
  readonly #config: PgBossDriverConfig;

  constructor(config: PgBossDriverConfig) {
    this.#config = config;
    this.defaultQueue = config.defaultQueue ?? 'default';
  }

  /**
   * A driver that inserts jobs through the given connection, such as `fromPrisma(tx)` inside
   * a transaction: the jobs then commit or roll back with it. Pass the transaction's own
   * client; a send without it commits on pg-boss's pool and survives a rollback.
   */
  inTransaction(db: PgBossDatabase): PgBossQueueDriver {
    return new PgBossQueueDriver({ ...this.#config, db });
  }

  enqueue(message: JobMessage): Promise<EnqueueResult> {
    return this.#send(message, {});
  }

  enqueueAt(message: JobMessage, at: Date): Promise<EnqueueResult> {
    return this.#send(message, { startAfter: at });
  }

  enqueueIn(message: JobMessage, delay: Duration): Promise<EnqueueResult> {
    return this.#send(message, { startAfter: durationToSeconds(delay) });
  }

  async #send(message: JobMessage, options: SendOptions): Promise<EnqueueResult> {
    const config = this.#config;
    const envelope = toJobEnvelope(message);
    const { maxAttempts, dead } = normalizeRetryConfig(message.__job?.retry);
    const queue = message.queue ?? this.defaultQueue;
    const sendOptions: SendOptions = {
      ...options,
      retryLimit: maxAttempts === false ? 0 : maxAttempts - 1,
      retryDelay: config.retryDelaySeconds ?? 30,
      retryBackoff: config.retryBackoff ?? true,
      ...(dead && config.deadLetterQueue ? { deadLetter: config.deadLetterQueue } : {}),
      ...(config.db ? { db: config.db } : {}),
    };
    const id = await config.boss.send(config.queues?.[queue] ?? queue, envelope, sendOptions);
    if (!id) throw new Error(`pg-boss did not create job "${message.jobName}"`);
    return { messageId: id, jobId: envelope.jobId };
  }
}
