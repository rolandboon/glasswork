import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAuthMiddleware } from 'glasswork/auth';
import { loadConfig } from '../src/config.js';
import { abilityFor } from '../src/platform/auth.module.js';
import {
  createDatabase as createClient,
  type Transaction,
} from '../src/platform/database.module.js';
import { fingerprint, onceForKey } from '../src/platform/idempotency.module.js';
import { createDatabase, startApp } from './support.js';

const database = await createDatabase();
after(() => database.drop());

type App = Awaited<ReturnType<typeof startApp>>['app'];

async function seedStock(sku: string, available: number, tenantId = 'tenant-a') {
  await database.execute(
    'INSERT INTO "StockItem" (id, "tenantId", sku, available) VALUES ($1, $2, $3, $4)',
    randomUUID(),
    tenantId,
    sku,
    available
  );
}

async function ordersFor(sku: string) {
  return database.select<{ id: string }>('SELECT id FROM "Order" WHERE sku = $1', sku);
}

async function available(sku: string) {
  const [item] = await database.select<{ available: number }>(
    'SELECT available FROM "StockItem" WHERE sku = $1',
    sku
  );
  return item?.available;
}

async function postOrder(
  app: App,
  body: { sku: string; quantity: number },
  options: { key?: string; token?: string } = {}
) {
  const res = await app.request('/api/orders', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.token ?? 'alice-token'}`,
      'content-type': 'application/json',
      ...(options.key === undefined ? {} : { 'idempotency-key': options.key }),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    replayed: res.headers.get('idempotent-replayed') === 'true',
    body: (await res.json()) as { id: string; error?: string; code?: string },
  };
}

describe('HTTP idempotency key on placing an order', () => {
  it('places one order for a repeated request and replays the stored response', async () => {
    await seedStock('widget', 5);
    const application = await startApp();
    try {
      const first = await postOrder(application.app, { sku: 'widget', quantity: 2 }, { key: 'k1' });
      // The client lost the response and sends the request again.
      const repeat = await postOrder(
        application.app,
        { sku: 'widget', quantity: 2 },
        { key: 'k1' }
      );

      assert.equal(first.status, 201);
      assert.equal(first.replayed, false);
      assert.deepEqual(repeat, { status: 201, replayed: true, body: first.body });
      assert.equal((await ordersFor('widget')).length, 1);
      assert.equal(await available('widget'), 3);
    } finally {
      await application.stop();
    }
  });

  it('starts no second order for concurrent requests with the same key', async () => {
    await seedStock('gadget', 10);
    const application = await startApp();
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          postOrder(application.app, { sku: 'gadget', quantity: 1 }, { key: 'k2' })
        )
      );

      assert.deepEqual(
        results.map((result) => result.status),
        [201, 201, 201, 201, 201]
      );
      assert.equal(new Set(results.map((result) => result.body.id)).size, 1);
      assert.equal(results.filter((result) => result.replayed).length, 4);
      assert.equal((await ordersFor('gadget')).length, 1);
      assert.equal(await available('gadget'), 9);
    } finally {
      await application.stop();
    }
  });

  it('rejects the key with a different request', async () => {
    await seedStock('sprocket', 5);
    const application = await startApp();
    try {
      await postOrder(application.app, { sku: 'sprocket', quantity: 1 }, { key: 'k3' });

      const other = await postOrder(
        application.app,
        { sku: 'sprocket', quantity: 2 },
        { key: 'k3' }
      );

      assert.equal(other.status, 422);
      assert.equal(other.body.code, 'idempotency-key-mismatch');
      assert.match(String(other.body.error), /different request/);
      assert.equal((await ordersFor('sprocket')).length, 1);
    } finally {
      await application.stop();
    }
  });

  it('keeps the keys of each principal and each tenant apart', async () => {
    await seedStock('bolt', 5);
    await seedStock('bolt', 5, 'tenant-b');
    const application = await startApp();
    try {
      const alice = await postOrder(application.app, { sku: 'bolt', quantity: 1 }, { key: 'k4' });
      const carol = await postOrder(
        application.app,
        { sku: 'bolt', quantity: 1 },
        { key: 'k4', token: 'carol-token' }
      );
      const bob = await postOrder(
        application.app,
        { sku: 'bolt', quantity: 1 },
        { key: 'k4', token: 'bob-token' }
      );

      assert.deepEqual(
        [alice, carol, bob].map((result) => [result.status, result.replayed]),
        [
          [201, false],
          [201, false],
          [201, false],
        ]
      );
      assert.equal(new Set([alice, carol, bob].map((result) => result.body.id)).size, 3);
    } finally {
      await application.stop();
    }
  });

  it('answers 409 while the same key is in progress, and runs the request once that one rolled back', async () => {
    await seedStock('washer', 5);
    const application = await startApp([
      { provide: 'idempotencyOptions', useValue: { lockTimeoutMs: 200 } },
    ]);
    try {
      // Another request holds the key in a transaction that has not finished.
      const blocked = await database
        .transaction(async (tx) => {
          await tx.$queryRawUnsafe(
            `INSERT INTO "IdempotencyKey" ("tenantId", "principalId", operation, key, "requestHash", "expiresAt")
             VALUES ('tenant-a', 'alice', 'placeOrder', 'k5', 'other', LOCALTIMESTAMP + interval '1 day')
             RETURNING key`
          );
          const result = await postOrder(
            application.app,
            { sku: 'washer', quantity: 1 },
            { key: 'k5' }
          );
          throw Object.assign(new Error('roll back'), { result });
        })
        .catch((error: { result: Awaited<ReturnType<typeof postOrder>> }) => error.result);

      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.code, 'idempotency-key-in-progress');
      assert.match(String(blocked.body.error), /still in progress/);
      assert.equal((await ordersFor('washer')).length, 0);

      const retry = await postOrder(application.app, { sku: 'washer', quantity: 1 }, { key: 'k5' });
      assert.deepEqual([retry.status, retry.replayed], [201, false]);
    } finally {
      await application.stop();
    }
  });

  it('keeps no key for a request that failed, so a retry runs again', async () => {
    await seedStock('nut', 1);
    const application = await startApp();
    try {
      const failed = await postOrder(application.app, { sku: 'nut', quantity: 2 }, { key: 'k6' });
      assert.deepEqual([failed.status, failed.body.code], [409, 'insufficient-stock']);

      await database.execute('UPDATE "StockItem" SET available = 5 WHERE sku = $1', 'nut');
      const retry = await postOrder(application.app, { sku: 'nut', quantity: 2 }, { key: 'k6' });

      assert.deepEqual([retry.status, retry.replayed], [201, false]);
    } finally {
      await application.stop();
    }
  });

  it('lets an expired key start over, also with a different request', async () => {
    await seedStock('rivet', 5);
    const application = await startApp();
    try {
      const first = await postOrder(application.app, { sku: 'rivet', quantity: 1 }, { key: 'k7' });
      await database.execute(
        `UPDATE "IdempotencyKey" SET "expiresAt" = LOCALTIMESTAMP - interval '1 second' WHERE key = 'k7'`
      );

      const later = await postOrder(application.app, { sku: 'rivet', quantity: 2 }, { key: 'k7' });

      assert.deepEqual([later.status, later.replayed], [201, false]);
      assert.notEqual(later.body.id, first.body.id);
      assert.equal((await ordersFor('rivet')).length, 2);
    } finally {
      await application.stop();
    }
  });

  it('checks permissions on a replay like on the original request', async () => {
    await seedStock('pin', 5);
    let application = await startApp();
    try {
      const first = await postOrder(application.app, { sku: 'pin', quantity: 1 }, { key: 'k8' });
      assert.equal(first.status, 201);
    } finally {
      await application.stop();
    }

    // Alice has become a viewer since; viewers may not place orders.
    application = await startApp([
      {
        provide: 'requireAuth',
        useValue: createAuthMiddleware({
          provider: {
            name: 'viewer',
            async validateSession() {
              const now = new Date();
              return {
                user: { id: 'alice', role: 'viewer', tenantId: 'tenant-a' },
                session: {
                  id: 'session-alice',
                  userId: 'alice',
                  createdAt: now,
                  expiresAt: new Date(now.getTime() + 60_000),
                },
              };
            },
            async invalidateSession() {},
          },
          buildAbility: abilityFor,
          allowGuest: false,
        }),
      },
    ]);
    try {
      const replay = await postOrder(application.app, { sku: 'pin', quantity: 1 }, { key: 'k8' });

      assert.equal(replay.status, 403);
      assert.equal(replay.replayed, false);
    } finally {
      await application.stop();
    }
  });

  it('rejects an empty or overlong key', async () => {
    const application = await startApp();
    try {
      const empty = await postOrder(application.app, { sku: 'any', quantity: 1 }, { key: '' });
      const long = await postOrder(
        application.app,
        { sku: 'any', quantity: 1 },
        { key: 'x'.repeat(256) }
      );

      assert.deepEqual([empty.status, long.status], [400, 400]);
    } finally {
      await application.stop();
    }
  });
});

describe('idempotency key acquisition races', () => {
  it('bounds the row-lock wait on an existing key, including an expired key', async () => {
    await seedStock('locked-expired', 5);
    const application = await startApp([
      { provide: 'idempotencyOptions', useValue: { lockTimeoutMs: 100 } },
    ]);
    try {
      await postOrder(
        application.app,
        { sku: 'locked-expired', quantity: 1 },
        { key: 'expired-lock' }
      );
      await database.execute(
        `UPDATE "IdempotencyKey" SET "expiresAt" = LOCALTIMESTAMP - interval '1 day' WHERE key = 'expired-lock'`
      );
      const result = await database.transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          `SELECT key FROM "IdempotencyKey" WHERE key = 'expired-lock' FOR UPDATE`
        );
        return Promise.race([
          postOrder(
            application.app,
            { sku: 'locked-expired', quantity: 1 },
            { key: 'expired-lock' }
          ),
          sleep(800).then(() => 'wait was not bounded'),
        ]);
      });
      assert.notEqual(
        typeof result,
        'string',
        'existing keys need the same bounded wait as new keys'
      );
      assert.equal((result as Awaited<ReturnType<typeof postOrder>>).status, 409);
      assert.equal((await ordersFor('locked-expired')).length, 1);
    } finally {
      await application.stop();
    }
  });

  it('reacquires an expired key deleted by retention between the insert and row lock', async () => {
    const prisma = createClient(await loadConfig());
    const scope = {
      tenantId: 'tenant-a',
      principalId: 'alice',
      operation: 'retention-race',
      key: 'deleted-key',
    };
    const hash = fingerprint({ name: 'created once' });
    await database.execute(
      `INSERT INTO "IdempotencyKey" ("tenantId", "principalId", operation, key, "requestHash", "expiresAt") VALUES ('tenant-a', 'alice', 'retention-race', 'deleted-key', 'old', LOCALTIMESTAMP - interval '2 days')`
    );
    let deleted = false;
    let executions = 0;
    const execute = async (tx: Transaction) => {
      executions += 1;
      const project = await tx.project.create({
        data: { id: randomUUID(), tenantId: 'tenant-a', name: 'created once' },
      });
      return { status: 201, body: { id: project.id } };
    };
    try {
      const first = await prisma.$withTenant({ tenantId: 'tenant-a' }, (tx) => {
        const intercepted = new Proxy(tx, {
          get(target, key, receiver) {
            if (key === '$queryRawUnsafe')
              return async (sql: string, ...values: unknown[]) => {
                if (
                  !deleted &&
                  sql.includes('FROM "IdempotencyKey"') &&
                  sql.includes('FOR UPDATE')
                ) {
                  deleted = true;
                  await database.execute(`DELETE FROM "IdempotencyKey" WHERE key = 'deleted-key'`);
                }
                return target.$queryRawUnsafe(sql, ...values);
              };
            return Reflect.get(target, key, receiver);
          },
        });
        return onceForKey(intercepted, scope, hash, {}, () => execute(tx));
      });
      assert.equal(deleted, true);
      const repeat = await prisma.$withTenant({ tenantId: 'tenant-a' }, (tx) =>
        onceForKey(tx, scope, hash, {}, () => execute(tx))
      );
      assert.equal(repeat.replayed, true);
      assert.deepEqual(repeat.response, first.response);
      assert.equal(executions, 1);
    } finally {
      await prisma.$disconnect();
    }
  });
});
