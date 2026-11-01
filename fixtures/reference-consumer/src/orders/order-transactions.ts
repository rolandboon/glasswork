import { randomUUID } from 'node:crypto';
import type { AuditingLogger } from 'glasswork/audit';
import type { InventoryFor } from '../inventory/inventory.module.js';
import { auditIn } from '../platform/audit.module.js';
import type { Database, Transaction } from '../platform/database.module.js';
import type { OrderNotificationsFor } from './order-persistence.js';
import { createOrderStore } from './order-persistence.js';
import { type Order, type PlaceOrderInput, placeOrder } from './orders.domain.js';

/**
 * The persistence adapter of the place-order use case. It opens one RLS transaction for
 * the tenant and builds every port from that transaction client: the order store, the
 * inventory module's service, the audit trail and the notification intent. Nothing holds
 * the transaction afterwards, so concurrent calls never share it.
 *
 * HTTP routes and jobs call this class; the tenant comes from the input, not from ambient
 * request state.
 */
export class OrderTransactions {
  readonly #prisma: Database;
  readonly #inventoryFor: InventoryFor;
  readonly #audit: AuditingLogger<Transaction>;
  readonly #notificationsFor: OrderNotificationsFor;

  constructor(dependencies: {
    prisma: Database;
    inventoryFor: InventoryFor;
    audit: AuditingLogger<Transaction>;
    orderNotificationsFor: OrderNotificationsFor;
  }) {
    this.#prisma = dependencies.prisma;
    this.#inventoryFor = dependencies.inventoryFor;
    this.#audit = dependencies.audit;
    this.#notificationsFor = dependencies.orderNotificationsFor;
  }

  placeOrder(input: PlaceOrderInput): Promise<Order> {
    return this.#prisma.$withTenant({ tenantId: input.tenantId }, (tx) =>
      placeOrder(
        {
          orders: createOrderStore(tx),
          stock: this.#inventoryFor(tx),
          audit: auditIn(this.#audit, tx),
          notifications: this.#notificationsFor(tx),
          newId: randomUUID,
          now: () => new Date(),
        },
        input
      )
    );
  }
}
