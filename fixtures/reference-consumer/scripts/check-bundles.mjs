/**
 * Runs the bundled entry points against a fresh database: the Lambda API handler and SQS
 * worker in-process, and the Node server as a child process that is stopped with SIGTERM.
 * Authenticated requests resolve class providers, Prisma and RLS inside the bundle. Prints
 * the bundle size and the time a fresh process needs to import the Lambda bundle.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = resolve(process.argv[2] ?? 'bundle');
const { createDatabase } = await import(pathToFileURL(resolve('dist/test/support.js')).href);
const database = await createDatabase();

function apiEvent(method, path, { token, body } = {}) {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {
      host: 'example.com',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'bundle',
      domainName: 'example.com',
      domainPrefix: 'example',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '192.0.2.1', userAgent: 'bundle' },
      requestId: 'bundle',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1767225600000,
    },
  };
}

async function checkLambda() {
  const lambda = await import(pathToFileURL(`${dir}/lambda.mjs`).href);
  assert.equal((await lambda.handler(apiEvent('GET', '/api/projects'))).statusCode, 401);

  const created = await lambda.handler(
    apiEvent('POST', '/api/projects', { token: 'alice-token', body: { name: 'Bundled' } })
  );
  assert.equal(created.statusCode, 201, created.body);
  const listed = await lambda.handler(apiEvent('GET', '/api/projects', { token: 'alice-token' }));
  assert.deepEqual(
    JSON.parse(listed.body).map((project) => project.name),
    ['Bundled']
  );

  assert.deepEqual(
    await lambda.worker({
      Records: [
        {
          eventSource: 'aws:sqs',
          messageId: 'bundle',
          receiptHandle: 'bundle',
          body: JSON.stringify({ jobName: 'unknown', payload: {} }),
          attributes: { ApproximateReceiveCount: '1' },
        },
      ],
    }),
    { batchItemFailures: [{ itemIdentifier: 'bundle' }] }
  );
  console.log('Lambda API and worker handlers work.');
}

async function checkServer() {
  const server = spawn(process.execPath, [`${dir}/server.mjs`], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolvePort, reject) => {
    server.once('exit', (code) => reject(new Error(`Server exited early with ${code}`)));
    server.stdout.on('data', (data) => {
      const match = /listening on (\d+)/.exec(String(data));
      if (match) resolvePort(Number(match[1]));
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/projects/summary`, {
    headers: { authorization: 'Bearer alice-token' },
  });
  assert.deepEqual(await response.json(), { authenticated: true, projects: 1 });

  const exitCode = await new Promise((resolveExit) => {
    server.removeAllListeners('exit');
    server.once('exit', resolveExit);
    server.kill('SIGTERM');
  });
  assert.equal(exitCode, 0);
  console.log('Node server answers and stops on SIGTERM.');
}

function measure() {
  const meta = JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8'));
  const bytes = Object.values(meta.outputs).reduce((sum, output) => sum + output.bytes, 0);
  const lambdaUrl = JSON.stringify(pathToFileURL(`${dir}/lambda.mjs`).href);
  const importMs = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const t = performance.now(); await import(${lambdaUrl}); console.log(Math.round(performance.now() - t));`,
    ],
    { env: process.env, encoding: 'utf8' }
  ).trim();
  const files = Object.keys(meta.outputs).length;
  console.log(
    `Bundle: ${(bytes / 1024).toFixed(0)} KiB in ${files} files; Lambda import: ${importMs} ms`
  );
}

try {
  await checkLambda();
  await checkServer();
  measure();
} finally {
  await database.drop();
}
