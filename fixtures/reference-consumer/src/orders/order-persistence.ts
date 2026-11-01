import { randomUUID } from 'node:crypto';
import type { Transaction } from '../platform/database.module.js';
import type { OrderNotifications, OrderStore } from './orders.domain.js';

/** Writes orders through the transaction client it is given. */
export function createOrderStore(tx: Transaction): OrderStore {
  return {
    create: (order) => tx.order.create({ data: order }),
  };
}

/**
 * Records the intent to notify in the order's transaction, so it exists exactly when the
 * order does. Publishing it is a separate step.
 */
export function createPendingNotifications(tx: Transaction): OrderNotifications {
  return {
    async orderPlaced(order) {
      await tx.pendingNotification.create({
        data: {
          id: randomUUID(),
          tenantId: order.tenantId,
          type: 'order-placed',
          subjectId: order.id,
        },
      });
    },
  };
}

export type OrderNotificationsFor = (tx: Transaction) => OrderNotifications;
