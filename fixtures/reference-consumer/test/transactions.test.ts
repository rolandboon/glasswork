import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { createAuditLogger } from 'glasswork/audit';
import type { Logger, ProviderConfig } from 'glasswork/core';
import { bootstrapWorker, type JobService } from 'glasswork/jobs';
import { SQSQueueDriver } from 'glasswork/jobs/sqs';
import { AppModule } from '../src/app.module.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { placeOrderJob } from '../src/orders/orders.module.js';
import { createAuditSink } from '../src/platform/audit.module.js';
import type { Database } from '../src/platform/database.module.js';
import { createDatabase, request, startApp } from './support.js';

const database = await createDatabase();
after(() => database.drop());

async function seedStock(sku: string, available: number, tenantId = 'tenant-a') {
  await database.execute(
    'INSERT INTO "StockItem" (id, "tenantId", sku, available) VALUES ($1, $2, $3, $4)',
    randomUUID(),
    tenantId,
    sku,
    available
  );
}

async function available(sku: string) {
  const [item] = await database.select<{ available: number }>(
    'SELECT available FROM "StockItem" WHERE sku = $1',
    sku
  );
  return item?.available;
}

/**
 * The rows one use case wrote, with the id of the transaction that wrote each of them:
 * `xmin` is the transaction that inserted a row.
 */
async function writtenBy(orderId: string) {
  const [order] = await database.select<{ xmin: string; sku: string; quantity: number }>(
    'SELECT xmin::text, "tenantId", sku, quantity, status FROM "Order" WHERE id = $1',
    orderId
  );
  const reservations = await database.select<{
    xmin: string;
    id: string;
    sku: string;
    quantity: number;
  }>('SELECT xmin::text, id, sku, quantity FROM "Reservation" WHERE "orderId" = $1', orderId);
  const audit = await database.select<{ xmin: string; action: string }>(
    'SELECT xmin::text, action FROM "AuditLog" WHERE "subjectId" = ANY($1) ORDER BY action',
    [orderId, ...reservations.map(({ id }) => id)]
  );
  const notifications = await database.select<{ xmin: string; type: string }>(
    'SELECT xmin::text, type FROM "PendingNotification" WHERE "subjectId" = $1',
    orderId
  );
  const rows = [order, ...reservations, ...audit, ...notifications].filter((row) => row);
  return {
    order: order && { ...order, xmin: undefined },
    reservations: reservations.map(({ xmin: _, id: __, ...rest }) => rest),
    audit: audit.map(({ action }) => action),
    notifications: notifications.map(({ type }) => type),
    transactions: new Set(rows.map((row) => row?.xmin)).size,
    transaction: order?.xmin,
  };
}

async function counts() {
  const tables = ['Order', 'Reservation', 'AuditLog', 'PendingNotification'];
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

/** Fails when any write of a failed use case survived its rollback. */
async function assertNothingCommitted(before: Record<string, number>) {
  assert.deepEqual(await counts(), before, 'a write survived the rollback');
}

function placeOrder(app: Parameters<typeof request>[0], sku: string, quantity: number) {
  return request(app, '/orders', { token: 'alice-token', body: { sku, quantity } });
}

const failingNotifications: ProviderConfig = {
  provide: 'orderNotificationsFor',
  useValue: () => ({
    orderPlaced: async () => {
      throw new Error('Notification intent could not be written');
    },
  }),
};

describe('one transaction across the orders and inventory modules', () => {
  it('commits the order, the reservation, both audit rows and the notification intent together', async () => {
    await seedStock('widget', 5);
    const application = await startApp();
    try {
      const res = await placeOrder(application.app, 'widget', 2);
      assert.equal(res.status, 201);
      const { id } = (await res.json()) as { id: string };

      const written = await writtenBy(id);
      assert.deepEqual(written.order, {
        xmin: undefined,
        tenantId: 'tenant-a',
        sku: 'widget',
        quantity: 2,
        status: 'placed',
      });
      assert.deepEqual(written.reservations, [{ sku: 'widget', quantity: 2 }]);
      assert.deepEqual(written.audit, ['inventory.reserve', 'order.place']);
      assert.deepEqual(written.notifications, ['order-placed']);
      assert.equal(written.transactions, 1);
      assert.equal(await available('widget'), 3);

      const report = await request(application.app, '/reports/orders', { token: 'alice-token' });
      assert.deepEqual(await report.json(), [
        { orderId: id, sku: 'widget', quantity: 2, status: 'placed', reserved: 2 },
      ]);
      const other = await request(application.app, '/reports/orders', { token: 'bob-token' });
      assert.deepEqual(await other.json(), []);
    } finally {
      await application.stop();
    }
  });

  it('rolls back order, reservation and audit when a later step fails, while the audit log keeps the attempt', async () => {
    await seedStock('gadget', 5);
    const logged: string[] = [];
    const logger: Logger = {
      debug() {},
      info: (message) => logged.push(message),
      warn() {},
      error() {},
    };
    const application = await startApp([
      failingNotifications,
      {
        provide: 'audit',
        useFactory: ({ prisma }: { prisma: Database }) =>
          createAuditLogger({ sink: createAuditSink(prisma), logger }),
      },
    ]);
    try {
      const before = await counts();

      const res = await placeOrder(application.app, 'gadget', 2);

      assert.equal(res.status, 500);
      await assertNothingCommitted(before);
      assert.equal(await available('gadget'), 5);
      // The log lines describe attempts; only the audit rows record completed changes.
      assert.deepEqual(logged, ['Order placed', 'Stock reserved']);
    } finally {
      await application.stop();
    }
  });

  it('rejects an order beyond the available stock and keeps nothing of it', async () => {
    await seedStock('sprocket', 1);
    const application = await startApp();
    try {
      const before = await counts();

      const res = await placeOrder(application.app, 'sprocket', 2);

      assert.equal(res.status, 409);
      assert.equal(((await res.json()) as { code: string }).code, 'insufficient-stock');
      await assertNothingCommitted(before);
      assert.equal(await available('sprocket'), 1);
    } finally {
      await application.stop();
    }
  });

  it('gives concurrent use cases a transaction each', async () => {
    await seedStock('bolt', 25);
    const application = await startApp();
    try {
      const responses = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((quantity) => placeOrder(application.app, 'bolt', quantity))
      );
      assert.deepEqual(
        responses.map((res) => res.status),
        [201, 201, 201, 201, 201, 201]
      );

      const written = await Promise.all(
        responses.map(async (res) => writtenBy(((await res.json()) as { id: string }).id))
      );
      for (const rows of written) {
        assert.equal(rows.transactions, 1);
        assert.equal(rows.reservations[0]?.quantity, rows.order?.quantity);
      }
      assert.equal(new Set(written.map((rows) => rows.transaction)).size, 6);
      assert.equal(await available('bolt'), 25 - 21);
    } finally {
      await application.stop();
    }
  });

  it('finds a service that writes through the root client instead of the transaction', async () => {
    await seedStock('washer', 5);
    // The mistake: the inventory service on the root client inside the use case.
    const application = await startApp([
      failingNotifications,
      {
        provide: 'inventoryFor',
        useFactory:
          ({ prisma }: { prisma: Database }) =>
          () =>
            new InventoryService({ prisma }),
      },
    ]);
    try {
      const before = await counts();

      const res = await placeOrder(application.app, 'washer', 2);

      assert.equal(res.status, 500);
      await assert.rejects(assertNothingCommitted(before), /a write survived the rollback/);
      // The reservation and the stock decrement escaped the transaction; the order did not.
      assert.deepEqual(await counts(), { ...before, Reservation: before.Reservation + 1 });
      assert.equal(await available('washer'), 3);
    } finally {
      await application.stop();
    }
  });

  it('runs the same use case from an HTTP route and from a job through the SQS worker', async () => {
    await seedStock('nut', 10);
    const sent: Array<{ MessageBody?: string }> = [];
    const sqs = new SQSQueueDriver({
      region: 'eu-west-1',
      queues: { default: 'https://sqs.eu-west-1.amazonaws.com/000000000000/jobs' },
      client: {
        send: async (command: { input: { MessageBody?: string } }) => {
          sent.push(command.input);
          return { MessageId: `message-${sent.length}` };
        },
        destroy: () => {},
      } as never,
    });
    const application = await startApp([{ provide: 'queueDriver', useValue: sqs }]);
    try {
      const res = await placeOrder(application.app, 'nut', 3);
      const fromHttp = ((await res.json()) as { id: string }).id;

      const jobService = application.container.resolve('jobService') as JobService;
      await jobService.enqueue(placeOrderJob, {
        tenantId: 'tenant-a',
        actorUserId: 'alice',
        sku: 'nut',
        quantity: 3,
      });
      const worker = bootstrapWorker({ module: AppModule, metrics: { enabled: false } });
      const result = await worker({
        Records: [
          {
            messageId: 'message-1',
            receiptHandle: 'receipt-1',
            body: sent[0]?.MessageBody ?? '',
            attributes: { ApproximateReceiveCount: '1' },
            eventSourceARN: 'arn:aws:sqs:eu-west-1:000000000000:jobs',
            eventSource: 'aws:sqs',
          },
        ],
      } as never);
      assert.deepEqual(result, { batchItemFailures: [] });

      const [fromJob] = await database.select<{ id: string }>(
        'SELECT id FROM "Order" WHERE sku = $1 AND id <> $2',
        'nut',
        fromHttp
      );
      const shape = async (id: string) => {
        const { transaction: _, ...rows } = await writtenBy(id);
        return rows;
      };
      assert.ok(fromJob);
      assert.deepEqual(await shape(fromJob.id), await shape(fromHttp));
      assert.equal(await available('nut'), 4);
    } finally {
      await application.stop();
    }
  });
});
