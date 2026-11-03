import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { after, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './support.js';

const database = await createDatabase();
after(() => database.drop());

const serverScript = fileURLToPath(new URL('../src/server.js', import.meta.url));

/** Starts the Node server as its own process and waits until it listens. */
async function startServer(env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [serverScript], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', ...env },
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  const port = await new Promise<number>((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`Server exited early with ${code}: ${output}`)));
    child.stdout.on('data', () => {
      const match = /listening on (\d+)/.exec(output);
      if (match) resolve(Number(match[1]));
    });
  });
  return { child, port, exited, output: () => output };
}

/** A request on its own connection; resolves with the status or the connection error. */
function placeOrder(port: number, sku: string) {
  const body = JSON.stringify({ sku, quantity: 1 });
  return new Promise<number | string>((resolve) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/orders',
        method: 'POST',
        agent: false,
        headers: {
          authorization: 'Bearer alice-token',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      }
    );
    request.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    request.end(body);
  });
}

async function seedStock(sku: string) {
  await database.execute(
    'INSERT INTO "StockItem" (id, "tenantId", sku, available) VALUES ($1, $2, $3, $4)',
    randomUUID(),
    'tenant-a',
    sku,
    5
  );
}

/**
 * Keeps the stock row locked until `release` is called, so an order for it is in flight.
 * The order's reservation waits for the lock.
 */
function lockStock(sku: string) {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => {};
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const done = database.transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT id FROM "StockItem" WHERE sku = $1 FOR UPDATE', sku);
    locked();
    await released;
  });
  return { isLocked, release, done };
}

function kill(child: ChildProcess) {
  if (child.exitCode === null) child.kill('SIGKILL');
}

describe('the Node server on SIGTERM', () => {
  it('finishes an in-flight request, refuses new ones and exits with 0', async () => {
    await seedStock('node-widget');
    const server = await startServer();
    const lock = lockStock('node-widget');
    try {
      await lock.isLocked;
      const inFlight = placeOrder(server.port, 'node-widget');
      await sleep(200);

      server.child.kill('SIGTERM');
      await sleep(200);
      const late = await placeOrder(server.port, 'node-widget');
      lock.release();

      assert.equal(late, 'ECONNREFUSED');
      assert.equal(await inFlight, 201);
      assert.equal(await server.exited, 0, server.output());
      assert.match(server.output(), /Shutting down \(SIGTERM\)/);
      assert.match(server.output(), /Shutdown complete/);
    } finally {
      lock.release();
      await lock.done;
      kill(server.child);
    }
  });

  it('closes a request that outlasts the deadline, logs it and exits with 1', async () => {
    await seedStock('node-gadget');
    const server = await startServer({ SHUTDOWN_TIMEOUT_MS: '300' });
    const lock = lockStock('node-gadget');
    try {
      await lock.isLocked;
      const inFlight = placeOrder(server.port, 'node-gadget');
      await sleep(200);

      server.child.kill('SIGTERM');
      const interrupted = await inFlight;
      lock.release();

      assert.equal(interrupted, 'ECONNRESET');
      assert.equal(await server.exited, 1, server.output());
      assert.match(server.output(), /Shutdown deadline of 300 ms passed/);
    } finally {
      lock.release();
      await lock.done;
      kill(server.child);
    }
  });
});
