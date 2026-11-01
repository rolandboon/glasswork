import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { ProviderConfig } from 'glasswork/core';
import { runWithTenant } from 'glasswork/rls';
import { fromPrisma, PgBoss } from 'pg-boss';
import type { Order } from '../src/orders/orders.domain.js';
import type { Transaction } from '../src/platform/database.module.js';
import { createDatabase, request, startApp } from './support.js';

/**
 * Publishes the order notification as a pg-boss job through `fromPrisma(tx)`, inside the
 * RLS transaction of the place-order use case, and checks that the job row belongs to that
 * transaction.
 */
const database = await createDatabase();
const schema = process.env.DATABASE_SCHEMA as string;
const bossSchema = `${schema}_boss`;
const runtimeRole = `${schema}_app`;
const queue = 'order-placed';

let admin: PgBoss;
let runtime: PgBoss;

before(async () => {
  // Installing pg-boss needs the administrator; the application role only gets grants.
  admin = new PgBoss({
    connectionString: process.env.REFERENCE_DATABASE_URL,
    schema: bossSchema,
    supervise: false,
    schedule: false,
  });
  await admin.start();
  await admin.createQueue(queue);
  for (const grant of [
    `GRANT USAGE ON SCHEMA "${bossSchema}" TO "${runtimeRole}"`,
    `GRANT SELECT ON "${bossSchema}".version, "${bossSchema}".queue TO "${runtimeRole}"`,
    // RETURNING id needs only that column: the role cannot read other tenants' payloads.
    `GRANT INSERT, SELECT (id) ON "${bossSchema}".job_common TO "${runtimeRole}"`,
  ]) {
    await database.execute(grant);
  }

  // A publishing instance: no maintenance, no schema changes, no instance registry.
  runtime = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: bossSchema,
    supervise: false,
    schedule: false,
    migrate: false,
    registerInstance: false,
  });
  await runtime.start();
});

after(async () => {
  await runtime?.stop();
  await admin?.stop();
  await database.execute(`DROP SCHEMA IF EXISTS "${bossSchema}" CASCADE`);
  await database.drop();
});

async function seedStock(sku: string, available: number) {
  await database.execute(
    'INSERT INTO "StockItem" (id, "tenantId", sku, available) VALUES ($1, $2, $3, $4)',
    randomUUID(),
    'tenant-a',
    sku,
    available
  );
}

async function jobsFor(orderId: string) {
  return database.select<{ xmin: string; data: { orderId: string; tenantId: string } }>(
    `SELECT xmin::text, data FROM "${bossSchema}".job WHERE name = $1 AND data->>'orderId' = $2`,
    queue,
    orderId
  );
}

async function jobCount() {
  const [row] = await database.select<{ count: bigint }>(
    `SELECT count(*) AS count FROM "${bossSchema}".job WHERE name = $1`,
    queue
  );
  return Number(row?.count);
}

async function orderXmin(orderId: string) {
  const [row] = await database.select<{ xmin: string }>(
    'SELECT xmin::text FROM "Order" WHERE id = $1',
    orderId
  );
  return row?.xmin;
}

async function businessState() {
  const counts = await Promise.all(
    ['Order', 'Reservation', 'AuditLog'].map(async (table) => {
      const [row] = await database.select<{ count: bigint }>(
        `SELECT count(*) AS count FROM "${table}"`
      );
      return [table, Number(row?.count)];
    })
  );
  const stock = await database.select<{ sku: string; available: number }>(
    'SELECT sku, available FROM "StockItem" ORDER BY sku'
  );
  return { counts: Object.fromEntries(counts), stock };
}

interface Probe {
  pid: number;
  txid: string;
}

const probeSql = 'SELECT pg_backend_pid() AS pid, txid_current()::text AS txid';

/** Replaces the notification intent with a pg-boss job sent in the order's transaction. */
function jobNotifications(hooks: { afterSend?: (tx: Transaction) => Promise<void> } = {}) {
  const probes: { business?: Probe; adapter?: Probe; sendError?: Error } = {};
  const provider: ProviderConfig = {
    provide: 'orderNotificationsFor',
    useValue: (tx: Transaction) => ({
      async orderPlaced(order: Order) {
        [probes.business] = await tx.$queryRawUnsafe<Probe[]>(probeSql);
        const db = fromPrisma(tx);
        probes.adapter = (await db.executeSql(probeSql)).rows[0] as Probe;
        try {
          await runtime.send(queue, { orderId: order.id, tenantId: order.tenantId }, { db });
        } catch (error) {
          probes.sendError = error as Error;
          throw error;
        }
        await hooks.afterSend?.(tx);
      },
    }),
  };
  return { provider, probes };
}

/** Completes whatever earlier tests left in the queue. */
async function drainQueue() {
  const jobs = await admin.fetch(queue, { batchSize: 100 });
  if (jobs.length > 0) {
    await admin.complete(
      queue,
      jobs.map((job) => job.id)
    );
  }
}

function placeOrder(app: Parameters<typeof request>[0], sku: string, quantity: number) {
  return request(app, '/orders', { token: 'alice-token', body: { sku, quantity } });
}

describe('pg-boss jobs in the RLS transaction through fromPrisma(tx)', () => {
  it('inserts the job in the same transaction and connection as the order', async () => {
    await seedStock('widget', 5);
    const { provider, probes } = jobNotifications();
    const application = await startApp([provider]);
    try {
      const res = await placeOrder(application.app, 'widget', 1);
      assert.equal(res.status, 201);
      const { id } = (await res.json()) as { id: string };

      assert.ok(probes.business && probes.adapter);
      assert.deepEqual(probes.adapter, probes.business);
      const [job] = await jobsFor(id);
      assert.deepEqual(job?.data, { orderId: id, tenantId: 'tenant-a' });
      // xmin is the transaction that inserted a row: the order's transaction inserted the job.
      assert.equal(job?.xmin, await orderXmin(id));
    } finally {
      await application.stop();
    }
  });

  it('makes the job visible to a consumer only after the commit', async () => {
    await seedStock('gadget', 5);
    await drainQueue();
    let fetchedBeforeCommit: unknown[] | undefined;
    const { provider } = jobNotifications({
      afterSend: async () => {
        fetchedBeforeCommit = await admin.fetch(queue);
      },
    });
    const application = await startApp([provider]);
    try {
      const res = await placeOrder(application.app, 'gadget', 1);
      const { id } = (await res.json()) as { id: string };

      assert.deepEqual(fetchedBeforeCommit, []);
      const fetched = await admin.fetch<{ orderId: string }>(queue);
      assert.deepEqual(
        fetched.map((job) => job.data.orderId),
        [id]
      );
      await admin.complete(
        queue,
        fetched.map((job) => job.id)
      );
    } finally {
      await application.stop();
    }
  });

  it('runs the adapter queries through the RLS extension of the transaction', async () => {
    await seedStock('bolt', 5);
    let switched: Error | undefined;
    const { provider } = jobNotifications({
      afterSend: async (tx) => {
        // The transaction belongs to tenant-a; the extension rejects a query under another.
        switched = await runWithTenant({ tenantId: 'tenant-b' }, () =>
          fromPrisma(tx).executeSql('SELECT 1')
        ).then(
          () => undefined,
          (error: Error) => error
        );
      },
    });
    const application = await startApp([provider]);
    try {
      const res = await placeOrder(application.app, 'bolt', 1);

      assert.equal(res.status, 201);
      assert.match(String(switched?.message), /RLS context cannot change within a transaction/);
    } finally {
      await application.stop();
    }
  });

  it('leaves the pg-boss tables outside the tenant policies', async () => {
    const tables = await database.select<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname IN ('job', 'job_common', 'queue')
       ORDER BY c.relname`,
      bossSchema
    );
    assert.deepEqual(tables, [
      { relname: 'job', relrowsecurity: false },
      { relname: 'job_common', relrowsecurity: false },
      { relname: 'queue', relrowsecurity: false },
    ]);
    const [readable] = await database.select<{ payload: boolean }>(
      `SELECT has_column_privilege($1, $2, 'data', 'SELECT') AS payload`,
      runtimeRole,
      `"${bossSchema}".job_common`
    );
    assert.equal(readable?.payload, false);
  });

  it('fails the whole use case when a tenant policy covers the job table', async () => {
    await seedStock('washer', 5);
    const { provider, probes } = jobNotifications();
    const application = await startApp([provider]);
    await database.execute(`ALTER TABLE "${bossSchema}".job_common ENABLE ROW LEVEL SECURITY`);
    try {
      const jobsBefore = await jobCount();

      const res = await placeOrder(application.app, 'washer', 1);

      assert.equal(res.status, 500);
      assert.match(String(probes.sendError?.message), /row-level security policy/);
      assert.equal(await jobCount(), jobsBefore);
      const [stock] = await database.select<{ available: number }>(
        'SELECT available FROM "StockItem" WHERE sku = $1',
        'washer'
      );
      assert.equal(stock?.available, 5);
    } finally {
      await database.execute(`ALTER TABLE "${bossSchema}".job_common DISABLE ROW LEVEL SECURITY`);
      await application.stop();
    }
  });

  it('keeps a job sent without fromPrisma(tx) after the rollback', async () => {
    await seedStock('nut', 5);
    // The mistake: sending on pg-boss's own pool instead of the transaction.
    const application = await startApp([
      {
        provide: 'orderNotificationsFor',
        useValue: () => ({
          async orderPlaced(order: Order) {
            await runtime.send(queue, { orderId: order.id, tenantId: order.tenantId });
            throw new Error('A step after the enqueue failed');
          },
        }),
      },
    ]);
    try {
      const jobsBefore = await jobCount();

      const res = await placeOrder(application.app, 'nut', 1);

      assert.equal(res.status, 500);
      assert.equal(await jobCount(), jobsBefore + 1);
    } finally {
      await application.stop();
    }
  });

  it('rolls the job back with the order, the reservation and the audit rows', async () => {
    await seedStock('sprocket', 5);
    const { provider } = jobNotifications({
      afterSend: async () => {
        throw new Error('A step after the enqueue failed');
      },
    });
    const application = await startApp([provider]);
    try {
      const jobsBefore = await jobCount();
      const before = await businessState();

      const res = await placeOrder(application.app, 'sprocket', 1);

      assert.equal(res.status, 500);
      assert.equal(await jobCount(), jobsBefore);
      assert.deepEqual(await businessState(), before);
    } finally {
      await application.stop();
    }
  });
});
