import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './support.js';

const database = await createDatabase();
after(() => database.drop());

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

/** Runs the command as its own process, as an operator would. */
function run(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, NODE_ENV: 'production' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
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

const placeOrder = (sku: string, quantity: string) => [
  'place-order',
  '--tenant',
  'tenant-a',
  '--actor',
  'support-1',
  '--sku',
  sku,
  '--quantity',
  quantity,
];

describe('the place-order command', () => {
  it('runs the use case in one transaction and exits once the runtime stopped', async () => {
    await seedStock('cli-widget', 5);

    const result = await run(placeOrder('cli-widget', '2'));

    assert.equal(result.code, 0, result.stderr);
    const { id } = JSON.parse(result.stdout) as { id: string };
    const rows = await database.select<{ source: string; xmin: string }>(
      `SELECT 'order' AS source, xmin::text FROM "Order" WHERE id = $1
       UNION ALL SELECT 'reservation', xmin::text FROM "Reservation" WHERE "orderId" = $1
       UNION ALL SELECT 'event', xmin::text FROM "OutboxMessage" WHERE "aggregateId" = $1`,
      id
    );
    assert.deepEqual(rows.map((row) => row.source).sort(), ['event', 'order', 'reservation']);
    assert.equal(new Set(rows.map((row) => row.xmin)).size, 1);
    const audit = await database.select<{ actorUserId: string }>(
      `SELECT "actorUserId" FROM "AuditLog" WHERE "subjectId" = $1`,
      id
    );
    assert.deepEqual(audit, [{ actorUserId: 'support-1' }]);
  });

  it('reports a failed use case with exit code 1 and keeps nothing of it', async () => {
    await seedStock('cli-scarce', 1);

    const result = await run(placeOrder('cli-scarce', '3'));

    assert.equal(result.code, 1);
    assert.match(result.stderr, /place-order failed: Not enough stock/);
    assert.deepEqual(
      await database.select('SELECT id FROM "Order" WHERE sku = $1', 'cli-scarce'),
      []
    );
  });

  it('rejects invalid input with exit code 2 before starting the runtime', async () => {
    const zero = await run(placeOrder('cli-widget', '0'));
    const unknown = await run(['place-order', '--tenant', 'tenant-a', '--force']);
    const missing = await run(['refund']);

    assert.deepEqual([zero.code, unknown.code, missing.code], [2, 2, 2]);
    assert.match(zero.stderr, /Invalid input/);
  });
});
