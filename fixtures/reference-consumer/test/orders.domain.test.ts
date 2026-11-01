import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Order, type PlaceOrderPorts, placeOrder } from '../src/orders/orders.domain.js';

/** In-memory ports: the use case runs without Prisma, Glasswork or a database. */
function fakePorts(options: { available: number }) {
  const calls: string[] = [];
  let available = options.available;
  let ids = 0;
  const ports: PlaceOrderPorts = {
    orders: {
      async create(order) {
        calls.push(`order ${order.sku} x${order.quantity}`);
        return order;
      },
    },
    stock: {
      async reserve({ sku, quantity }) {
        if (quantity > available) throw new Error(`Not enough ${sku}`);
        available -= quantity;
        calls.push(`reserve ${sku} x${quantity}`);
        return { id: 'reservation-1' };
      },
    },
    audit: {
      async record(_message, entry) {
        calls.push(`audit ${entry.action} ${entry.subjectId}`);
      },
    },
    notifications: {
      async orderPlaced(order: Order) {
        calls.push(`notify ${order.id}`);
      },
    },
    numbers: {
      next: async () => 1,
    },
    newId: () => `order-${++ids}`,
    now: () => new Date('2026-11-01T12:00:00Z'),
  };
  return { ports, calls };
}

const input = { tenantId: 'tenant-a', actorUserId: 'alice', sku: 'widget', quantity: 2 };

describe('placeOrder', () => {
  it('creates the order, reserves stock, audits both and records the notification', async () => {
    const { ports, calls } = fakePorts({ available: 5 });

    const order = await placeOrder(ports, input);

    assert.deepEqual(order, {
      id: 'order-1',
      tenantId: 'tenant-a',
      number: 1,
      sku: 'widget',
      quantity: 2,
      status: 'placed',
      createdAt: new Date('2026-11-01T12:00:00Z'),
    });
    assert.deepEqual(calls, [
      'order widget x2',
      'audit order.place order-1',
      'reserve widget x2',
      'audit inventory.reserve reservation-1',
      'notify order-1',
    ]);
  });

  it('stops before auditing the reservation or notifying when stock runs out', async () => {
    const { ports, calls } = fakePorts({ available: 1 });

    await assert.rejects(placeOrder(ports, input), /Not enough widget/);
    assert.deepEqual(calls, ['order widget x2', 'audit order.place order-1']);
  });
});
