/**
 * Builds the Dockerfile from a bundle, runs the container against a fresh database, waits
 * for readiness, calls the API and its health check, stops it with `docker stop` and checks
 * that the server shut down in order with exit code 0.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const { createDatabase } = await import(pathToFileURL(resolve('dist/test/support.js')).href);
const database = await createDatabase();
const image = `glasswork-reference-node:${randomUUID().slice(0, 8)}`;
let container;

/** A free port on the host; the container shares the host network to reach the database. */
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

async function waitUntilReady(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  throw new Error(`${url} did not become ready:\n${docker('logs', container)}`);
}

try {
  const port = await freePort();
  docker('build', '--quiet', '-t', image, '.');
  container = docker(
    'run',
    '--detach',
    '--network',
    'host',
    '-e',
    `PORT=${port}`,
    '-e',
    `DATABASE_URL=${process.env.DATABASE_URL}`,
    '-e',
    `DATABASE_SCHEMA=${process.env.DATABASE_SCHEMA}`,
    image
  );
  const base = `http://127.0.0.1:${port}`;
  await waitUntilReady(`${base}/health/ready`);

  const summary = await fetch(`${base}/api/projects/summary`, {
    headers: { authorization: 'Bearer alice-token' },
  });
  assert.deepEqual(await summary.json(), { authenticated: true, projects: 0 });
  // The Dockerfile's HEALTHCHECK command, run inside the container.
  docker('exec', container, 'wget', '-qO-', `http://127.0.0.1:${port}/health/ready`);

  docker('stop', '--time', '30', container);
  const exitCode = docker('inspect', '--format', '{{.State.ExitCode}}', container);
  const logs = execFileSync('docker', ['logs', container], { encoding: 'utf8', stdio: 'pipe' });
  assert.equal(exitCode, '0', logs);
  assert.match(logs, /Shutting down \(SIGTERM\)/);
  assert.match(logs, /Shutdown complete/);
  console.log('The container serves, reports readiness and stops cleanly on docker stop.');
} finally {
  if (container) execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
  execFileSync('docker', ['rmi', '--force', image], { stdio: 'ignore' });
  await database.drop();
}
