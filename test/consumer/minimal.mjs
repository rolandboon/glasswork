import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootstrap as rootBootstrap } from 'glasswork';
import { bootstrap, defineModule } from 'glasswork/core';
// Only the core peers are installed: provider-neutral jobs and email must load without
// the AWS SDK clients that their SQS, Scheduler and SES adapters use.
import { EmailService, MockTransport } from 'glasswork/email';
import { createRoutes } from 'glasswork/http';
import { defineJob, JobService, MockQueueDriver } from 'glasswork/jobs';
import { createListQueryClient } from 'glasswork/list-query/client';
import { createSseModule, SseBroadcaster } from 'glasswork/sse';

assert.equal(typeof createSseModule, 'function');
assert.equal(new SseBroadcaster().clientCount, 0);

const require = createRequire(import.meta.url);
for (const peer of ['@aws-sdk/client-sqs', '@aws-sdk/client-scheduler', '@aws-sdk/client-sesv2']) {
  assert.throws(() => require.resolve(peer), { code: 'MODULE_NOT_FOUND' });
}
const jobDriver = new MockQueueDriver();
await new JobService(jobDriver).enqueue(defineJob({ name: 'ping', handler: () => {} }), {});
assert.equal(jobDriver.enqueued.length, 1);
const outbox = new MockTransport();
await new EmailService({ from: 'app@example.com', transport: outbox }).sendRaw({
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Hello</p>',
});
assert.equal(outbox.sentEmails.length, 1);
assert.throws(() => require.resolve('@hono/swagger-ui'), { code: 'MODULE_NOT_FOUND' });
assert.throws(() => require.resolve('@aws-sdk/client-cloudwatch'), { code: 'MODULE_NOT_FOUND' });
assert.equal(rootBootstrap, bootstrap);
assert.equal(typeof createRoutes, 'function');
assert.equal(
  createListQueryClient({ pageSizes: [10, 25], defaultPageSize: 10 }).read(
    new URLSearchParams('page=2'),
    { sorts: 'name' }
  ).page,
  2
);
const errors = [];
const { app } = await bootstrap(
  defineModule({
    name: 'minimal',
    basePath: 'minimal',
    routes: (router) => {
      router.get('/ping', (c) => c.text('pong'));
    },
  }),
  {
    environment: 'test',
    openapi: { enabled: true, serveUI: true, serveSpecs: true },
    errorHandler: (error, c) => {
      errors.push(error);
      return c.text('failed', 500);
    },
  }
);
assert.equal((await app.request('/api/minimal/ping')).status, 200);
assert.equal((await app.request('/api/openapi.json')).status, 200);
assert.equal(errors.length, 0);
assert.equal((await app.request('/api')).status, 500);
assert.match(errors[0].message, /npm install @hono\/swagger-ui/);
assert.equal((await app.request('/api/minimal/ping')).status, 200);
console.log('Minimal consumer works without Swagger UI.');
