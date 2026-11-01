import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../src/config.js';
import type { OrderEventsConsumer } from '../src/loyalty/loyalty.module.js';
import { createOrderEvents } from '../src/orders/order-persistence.js';
import type { Order } from '../src/orders/orders.domain.js';
import {
  createDatabase as createClient,
  type Transaction,
} from '../src/platform/database.module.js';
import {
  type EventEnvelope,
  type EventPublisher,
  OutboxRelay,
  type OutboxRelayOptions,
  outboxIn,
  RelayLoop,
  SqsEventPublisher,
} from '../src/platform/messaging.module.js';
import { createDatabase, request, startApp } from './support.js';

const database = await createDatabase();
const prisma = createClient(await loadConfig());
after(async () => {
  await prisma.$disconnect();
  await database.drop();
});

/** An in-memory broker that can fail chosen events. */
class FakeBus implements EventPublisher {
  readonly delivered: EventEnvelope[] = [];
  readonly failOnce = new Set<string>();
  failAll = false;

  async publish(event: EventEnvelope) {
    if (this.failAll || this.failOnce.delete(event.id)) throw new Error('SQS unavailable');
    this.delivered.push(event);
  }
}

function relay(bus: EventPublisher, options: OutboxRelayOptions = {}) {
  return new OutboxRelay({
    prisma,
    eventPublisher: bus,
    outboxOptions: { retryDelaySeconds: 0, ...options },
  });
}

async function drain(outboxRelay: OutboxRelay) {
  while ((await outboxRelay.relayBatch()).claimed > 0) {
    // Keep claiming until nothing is left.
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition');
    await sleep(10);
  }
}

async function seedStock(sku: string, available: number) {
  await database.execute(
    'INSERT INTO "StockItem" (id, "tenantId", sku, available) VALUES ($1, $2, $3, $4)',
    randomUUID(),
    'tenant-a',
    sku,
    available
  );
}

async function clearOutbox() {
  await database.execute('DELETE FROM "OutboxMessage"');
}

async function placeOrder(app: Parameters<typeof request>[0], sku: string, quantity: number) {
  const res = await request(app, '/orders', { token: 'alice-token', body: { sku, quantity } });
  assert.equal(res.status, 201);
  return ((await res.json()) as { id: string }).id;
}

async function messageFor(aggregateId: string) {
  const [message] = await database.select<{
    status: string;
    attempts: number;
    lastError: string | null;
  }>(
    'SELECT status, attempts, "lastError" FROM "OutboxMessage" WHERE "aggregateId" = $1 ORDER BY sequence',
    aggregateId
  );
  return message;
}

async function counts() {
  const tables = ['Order', 'Reservation', 'AuditLog', 'OutboxMessage'];
  const entries = await Promise.all(
    tables.map(async (table) => {
      const [row] = await database.select<{ count: bigint }>(
        `SELECT count(*) AS count FROM "${table}"`
      );
      return [table, Number(row?.count)] as const;
    })
  );
  return Object.fromEntries(entries);
}

describe('outbox: events written with the change', () => {
  it('writes the event in the order transaction and keeps nothing of a rolled-back order', async () => {
    await seedStock('widget', 5);
    let application = await startApp();
    try {
      const id = await placeOrder(application.app, 'widget', 2);

      const [message] = await database.select<Record<string, unknown>>(
        `SELECT xmin::text, type, "payloadVersion", payload, "aggregateType", "aggregateId",
           "tenantId", "actorUserId", status
         FROM "OutboxMessage" WHERE "aggregateId" = $1`,
        id
      );
      const [order] = await database.select<{ xmin: string }>(
        'SELECT xmin::text FROM "Order" WHERE id = $1',
        id
      );
      assert.deepEqual(message, {
        xmin: order?.xmin,
        type: 'order.placed',
        payloadVersion: 1,
        payload: { orderId: id, sku: 'widget', quantity: 2, actorUserId: 'alice' },
        aggregateType: 'Order',
        aggregateId: id,
        tenantId: 'tenant-a',
        actorUserId: 'alice',
        status: 'pending',
      });
    } finally {
      await application.stop();
    }

    application = await startApp([
      {
        provide: 'orderNotificationsFor',
        useValue: (tx: Transaction, actor: { actorUserId: string }) => ({
          async orderPlaced(order: Order) {
            await createOrderEvents(tx, actor).orderPlaced(order);
            throw new Error('A step after the event failed');
          },
        }),
      },
    ]);
    try {
      const before = await counts();
      const res = await request(application.app, '/orders', {
        token: 'alice-token',
        body: { sku: 'widget', quantity: 1 },
      });

      assert.equal(res.status, 500);
      assert.deepEqual(await counts(), before);
    } finally {
      await application.stop();
    }
  });
});

describe('outbox relay', () => {
  it('publishes an event committed before the process stopped', async () => {
    await clearOutbox();
    await seedStock('gadget', 5);
    const application = await startApp();
    try {
      // The order commits; the process stops before anything publishes the event.
      const id = await placeOrder(application.app, 'gadget', 1);

      const bus = new FakeBus();
      assert.deepEqual(await relay(bus).relayBatch(), { claimed: 1, published: 1, failed: 0 });
      assert.deepEqual(
        bus.delivered.map((event) => [event.type, event.aggregateId]),
        [['order.placed', id]]
      );
      assert.equal((await messageFor(id))?.status, 'published');
    } finally {
      await application.stop();
    }
  });

  it('publishes again after a relay stopped before confirming, and the consumer applies it once', async () => {
    await clearOutbox();
    await seedStock('sprocket', 5);
    const application = await startApp();
    try {
      const id = await placeOrder(application.app, 'sprocket', 2);

      // A relay claims and publishes the event, then stops before it confirms.
      const delivered: EventEnvelope[] = [];
      const stalled = new OutboxRelay({
        prisma,
        eventPublisher: {
          publish: async (event) => {
            delivered.push(event);
            await new Promise(() => {});
          },
        },
        outboxOptions: { leaseSeconds: 1 },
      });
      void stalled.relayBatch();
      await waitFor(() => delivered.length === 1);

      const bus = new FakeBus();
      const takeover = relay(bus);
      assert.equal((await takeover.relayBatch()).claimed, 0, 'the claim still holds');
      await sleep(1100);
      assert.equal((await takeover.relayBatch()).published, 1);
      assert.equal((await messageFor(id))?.status, 'published');

      // Delivered twice, applied once, also when both deliveries arrive together.
      const deliveries = [...delivered, ...bus.delivered];
      assert.deepEqual(new Set(deliveries.map((event) => event.id)).size, 1);
      const consumer = application.container.resolve('orderEventsConsumer') as OrderEventsConsumer;
      const results = await Promise.all(deliveries.map((event) => consumer.apply(event)));
      assert.deepEqual(results.sort(), ['applied', 'duplicate']);
      assert.deepEqual(await consumer.apply(deliveries[0] as EventEnvelope), 'duplicate');
      const points = await database.select<{ points: number }>(
        'SELECT points FROM "PointsEntry" WHERE "orderId" = $1',
        id
      );
      assert.deepEqual(points, [{ points: 20 }]);
    } finally {
      await application.stop();
    }
  });

  it('lets two relays share the work without either publishing an event twice', async () => {
    await clearOutbox();
    await seedStock('bolt', 100);
    const application = await startApp();
    try {
      for (let index = 0; index < 20; index += 1) await placeOrder(application.app, 'bolt', 1);
      const busA = new FakeBus();
      const busB = new FakeBus();

      await Promise.all([
        drain(relay(busA, { batchSize: 3 })),
        drain(relay(busB, { batchSize: 3 })),
      ]);

      const ids = [...busA.delivered, ...busB.delivered].map((event) => event.id);
      assert.equal(ids.length, 20);
      assert.equal(new Set(ids).size, 20);
    } finally {
      await application.stop();
    }
  });

  it('skips an event another relay is claiming instead of waiting for it', async () => {
    await clearOutbox();
    await seedStock('pin', 10);
    const application = await startApp();
    try {
      const locked = await placeOrder(application.app, 'pin', 1);
      const free = await placeOrder(application.app, 'pin', 1);
      const bus = new FakeBus();

      // Another relay's claim statement holds the first event's row lock.
      const result = await database.transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT id FROM "OutboxMessage" WHERE "aggregateId" = $1 FOR UPDATE',
          locked
        );
        return Promise.race([relay(bus).relayBatch(), sleep(2000).then(() => 'blocked')]);
      });

      assert.deepEqual(result, { claimed: 1, published: 1, failed: 0 });
      assert.deepEqual(
        bus.delivered.map((event) => event.aggregateId),
        [free]
      );
    } finally {
      await application.stop();
    }
  });

  it('publishes the events of one aggregate in order, behind a failed attempt', async () => {
    await clearOutbox();
    const ids = await prisma.$withTenant({ tenantId: 'tenant-a' }, async (tx) => {
      const outbox = outboxIn(tx);
      const add = (aggregateId: string, step: string) =>
        outbox.add({
          type: 'test.step',
          payloadVersion: 1,
          tenantId: 'tenant-a',
          aggregateType: 'Test',
          aggregateId,
          payload: { step },
        });
      const first = await add('aggregate-a', 'A1');
      await add('aggregate-a', 'A2');
      await add('aggregate-a', 'A3');
      await add('aggregate-b', 'B1');
      return { first };
    });
    const bus = new FakeBus();
    bus.failOnce.add(ids.first);
    const outboxRelay = relay(bus);

    const claimed: number[] = [];
    let result = await outboxRelay.relayBatch();
    while (result.claimed > 0) {
      claimed.push(result.claimed);
      result = await outboxRelay.relayBatch();
    }

    assert.deepEqual(claimed, [2, 1, 1, 1]);
    assert.deepEqual(
      bus.delivered.map((event) => (event.payload as { step: string }).step),
      ['B1', 'A1', 'A2', 'A3']
    );
  });

  it('keeps equal aggregate ids in different tenants and aggregate types independent', async () => {
    await clearOutbox();
    await prisma.$withTenant({ tenantId: 'tenant-a' }, async (tx) => {
      for (const [tenantId, aggregateType] of [
        ['tenant-a', 'Order'],
        ['tenant-b', 'Order'],
        ['tenant-a', 'Invoice'],
      ]) {
        await outboxIn(tx).add({
          tenantId: tenantId as string,
          aggregateType: aggregateType as string,
          aggregateId: 'shared-id',
          type: 'test',
          payloadVersion: 1,
          payload: {},
        });
      }
    });
    const bus = new FakeBus();
    assert.equal((await relay(bus).relayBatch()).published, 3);
  });

  it('does not let a late batch confirm a newer claim from the same relay instance', async () => {
    await clearOutbox();
    await prisma.$withTenant({ tenantId: 'tenant-a' }, (tx) =>
      outboxIn(tx).add({
        tenantId: 'tenant-a',
        aggregateType: 'Order',
        aggregateId: 'late-claim',
        type: 'test',
        payloadVersion: 1,
        payload: {},
      })
    );
    const releases: Array<() => void> = [];
    const shared = relay({ publish: () => new Promise<void>((resolve) => releases.push(resolve)) });
    const first = shared.relayBatch();
    await waitFor(() => releases.length === 1);
    await database.execute(
      `UPDATE "OutboxMessage" SET "claimedUntil" = LOCALTIMESTAMP - interval '1 second'`
    );
    const second = shared.relayBatch();
    await waitFor(() => releases.length === 2);
    try {
      releases[0]?.();
      assert.equal((await first).published, 0, 'a lost claim must not count as confirmed');
      assert.equal((await messageFor('late-claim'))?.status, 'pending');
    } finally {
      releases[1]?.();
      await second;
    }
    assert.equal((await messageFor('late-claim'))?.status, 'published');
  });

  it('marks an event failed after the last attempt, holds its aggregate and publishes it after a retry', async () => {
    await clearOutbox();
    await seedStock('washer', 5);
    const application = await startApp();
    try {
      const id = await placeOrder(application.app, 'washer', 1);
      const bus = new FakeBus();
      bus.failAll = true;
      const outboxRelay = relay(bus, { maxAttempts: 2 });

      await outboxRelay.relayBatch();
      await outboxRelay.relayBatch();
      assert.deepEqual(await messageFor(id), {
        status: 'failed',
        attempts: 2,
        lastError: 'SQS unavailable',
      });

      // A later event of the same aggregate waits behind the failed one.
      await prisma.$withTenant({ tenantId: 'tenant-a' }, (tx) =>
        outboxIn(tx).add({
          type: 'order.updated',
          payloadVersion: 1,
          tenantId: 'tenant-a',
          aggregateType: 'Order',
          aggregateId: id,
          payload: { orderId: id },
        })
      );
      bus.failAll = false;
      assert.equal((await outboxRelay.relayBatch()).claimed, 0);

      // After fixing the cause, an operator puts the event back.
      await database.execute(
        `UPDATE "OutboxMessage" SET status = 'pending', attempts = 0, "lastError" = NULL
         WHERE status = 'failed' AND "aggregateId" = $1`,
        id
      );
      await drain(outboxRelay);
      assert.deepEqual(
        bus.delivered.map((event) => event.type),
        ['order.placed', 'order.updated']
      );
    } finally {
      await application.stop();
    }
  });

  it('publishes at most the requested number of events per call, as a scheduled Lambda does', async () => {
    await clearOutbox();
    await seedStock('nut', 10);
    const application = await startApp();
    try {
      for (let index = 0; index < 3; index += 1) await placeOrder(application.app, 'nut', 1);
      const bus = new FakeBus();

      assert.deepEqual(await relay(bus).relayBatch(2), { claimed: 2, published: 2, failed: 0 });
      assert.equal(bus.delivered.length, 2);
    } finally {
      await application.stop();
    }
  });

  it('runs one batch at a time, also when the loop is started twice', async () => {
    let running = 0;
    let mostAtOnce = 0;
    let batches = 0;
    const counting = {
      batchSize: 25,
      async relayBatch() {
        running += 1;
        batches += 1;
        mostAtOnce = Math.max(mostAtOnce, running);
        await sleep(20);
        running -= 1;
        return { claimed: 0, published: 0, failed: 0 };
      },
    } as unknown as OutboxRelay;

    const loop = new RelayLoop(counting, { intervalMs: 5 });
    loop.start();
    loop.start();
    await waitFor(() => batches >= 3);
    await loop.stop();

    assert.equal(mostAtOnce, 1);
  });

  it('finishes the current batch when a Node process stops its relay loop', async () => {
    await clearOutbox();
    await seedStock('rivet', 10);
    const application = await startApp();
    try {
      let publishing = false;
      const bus = new FakeBus();
      const slowBus: EventPublisher = {
        async publish(event) {
          publishing = true;
          await sleep(100);
          await bus.publish(event);
        },
      };
      const first = await placeOrder(application.app, 'rivet', 1);
      const loop = new RelayLoop(relay(slowBus), { intervalMs: 20 }).start();
      await waitFor(() => publishing);

      await loop.stop();
      assert.equal((await messageFor(first))?.status, 'published');

      const second = await placeOrder(application.app, 'rivet', 1);
      await sleep(100);
      assert.equal((await messageFor(second))?.status, 'pending');
      assert.equal(bus.delivered.length, 1);
    } finally {
      await application.stop();
    }
  });
});

describe('inbox: the consumer side', () => {
  it('returns unprocessed records after a failure so a FIFO batch cannot overtake it', async () => {
    const application = await startApp();
    try {
      const consumer = application.container.resolve('orderEventsConsumer') as OrderEventsConsumer;
      const event: EventEnvelope = {
        id: randomUUID(),
        type: 'order.placed',
        payloadVersion: 1,
        tenantId: 'tenant-a',
        aggregateType: 'Order',
        aggregateId: 'fifo-order',
        correlationId: null,
        actorUserId: 'alice',
        occurredAt: new Date().toISOString(),
        payload: { orderId: 'fifo-order', sku: 'item', quantity: 1, actorUserId: 'alice' },
      };
      const result = await consumer.handle({
        Records: [
          {
            messageId: 'failed',
            body: JSON.stringify({ ...event, id: randomUUID(), payloadVersion: 2 }),
          },
          { messageId: 'later', body: JSON.stringify(event) },
        ],
      });
      assert.deepEqual(result.batchItemFailures, [
        { itemIdentifier: 'failed' },
        { itemIdentifier: 'later' },
      ]);
      assert.deepEqual(
        await database.select('SELECT * FROM "PointsEntry" WHERE "orderId" = $1', 'fifo-order'),
        []
      );
    } finally {
      await application.stop();
    }
  });

  it('reports an unknown payload version or a malformed message without applying or recording it', async () => {
    const application = await startApp();
    try {
      const consumer = application.container.resolve('orderEventsConsumer') as OrderEventsConsumer;
      const event: EventEnvelope = {
        id: randomUUID(),
        type: 'order.placed',
        payloadVersion: 2,
        tenantId: 'tenant-a',
        aggregateType: 'Order',
        aggregateId: 'order-from-the-future',
        correlationId: null,
        actorUserId: 'alice',
        occurredAt: new Date().toISOString(),
        payload: { orderId: 'order-from-the-future', lines: [] },
      };

      const result = await consumer.handle({
        Records: [
          { messageId: 'message-1', body: JSON.stringify(event) },
          { messageId: 'message-2', body: 'not an event' },
        ],
      });

      assert.deepEqual(result, {
        batchItemFailures: [{ itemIdentifier: 'message-1' }, { itemIdentifier: 'message-2' }],
      });
      assert.deepEqual(
        await database.select('SELECT * FROM "InboxMessage" WHERE "eventId" = $1', event.id),
        []
      );
    } finally {
      await application.stop();
    }
  });
});

describe('SQS event publisher', () => {
  const event: EventEnvelope = {
    id: 'event-1',
    type: 'order.placed',
    payloadVersion: 1,
    tenantId: 'tenant-a',
    aggregateType: 'Order',
    aggregateId: 'order-1',
    correlationId: null,
    actorUserId: 'alice',
    occurredAt: '2026-11-01T12:00:00.000Z',
    payload: { orderId: 'order-1' },
  };

  function capture(queueUrl: string | undefined) {
    const sent: unknown[] = [];
    const publisher = new SqsEventPublisher({
      client: {
        send: async (command: { input: unknown }) => {
          sent.push(command.input);
          return {};
        },
      } as never,
      queueUrl,
    });
    return { publisher, sent };
  }

  it('groups a FIFO queue by aggregate and deduplicates by event id', async () => {
    const { publisher, sent } = capture('https://sqs.eu-west-1.amazonaws.com/0/events.fifo');

    await publisher.publish(event);

    assert.deepEqual(sent, [
      {
        QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/0/events.fifo',
        MessageBody: JSON.stringify(event),
        MessageAttributes: { type: { DataType: 'String', StringValue: 'order.placed' } },
        MessageGroupId: createHash('sha256')
          .update(JSON.stringify(['tenant-a', 'Order', 'order-1']))
          .digest('hex'),
        MessageDeduplicationId: 'event-1',
      },
    ]);
  });

  it('fails each publish without a queue URL', async () => {
    const { publisher, sent } = capture(undefined);

    await assert.rejects(publisher.publish(event), /No queue URL configured/);
    assert.deepEqual(sent, []);
  });
});
