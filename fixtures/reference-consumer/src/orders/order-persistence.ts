import type { Transaction } from '../platform/database.module.js';
import { outboxIn } from '../platform/messaging.module.js';
import { ORDER_PLACED, type OrderPlacedV1 } from './order-events.js';
import type { OrderNotifications, OrderNumbers, OrderStore } from './orders.domain.js';

/** Writes orders through the transaction client it is given. */
export function createOrderStore(tx: Transaction): OrderStore {
  return {
    create: (order) => tx.order.create({ data: order }),
  };
}

/**
 * Increments the tenant's counter row and returns the previous value. The row stays locked
 * until the transaction ends, so concurrent orders of one tenant take turns here, and a
 * rollback restores the counter: the numbers have no gaps.
 */
export function createOrderNumbers(tx: Transaction): OrderNumbers {
  return {
    async next(tenantId) {
      const [row] = await tx.$queryRawUnsafe<Array<{ number: number }>>(
        `INSERT INTO "OrderNumberSequence" ("tenantId", next) VALUES ($1, 2)
         ON CONFLICT ("tenantId") DO UPDATE SET next = "OrderNumberSequence".next + 1
         RETURNING next - 1 AS number`,
        tenantId
      );
      if (!row) throw new Error('No order number returned');
      return row.number;
    },
  };
}

/**
 * Records the order.placed event in the order's transaction, so it exists exactly when the
 * order does. The relay publishes it after the commit.
 */
export function createOrderEvents(
  tx: Transaction,
  actor: { actorUserId: string }
): OrderNotifications {
  const outbox = outboxIn(tx);
  return {
    async orderPlaced(order) {
      const payload: OrderPlacedV1 = {
        orderId: order.id,
        sku: order.sku,
        quantity: order.quantity,
        actorUserId: actor.actorUserId,
      };
      await outbox.add({
        type: ORDER_PLACED,
        payloadVersion: 1,
        tenantId: order.tenantId,
        aggregateType: 'Order',
        aggregateId: order.id,
        actorUserId: actor.actorUserId,
        payload,
      });
    },
  };
}

export type OrderNotificationsFor = (
  tx: Transaction,
  actor: { actorUserId: string }
) => OrderNotifications;
