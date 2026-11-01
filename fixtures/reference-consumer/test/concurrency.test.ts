import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDatabase, startApp } from './support.js';

const database = await createDatabase();
after(() => database.drop());

type App = Awaited<ReturnType<typeof startApp>>['app'];

async function call(
  app: App,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; token?: string } = {}
) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${options.token ?? 'alice-token'}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: res.status,
    etag: res.headers.get('etag'),
    body: (await res.json()) as Record<string, unknown>,
  };
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

/** Wait for PostgreSQL to observe the competing write, rather than guessing with a sleep. */
async function waitForBlockedWrite(table: string) {
  const role = new URL(process.env.DATABASE_URL as string).username;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const [state] = await database.select<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE usename = $1 AND query LIKE $2 AND cardinality(pg_blocking_pids(pid)) > 0
       ) AS blocked`,
      role,
      `%"${table}"%`
    );
    if (state?.blocked) return;
    await sleep(10);
  }
  throw new Error(`No competing write blocked on ${table}`);
}

describe('optimistic concurrency with a version and If-Match', () => {
  it('renames a project only from the version the client read', async () => {
    const application = await startApp();
    try {
      const created = await call(application.app, 'POST', '/projects', { body: { name: 'Plan' } });
      const path = `/projects/${created.body.id}`;
      const read = await call(application.app, 'GET', path);
      assert.equal(read.etag, '"1"');

      const renamed = await call(application.app, 'PATCH', path, {
        body: { name: 'Plan B' },
        headers: { 'if-match': '"1"' },
      });
      // A second client still holds version 1.
      const stale = await call(application.app, 'PATCH', path, {
        body: { name: 'Plan C' },
        headers: { 'if-match': '"1"' },
      });

      assert.deepEqual([renamed.status, renamed.etag, renamed.body.version], [200, '"2"', 2]);
      assert.deepEqual([stale.status, stale.body.code], [412, 'precondition-failed']);
      const current = await call(application.app, 'GET', path);
      assert.deepEqual([current.body.name, current.etag], ['Plan B', '"2"']);

      // The second client reads again and repeats its change from the current version.
      const retried = await call(application.app, 'PATCH', path, {
        body: { name: 'Plan C' },
        headers: { 'if-match': current.etag as string },
      });
      assert.deepEqual([retried.status, retried.body.name, retried.etag], [200, 'Plan C', '"3"']);
    } finally {
      await application.stop();
    }
  });

  it('does not overwrite a rename that committed while it waited', async () => {
    const application = await startApp();
    try {
      const created = await call(application.app, 'POST', '/projects', { body: { name: 'Draft' } });
      const path = `/projects/${created.body.id}`;

      // Another writer renames from version 1 and has not committed when this one starts.
      const { pending } = await database.transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          `UPDATE "Project" SET name = 'Left', version = version + 1 WHERE id = $1 RETURNING id`,
          created.body.id
        );
        const pending = call(application.app, 'PATCH', path, {
          body: { name: 'Right' },
          headers: { 'if-match': '"1"' },
        });
        await waitForBlockedWrite('Project');
        return { pending };
      });
      const result = await pending;

      assert.equal(result.status, 412);
      const current = await call(application.app, 'GET', path);
      assert.deepEqual([current.body.name, current.etag], ['Left', '"2"']);
    } finally {
      await application.stop();
    }
  });

  it('requires If-Match, rejects an unknown format and reports a missing project', async () => {
    const application = await startApp();
    try {
      const created = await call(application.app, 'POST', '/projects', { body: { name: 'Draft' } });
      const path = `/projects/${created.body.id}`;

      const missing = await call(application.app, 'PATCH', path, { body: { name: 'X' } });
      const weak = await call(application.app, 'PATCH', path, {
        body: { name: 'X' },
        headers: { 'if-match': 'W/"1"' },
      });
      const gone = await call(application.app, 'PATCH', '/projects/unknown', {
        body: { name: 'X' },
        headers: { 'if-match': '"1"' },
      });

      assert.deepEqual([missing.status, weak.status, gone.status], [428, 400, 404]);
      for (const version of ['0', '2147483648', '9'.repeat(400)]) {
        const invalid = await call(application.app, 'PATCH', path, {
          body: { name: 'X' },
          headers: { 'if-match': `"${version}"` },
        });
        assert.equal(invalid.status, 400, `invalid version ${version} is a client error`);
      }
    } finally {
      await application.stop();
    }
  });
});

describe('invariants under concurrent orders', () => {
  it('does not reserve the last item that a concurrent order took while it waited', async () => {
    await seedStock('last-one', 1);
    const application = await startApp();
    try {
      // Another order has reserved the last item and has not committed yet.
      const { pending } = await database.transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          `UPDATE "StockItem" SET available = available - 1 WHERE sku = 'last-one' AND available >= 1 RETURNING id`
        );
        const pending = call(application.app, 'POST', '/orders', {
          body: { sku: 'last-one', quantity: 1 },
        });
        await waitForBlockedWrite('StockItem');
        return { pending };
      });
      const result = await pending;

      assert.deepEqual([result.status, result.body.code], [409, 'insufficient-stock']);
      const [stock] = await database.select<{ available: number }>(
        'SELECT available FROM "StockItem" WHERE sku = $1',
        'last-one'
      );
      assert.equal(stock?.available, 0);
      assert.deepEqual(
        await database.select('SELECT id FROM "Reservation" WHERE sku = $1', 'last-one'),
        []
      );
    } finally {
      await application.stop();
    }
  });

  it('numbers concurrent orders of a tenant without gaps or duplicates, also around failures', async () => {
    await seedStock('numbered', 100);
    await seedStock('scarce', 0);
    const application = await startApp();
    try {
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, index) =>
          call(application.app, 'POST', '/orders', {
            // Every third order fails after taking a number, and gives it back.
            body: { sku: index % 3 === 0 ? 'scarce' : 'numbered', quantity: 1 },
          })
        )
      );
      assert.equal(results.filter((result) => result.status === 201).length, 10);
      assert.equal(results.filter((result) => result.status === 409).length, 5);

      const numbers = await database.select<{ number: number }>(
        `SELECT number FROM "Order" WHERE "tenantId" = 'tenant-a' ORDER BY number`
      );
      assert.deepEqual(
        numbers.map((row) => row.number),
        Array.from({ length: numbers.length }, (_, index) => index + 1)
      );
    } finally {
      await application.stop();
    }
  });
});
