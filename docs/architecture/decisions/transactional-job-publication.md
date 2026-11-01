---
description: Decision record on publishing Postgres-backed jobs inside the business transaction with pg-boss and fromPrisma(tx), with the evidence and the database configuration it needs.
---

# Decision: Postgres Jobs in the Business Transaction

**Status:** accepted, 1 November 2026.

## Question

A use case that commits a change and then enqueues a job loses the job when the process stops between the two. Can [pg-boss](https://pgboss.io) insert a job inside the **same Prisma transaction and connection** as the business change and its audit rows, through its public [`fromPrisma(tx)`](https://pgboss.io/api/adapters) adapter, while the Glasswork RLS extension owns that transaction?

The same database is not enough, and neither is a second connection. Writing to pg-boss's tables directly is not an option.

## Decision

**Atomic job publication is proven.** Jobs for a Postgres queue are sent with pg-boss inside the use case's transaction:

```typescript
await boss.send('order-placed', { orderId, tenantId }, { db: fromPrisma(tx) });
```

These jobs need no outbox and no relay. SQS and external events cannot join a Postgres transaction, so they still need an outbox.

## Evidence

The [reference consumer](https://github.com/rolandboon/glasswork/blob/main/fixtures/reference-consumer/test/pgboss.test.ts) replaces the order notification port of the [place-order use case](/application-structure/transactions) with a pg-boss `send` through `fromPrisma(tx)`, inside the RLS callback transaction, as a restricted application role:

| Test | Result |
| --- | --- |
| Same transaction and connection | `pg_backend_pid()` and `txid_current()` through the adapter equal those of the business query, and the job row has the same `xmin`, the inserting transaction, as the order row |
| Visibility | A consumer's `fetch` inside the transaction gets nothing; after the commit it gets the job |
| Rollback | A failure after the send removes the job with the order, the reservation and the audit rows |
| Missing adapter | A `send` without `{ db: fromPrisma(tx) }` commits on pg-boss's own pool: the job survives the rollback, and the test finds it |
| Tenant policies | The pg-boss tables have no row-level security. Enabling it on the job table makes the insert fail with a policy violation, and the whole use case rolls back |
| RLS extension | The transaction client keeps `$queryRawUnsafe`, which is all `fromPrisma` uses. A query through the adapter under another tenant inside the transaction is rejected, so the adapter's queries pass the extension's context check on the transaction client; no client switch takes place |

Dependency set of the run: pg-boss 12.38.0 (with `pg` 8.23.1), Prisma 7.10.0 with `@prisma/adapter-pg` 7.10.0, Glasswork 1.5.0 with the unreleased changes of this repository, Node.js 24, PostgreSQL 16.15 locally and 18.6 in CI. The fixture pins pg-boss and Prisma exactly.

## Required Configuration

**Installation by a privileged role.** pg-boss creates its schema and queues. Run that from a migration, with a role that may create schemas, not from the application:

```typescript
const installer = new PgBoss({ connectionString: migrationUrl, schema: 'pgboss' });
await installer.start();
await installer.createQueue('order-placed');
await installer.stop();
```

**A publishing instance in the application.** It does not migrate, maintain or register itself:

```typescript
const boss = new PgBoss({
  connectionString: applicationUrl,
  schema: 'pgboss',
  migrate: false,
  supervise: false,
  schedule: false,
  registerInstance: false,
});
await boss.start();
```

`start()` is still required: it loads the queue metadata that `send` looks up, through its own pool, outside the business transaction.

**Grants for the application role.** Publishing needs no more than:

```sql
GRANT USAGE ON SCHEMA pgboss TO app;
GRANT SELECT ON pgboss.version, pgboss.queue TO app;
GRANT INSERT, SELECT (id) ON pgboss.job_common TO app;
```

`job_common` holds the jobs of queues without their own table. A queue created with `partition: true` has its own table and needs the same grant. `SELECT (id)` is enough for `INSERT … RETURNING id`, so the application role cannot read the payloads of other tenants' jobs.

**Queue tables stay outside the tenant policies.** pg-boss tables have no tenant column. Tenant isolation for a job comes from its payload: carry the tenant id, keep the payload to identifiers, and let the worker bind the tenant context before it calls services. A migration that enables row-level security on every table must skip the pg-boss schema; if it does not, every enqueue fails and the use case rolls back.

## Consequences

- **Outbox.** It remains necessary for SQS and external events, and for Postgres jobs only when a queue other than pg-boss is chosen.
- **A Postgres job adapter for Glasswork** can publish through pg-boss with an explicit transaction per enqueue. Glasswork's job API has no transaction parameter yet; the adapter needs one, passed explicitly, not taken from ambient state. There is no automatic fallback to a non-transactional send, and no capability flag that replaces this test.
- **Node.js version.** pg-boss 12 requires Node.js 22.12 or later, while Glasswork supports Node.js 20. A pg-boss adapter must stay an optional dependency with that requirement documented.
- **Detection.** Forgetting `{ db: fromPrisma(tx) }` is silent at runtime. Keep a rollback test, as in the fixture, for every use case that publishes jobs.

## Not Covered

The spike does not cover a pg-boss worker processing these jobs, retries and dead letters, throughput, pool exhaustion, queues with `partition: true`, or queues with `notify` enabled.
