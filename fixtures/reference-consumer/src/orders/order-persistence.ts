import type { Transaction } from '../platform/database.module.js';
import { outboxIn } from '../platform/messaging.module.js';
import { ORDER_PLACED, type OrderPlacedV1 } from './order-events.js';
import type { OrderNotifications, OrderStore } from './orders.domain.js';

/** Writes orders through the transaction client it is given. */
export function createOrderStore(tx: Transaction): OrderStore {
  return {
    create: (order) => tx.order.create({ data: order }),
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
