import { randomUUID } from 'node:crypto';
import type { AuditingLogger } from 'glasswork/audit';
import type { InventoryFor } from '../inventory/inventory.module.js';
import { auditIn } from '../platform/audit.module.js';
import type { Database, Transaction } from '../platform/database.module.js';
import {
  fingerprint,
  IdempotencyKeyInProgressError,
  type IdempotencyOptions,
  isLockTimeout,
  onceForKey,
} from '../platform/idempotency.module.js';
import type { OrderNotificationsFor } from './order-persistence.js';
import { createOrderNumbers, createOrderStore } from './order-persistence.js';
import {
  type Order,
  type PlaceOrderInput,
  type PlaceOrderPorts,
  placeOrder,
} from './orders.domain.js';

/** An order as the API returns it, and as an idempotency key stores it. */
export interface OrderResponse {
  id: string;
  number: number;
  sku: string;
  quantity: number;
  status: string;
  createdAt: string;
}

export function toOrderResponse(order: Order): OrderResponse {
  return {
    id: order.id,
    number: order.number,
    sku: order.sku,
    quantity: order.quantity,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
  };
}

/**
 * The persistence adapter of the place-order use case. It opens one RLS transaction for
 * the tenant and builds every port from that transaction client: the order store, the
 * inventory module's service, the audit trail and the outbox for the order.placed event.
 * Nothing holds the transaction afterwards, so concurrent calls never share it.
 *
 * HTTP routes and jobs call this class; the tenant comes from the input, not from ambient
 * request state.
 */
export class OrderTransactions {
  readonly #prisma: Database;
  readonly #inventoryFor: InventoryFor;
  readonly #audit: AuditingLogger<Transaction>;
  readonly #notificationsFor: OrderNotificationsFor;
  readonly #idempotency: IdempotencyOptions;

  constructor(dependencies: {
    prisma: Database;
    inventoryFor: InventoryFor;
    audit: AuditingLogger<Transaction>;
    orderNotificationsFor: OrderNotificationsFor;
    idempotencyOptions: IdempotencyOptions;
  }) {
    this.#prisma = dependencies.prisma;
    this.#inventoryFor = dependencies.inventoryFor;
    this.#audit = dependencies.audit;
    this.#notificationsFor = dependencies.orderNotificationsFor;
    this.#idempotency = dependencies.idempotencyOptions;
  }

  placeOrder(input: PlaceOrderInput): Promise<Order> {
    return this.#prisma.$withTenant({ tenantId: input.tenantId }, (tx) =>
      placeOrder(this.#ports(tx, input), input)
    );
  }

  /**
   * Places the order at most once per idempotency key of the principal, and stores the
   * response in the order's transaction. A repeat gets the stored response.
   */
  async placeOrderOnce(
    input: PlaceOrderInput,
    idempotency: { key: string; principalId: string }
  ): Promise<{ replayed: boolean; order: OrderResponse }> {
    const scope = {
      tenantId: input.tenantId,
      principalId: idempotency.principalId,
      operation: 'placeOrder',
      key: idempotency.key,
    };
    const requestHash = fingerprint({ sku: input.sku, quantity: input.quantity });
    try {
      const { replayed, response } = await this.#prisma.$withTenant(
        { tenantId: input.tenantId },
        (tx) =>
          onceForKey(tx, scope, requestHash, this.#idempotency, async () => ({
            status: 201,
            body: toOrderResponse(await placeOrder(this.#ports(tx, input), input)),
          }))
      );
      return { replayed, order: response.body };
    } catch (error) {
      if (isLockTimeout(error)) throw new IdempotencyKeyInProgressError();
      throw error;
    }
  }

  #ports(tx: Transaction, input: PlaceOrderInput): PlaceOrderPorts {
    return {
      orders: createOrderStore(tx),
      numbers: createOrderNumbers(tx),
      stock: this.#inventoryFor(tx),
      audit: auditIn(this.#audit, tx),
      notifications: this.#notificationsFor(tx, { actorUserId: input.actorUserId }),
      newId: randomUUID,
      now: () => new Date(),
    };
  }
}
