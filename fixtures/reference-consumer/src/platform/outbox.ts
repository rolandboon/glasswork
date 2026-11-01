import { randomUUID } from 'node:crypto';
import { getRequestId } from 'glasswork/observability';
import type { Prisma } from '../generated/prisma/client.js';
import type { Database, Transaction } from './database.module.js';

/** What a relay publishes and a consumer receives. */
export interface EventEnvelope<TPayload = unknown> {
  id: string;
  type: string;
  payloadVersion: number;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string | null;
  actorUserId: string | null;
  occurredAt: string;
  payload: TPayload;
}

export interface NewEvent<TPayload> {
  type: string;
  payloadVersion: number;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  actorUserId?: string;
  payload: TPayload;
}

export interface Outbox {
  /** Stores the event in the caller's transaction and returns its id. */
  add<TPayload extends Prisma.InputJsonValue>(event: NewEvent<TPayload>): Promise<string>;
}

/** The outbox of one transaction: events commit or roll back with the change. */
export function outboxIn(tx: Transaction): Outbox {
  return {
    async add(event) {
      const id = randomUUID();
      await tx.outboxMessage.create({
        data: {
          id,
          tenantId: event.tenantId,
          type: event.type,
          payloadVersion: event.payloadVersion,
          payload: event.payload,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          actorUserId: event.actorUserId ?? null,
          correlationId: getRequestId() ?? null,
        },
      });
      return id;
    },
  };
}

/** Sends an event to a broker. It may be called more than once for the same event. */
export interface EventPublisher {
  publish(event: EventEnvelope): Promise<void>;
}

export interface OutboxRelayOptions {
  /** Messages claimed per batch. Default 25. */
  batchSize?: number;
  /** How long a claim lasts before another relay may take the message over. Default 60. */
  leaseSeconds?: number;
  /** Attempts before a message is marked `failed`. Default 5. */
  maxAttempts?: number;
  /** Delay before a failed attempt is retried. Default 30. */
  retryDelaySeconds?: number;
}

export interface RelayResult {
  claimed: number;
  published: number;
  failed: number;
}

interface ClaimedMessage {
  id: string;
  sequence: bigint;
  tenantId: string;
  type: string;
  payloadVersion: number;
  payload: unknown;
  aggregateType: string;
  aggregateId: string;
  correlationId: string | null;
  actorUserId: string | null;
  createdAt: Date;
}

/**
 * Claims the oldest open message of each aggregate. A message is open while it is pending
 * or failed, so a later message of the same aggregate waits until the earlier one is
 * published or discarded. SKIP LOCKED lets concurrent relays claim different messages.
 */
const claimSql = `
  UPDATE "OutboxMessage" AS m
  SET "claimedBy" = $1,
      "claimedUntil" = LOCALTIMESTAMP + make_interval(secs => $2::double precision),
      attempts = m.attempts + 1
  WHERE m.id IN (
    SELECT o.id FROM "OutboxMessage" AS o
    WHERE o.status = 'pending'
      AND (o."claimedUntil" IS NULL OR o."claimedUntil" < LOCALTIMESTAMP)
      AND NOT EXISTS (
        SELECT 1 FROM "OutboxMessage" AS earlier
        WHERE earlier."tenantId" = o."tenantId"
          AND earlier."aggregateType" = o."aggregateType"
          AND earlier."aggregateId" = o."aggregateId"
          AND earlier.status IN ('pending', 'failed')
          AND earlier.sequence < o.sequence
      )
    ORDER BY o.sequence
    LIMIT $3::int
    FOR UPDATE SKIP LOCKED
  )
  RETURNING m.id, m.sequence, m."tenantId", m.type, m."payloadVersion", m.payload,
    m."aggregateType", m."aggregateId", m."correlationId", m."actorUserId", m."createdAt"`;

const confirmSql = `
  UPDATE "OutboxMessage"
  SET status = 'published', "publishedAt" = LOCALTIMESTAMP,
      "claimedBy" = NULL, "claimedUntil" = NULL, "lastError" = NULL
  WHERE id = $1 AND "claimedBy" = $2`;

const releaseSql = `
  UPDATE "OutboxMessage"
  SET status = CASE WHEN attempts >= $3::int THEN 'failed' ELSE 'pending' END,
      "lastError" = $2,
      "claimedBy" = NULL,
      "claimedUntil" = LOCALTIMESTAMP + make_interval(secs => $4::double precision)
  WHERE id = $1 AND "claimedBy" = $5`;

/**
 * Publishes committed outbox messages: it claims a batch in one short statement, publishes
 * each message with no transaction open, and confirms it in another short statement. A
 * relay that stops after publishing and before confirming leaves the claim to expire, and
 * the next relay publishes the message again: delivery is at least once.
 */
export class OutboxRelay {
  readonly #prisma: Database;
  readonly #publisher: EventPublisher;
  readonly #options: Required<OutboxRelayOptions>;

  constructor(dependencies: {
    prisma: Database;
    eventPublisher: EventPublisher;
    outboxOptions?: OutboxRelayOptions;
  }) {
    this.#prisma = dependencies.prisma;
    this.#publisher = dependencies.eventPublisher;
    this.#options = {
      batchSize: 25,
      leaseSeconds: 60,
      maxAttempts: 5,
      retryDelaySeconds: 30,
      ...dependencies.outboxOptions,
    };
  }

  get batchSize() {
    return this.#options.batchSize;
  }

  async relayBatch(limit = this.#options.batchSize): Promise<RelayResult> {
    // Each batch gets a token: an expired batch cannot confirm a later claim, even
    // when both calls use the same relay instance.
    const claimId = randomUUID();
    const claimed = await this.#prisma.$queryRawUnsafe<ClaimedMessage[]>(
      claimSql,
      claimId,
      this.#options.leaseSeconds,
      limit
    );
    claimed.sort((a, b) => (a.sequence < b.sequence ? -1 : 1));

    let published = 0;
    for (const message of claimed) {
      try {
        await this.#publisher.publish(toEnvelope(message));
        const confirmed = await this.#prisma.$executeRawUnsafe(confirmSql, message.id, claimId);
        published += confirmed;
      } catch (error) {
        await this.#prisma.$executeRawUnsafe(
          releaseSql,
          message.id,
          String(error instanceof Error ? error.message : error).slice(0, 1000),
          this.#options.maxAttempts,
          this.#options.retryDelaySeconds,
          claimId
        );
      }
    }
    return { claimed: claimed.length, published, failed: claimed.length - published };
  }
}

function toEnvelope(message: ClaimedMessage): EventEnvelope {
  return {
    id: message.id,
    type: message.type,
    payloadVersion: message.payloadVersion,
    tenantId: message.tenantId,
    aggregateType: message.aggregateType,
    aggregateId: message.aggregateId,
    correlationId: message.correlationId,
    actorUserId: message.actorUserId,
    occurredAt: message.createdAt.toISOString(),
    payload: message.payload,
  };
}

/**
 * Runs the relay in a Node process that owns it: one batch at a time, again right away
 * while batches are full, otherwise after the interval. `stop()` waits for the current
 * batch and claims nothing more.
 */
export class RelayLoop {
  readonly #relay: OutboxRelay;
  readonly #intervalMs: number;
  readonly #onError: (error: unknown) => void;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;
  #started = false;
  #stopped = false;

  constructor(
    relay: OutboxRelay,
    options: { intervalMs?: number; onError?: (error: unknown) => void } = {}
  ) {
    this.#relay = relay;
    this.#intervalMs = options.intervalMs ?? 1000;
    this.#onError = options.onError ?? (() => {});
  }

  /** Starts the loop once; later calls, also after `stop()`, change nothing. */
  start(): this {
    if (this.#started) return this;
    this.#started = true;
    this.#schedule(0);
    return this;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    await this.#running;
  }

  #schedule(delayMs: number) {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#running = this.#tick();
    }, delayMs);
  }

  async #tick() {
    let next = this.#intervalMs;
    try {
      const result = await this.#relay.relayBatch();
      if (result.claimed === this.#relay.batchSize) next = 0;
    } catch (error) {
      this.#onError(error);
    } finally {
      this.#running = undefined;
      this.#schedule(next);
    }
  }
}
