---
description: Run Glasswork jobs on PostgreSQL with pg-boss, including enqueueing in the business transaction and a long-running worker with an ordered shutdown.
---

# PostgreSQL Jobs with pg-boss

`glasswork/jobs/pg-boss` runs the same job definitions as the SQS driver on a PostgreSQL queue managed by [pg-boss](https://github.com/timgit/pg-boss): a queue driver that can insert jobs in the business transaction, and a long-running worker for a Node.js process. Jobs keep their module scope, payload validation, hooks and failure classification; only the transport changes.

It requires `pg-boss` 12 or later, which needs Node.js 22.12 or later:

```sh
npm install pg-boss
```

The worker runs in a long-running process. Do not run it inside a Lambda invocation; on Lambda, use [SQS](./getting-started).

## Setting Up the Queues

pg-boss creates its schema and queues. Do that from a migration with a role that may create schemas, not from the application, and create every queue the driver sends to, including a dead letter queue:

```typescript
const installer = new PgBoss({ connectionString: migrationUrl, schema: 'pgboss' });
await installer.start();
await installer.createQueue('default');
await installer.createQueue('dead-letter');
await installer.stop();
```

[Jobs on a Postgres Queue](/application-structure/transactions#jobs-on-a-postgres-queue) lists the grants a publishing role needs and why the pg-boss tables stay outside tenant policies. A worker role also needs to update and delete jobs in those tables.

## Enqueueing

`PgBossQueueDriver` works with `JobService` like any driver:

```typescript
import { JobService } from 'glasswork/jobs';
import { PgBossQueueDriver } from 'glasswork/jobs/pg-boss';

const driver = new PgBossQueueDriver({ boss, deadLetterQueue: 'dead-letter' });
const jobService = new JobService(driver);

await jobService.enqueue(sendInvoiceJob, { invoiceId });
await jobService.enqueueIn(sendReminderJob, { invoiceId }, '3d');
```

The job's `queue` is the pg-boss queue (`default` when unset; map names with `queues`). Its `retry.maxAttempts` becomes pg-boss's retry limit, so pg-boss and the worker agree on the last attempt. Retries wait `retryDelaySeconds` (30 by default), doubled per attempt with `retryBackoff`.

### In the Business Transaction

`inTransaction()` returns a driver that inserts jobs through the transaction's own client, so they commit or roll back with the change that caused them:

```typescript
import { fromPrisma } from 'pg-boss';

await prisma.$withTenant({ tenantId }, async (tx) => {
  const invoice = await tx.invoice.create({ data });
  await new JobService(driver.inTransaction(fromPrisma(tx))).enqueue(sendInvoiceJob, {
    invoiceId: invoice.id,
  });
});
```

A worker only sees the job after the commit. A job sent without `inTransaction()` commits on pg-boss's own pool and survives a rollback; keep a rollback test for every use case that enqueues this way, as described in [Transactions Across Modules](/application-structure/transactions#publishing-work-after-the-change).

## The Worker

```typescript
import { bootstrapRuntime } from 'glasswork/core';
import { createPgBossWorker } from 'glasswork/jobs/pg-boss';

const runtime = await bootstrapRuntime(AppModule);
const worker = createPgBossWorker({
  boss,
  container: runtime.container,
  queues: ['default'],
  concurrency: 4,
  deadLetterQueue: 'dead-letter',
});
await worker.start();
```

`container` is the container of `bootstrap()` or `bootstrapRuntime()`, so an API process can also work jobs with the same providers. Each job runs in a new scope of the module that declares it, and each execution has its own context, as in the [SQS worker](./workers#execution-context).

| Outcome of an attempt | In pg-boss |
| --- | --- |
| Success | The job completes |
| Failure with retries left (`TransientJobError` or any error) | The attempt fails; pg-boss retries it after the delay |
| `PermanentJobError` | The job is sent to `deadLetterQueue` at once and completes; without that option pg-boss retries it until its limit |
| Failure on the last attempt | The job fails; pg-boss copies it to the dead letter queue the driver set |
| Failure with `retry: false`, or exhausted with `dead: false` | The job completes, as SQS discards it |

The attempt number in the job context is pg-boss's retry count plus one. pg-boss claims jobs with `SKIP LOCKED`, so several worker processes share a queue without claiming a job twice.

### Stopping

`start()` calls share one initialization result, including a failure. A partial startup failure removes registrations already created. `stop()` also handles a startup still in progress, stops only the registrations this worker owns (other consumers on the same native client remain active), and waits for their jobs in progress. A stopped worker cannot restart. In a Node.js process, make it a drain step of [`serveNode()`](/deployment/node#shutdown), which bounds the wait with its deadline and stops the application afterwards:

```typescript
serveNode({
  fetch: healthApp.fetch, // or the API's app.fetch
  stop: async () => {
    await runtime.stop();
    await boss.stop();
  },
  drain: [() => worker.stop()],
});
```

When a process dies with a job in progress, the job stays active until its `expireInSeconds` (a queue option, 15 minutes by default) passes; a running pg-boss instance with `supervise` enabled then makes it available again as a new attempt. Choose the expiry longer than your slowest job.

## What Is Covered

The tests run against PostgreSQL with two worker instances in the same test process:

| pg-boss feature | Status |
| --- | --- |
| Send, delayed send (`startAfter`) | Supported through `enqueue`, `enqueueAt` and `enqueueIn` |
| Retry limit, delay and backoff | Set per job from the job's retry config and the driver's options |
| Dead letter queues | Supported, including permanent failures before the last attempt |
| Insert in a transaction (`db`) | Supported through `inTransaction()` |
| Claiming with `SKIP LOCKED`, local concurrency | Supported; tested with two independent pg-boss instances sharing a queue |
| Expiry of a crashed worker's job | Supported; tested with a worker that stops without finishing |
| Priority, singleton keys and throttling, groups, schedules, flows | Not wrapped. Use the `boss` instance directly; jobs it sends need the same envelope to run in the worker |

For inspection and redrive, use pg-boss's own tooling and queries.
