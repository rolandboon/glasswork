/**
 * The place-order use case without Prisma or Glasswork. It receives business arguments and
 * ports; the caller decides which transaction the ports write to.
 */

export interface Order {
  id: string;
  tenantId: string;
  sku: string;
  quantity: number;
  status: string;
  createdAt: Date;
}

export interface PlaceOrderInput {
  tenantId: string;
  actorUserId: string;
  sku: string;
  quantity: number;
}

export interface OrderStore {
  create(order: Order): Promise<Order>;
}

/** Implemented by the inventory module, which owns stock and reservations. */
export interface StockReservations {
  reserve(input: {
    tenantId: string;
    orderId: string;
    sku: string;
    quantity: number;
  }): Promise<{ id: string }>;
}

export interface AuditTrail {
  record(
    message: string,
    entry: {
      action: string;
      subjectType: string;
      subjectId: string;
      actorUserId: string;
      tenantId: string;
    }
  ): Promise<void>;
}

/** The intent to notify about an order, recorded with the order itself. */
export interface OrderNotifications {
  orderPlaced(order: Order): Promise<void>;
}

export interface PlaceOrderPorts {
  orders: OrderStore;
  stock: StockReservations;
  audit: AuditTrail;
  notifications: OrderNotifications;
  newId(): string;
  now(): Date;
}

export async function placeOrder(ports: PlaceOrderPorts, input: PlaceOrderInput): Promise<Order> {
  const actor = { actorUserId: input.actorUserId, tenantId: input.tenantId };
  const order = await ports.orders.create({
    id: ports.newId(),
    tenantId: input.tenantId,
    sku: input.sku,
    quantity: input.quantity,
    status: 'placed',
    createdAt: ports.now(),
  });
  await ports.audit.record('Order placed', {
    action: 'order.place',
    subjectType: 'Order',
    subjectId: order.id,
    ...actor,
  });

  const reservation = await ports.stock.reserve({
    tenantId: input.tenantId,
    orderId: order.id,
    sku: input.sku,
    quantity: input.quantity,
  });
  await ports.audit.record('Stock reserved', {
    action: 'inventory.reserve',
    subjectType: 'Reservation',
    subjectId: reservation.id,
    ...actor,
  });

  await ports.notifications.orderPlaced(order);
  return order;
}
