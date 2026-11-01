import { randomUUID } from 'node:crypto';
import { createLogger } from 'glasswork/core';
import * as v from 'valibot';
import { ORDER_PLACED, OrderPlacedV1 } from '../orders/orders.module.js';
import type { Database } from '../platform/database.module.js';
import { type EventEnvelope, parseEnvelope, receiveOnce } from '../platform/messaging.module.js';

const CONSUMER = 'loyalty';
const POINTS_PER_ITEM = 10;

export class UnsupportedPayloadVersionError extends Error {
  constructor(event: EventEnvelope) {
    super(`No handler for ${event.type} version ${event.payloadVersion}`);
  }
}

export interface SqsRecord {
  messageId: string;
  body: string;
}

/**
 * Awards loyalty points for placed orders. Each event changes the points once, however
 * often it is delivered: the inbox row and the points entry commit together.
 */
export class OrderEventsConsumer {
  readonly #prisma: Database;
  readonly #logger = createLogger('loyalty');

  constructor({ prisma }: { prisma: Database }) {
    this.#prisma = prisma;
  }

  /**
   * SQS batch handler. A record that fails, such as an unknown payload version, is
   * reported for redelivery and ends up in the dead-letter queue after the queue's
   * maximum receive count.
   */
  async handle(event: { Records: SqsRecord[] }) {
    const batchItemFailures: Array<{ itemIdentifier: string }> = [];
    for (const [index, record] of event.Records.entries()) {
      try {
        await this.apply(parseEnvelope(record.body));
      } catch (error) {
        this.#logger.error('Rejected an order event', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        // A FIFO batch may contain later records of the same group. Leave them
        // unprocessed and return them too, so they cannot overtake the failed record.
        batchItemFailures.push(
          ...event.Records.slice(index).map(({ messageId }) => ({ itemIdentifier: messageId }))
        );
        break;
      }
    }
    return { batchItemFailures };
  }

  async apply(event: EventEnvelope): Promise<'applied' | 'duplicate' | 'ignored'> {
    if (event.type !== ORDER_PLACED) return 'ignored';
    if (event.payloadVersion !== 1) throw new UnsupportedPayloadVersionError(event);
    const payload = v.parse(OrderPlacedV1, event.payload);

    return this.#prisma.$withTenant({ tenantId: event.tenantId }, async (tx) => {
      if (!(await receiveOnce(tx, CONSUMER, event))) return 'duplicate';
      await tx.pointsEntry.create({
        data: {
          id: randomUUID(),
          tenantId: event.tenantId,
          userId: payload.actorUserId,
          orderId: payload.orderId,
          points: payload.quantity * POINTS_PER_ITEM,
        },
      });
      return 'applied';
    });
  }
}
