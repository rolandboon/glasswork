---
description: At-least-once publication to SQS and other brokers with a transactional outbox, a relay and an idempotent inbox, as application code.
---

# Outbox and Inbox

SQS and external systems cannot take part in a PostgreSQL transaction. Publishing after the commit loses the message when the process stops in between. Publishing before the commit announces a change that may still roll back. The outbox avoids both: the event is stored in the same transaction as the change, and a relay publishes it after the commit. Consumers record which events they applied in an inbox, so a repeated delivery changes nothing.

The result is **at-least-once delivery with explicit idempotency**, not exactly-once. This page is a recipe of application code from the [reference consumer](https://github.com/rolandboon/glasswork/tree/main/fixtures/reference-consumer), where each claim is a test against PostgreSQL. Glasswork has no outbox API.

Jobs on a PostgreSQL queue do not need an outbox when pg-boss inserts them in the business transaction; see [Decision: Postgres Jobs in the Business Transaction](/architecture/decisions/transactional-job-publication).

## The Outbox Table

```sql
CREATE TABLE "OutboxMessage" (
  id               text PRIMARY KEY,           -- event id, also the deduplication key
  sequence         bigserial NOT NULL UNIQUE,  -- insertion order
  "tenantId"       text NOT NULL,
  type             text NOT NULL,              -- 'order.placed'
  "payloadVersion" integer NOT NULL,
  payload          jsonb NOT NULL,
  "aggregateType"  text NOT NULL,
  "aggregateId"    text NOT NULL,              -- part of the aggregate identity
  "correlationId"  text,
  "actorUserId"    text,
  status           text NOT NULL DEFAULT 'pending',  -- pending, published, failed, discarded
  attempts         integer NOT NULL DEFAULT 0,
  "claimedBy"      text,
  "claimedUntil"   timestamp(3),
  "lastError"      text,
  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt"    timestamp(3)
);
CREATE INDEX ON "OutboxMessage" (status, sequence);
CREATE INDEX ON "OutboxMessage" ("tenantId", "aggregateType", "aggregateId", sequence);
```

The table belongs to platform code and has no tenant policy: the relay publishes the events of every tenant. Each event carries its tenant, and consumers bind it before they change anything.

## Writing an Event

The persistence adapter adds the event with the transaction client of the use case, next to the other ports described in [Transactions Across Modules](/application-structure/transactions):

```typescript
// src/orders/order-persistence.ts
export function createOrderEvents(tx: Transaction, actor: { actorUserId: string }) {
  const outbox = outboxIn(tx);
  return {
    async orderPlaced(order: Order) {
      await outbox.add({
        type: 'order.placed',
        payloadVersion: 1,
        tenantId: order.tenantId,
        aggregateType: 'Order',
        aggregateId: order.id,
        actorUserId: actor.actorUserId,
        payload: { orderId: order.id, sku: order.sku, quantity: order.quantity, actorUserId: actor.actorUserId },
      });
    },
  };
}
```

`outboxIn(tx)` inserts one row with a new event id and the current request id as correlation id. When the transaction rolls back, the event is gone with the order.

## The Relay

The relay works in three short steps and never keeps a transaction open while it talks to the broker:

1. **Claim** a batch in one statement. It sets `claimedBy` to a unique token for that batch and a lease in `claimedUntil`, and counts the attempt.
2. **Publish** each claimed event with no transaction open.
3. **Confirm** each event in one statement, only while the relay still holds the claim.

```sql
UPDATE "OutboxMessage" AS m
SET "claimedBy" = $1,
    "claimedUntil" = LOCALTIMESTAMP + make_interval(secs => $2::double precision),
    attempts = m.attempts + 1
WHERE m.id IN (
  SELECT o.id FROM "OutboxMessage" AS o
  WHERE o.status = 'pending'
    AND (o."claimedUntil" IS NULL OR o."claimedUntil" < LOCALTIMESTAMP)
    AND NOT EXISTS (
      SELECT 1 FROM "OutboxMessage" AS earlier
      WHERE earlier."tenantId" = o."tenantId"
        AND earlier."aggregateType" = o."aggregateType"
        AND earlier."aggregateId" = o."aggregateId"
        AND earlier.status IN ('pending', 'failed')
        AND earlier.sequence < o.sequence
    )
  ORDER BY o.sequence
  LIMIT $3::int
  FOR UPDATE SKIP LOCKED
)
RETURNING m.*
```

`FOR UPDATE SKIP LOCKED` lets concurrent relays claim different events instead of waiting for each other. A relay that stops after publishing and before confirming leaves its claim to expire; the next relay publishes the event again. A failed publish records `lastError` and releases the claim after a retry delay; after the last attempt the status becomes `failed`.

| Option | Default | Meaning |
| --- | --- | --- |
| `batchSize` | 25 | Events claimed per batch |
| `leaseSeconds` | 60 | How long a claim lasts. Keep it well above the time a batch takes |
| `maxAttempts` | 5 | Attempts before the status becomes `failed` |
| `retryDelaySeconds` | 30 | Wait before a failed attempt is retried |

### Order per Aggregate

An aggregate is identified by `(tenantId, aggregateType, aggregateId)`. The claim only takes its oldest open event. The next event of that aggregate becomes eligible after the earlier one is published. A `failed` event holds back the later events of its aggregate until it is retried or discarded; other aggregates continue.

The `sequence` follows insertion order. For one aggregate it matches commit order only when writes to that aggregate are serialized, for example because each use case locks or updates the aggregate's row. On SQS, publish to a FIFO queue: the publisher hashes that tuple as `MessageGroupId`, which keeps the group in order, and the event id as `MessageDeduplicationId`. A standard queue does not preserve order, so its consumers must not depend on it.

A lease is not a fence at the broker. If an old publish stalls beyond its lease, another relay can publish that event and its successor before the old publish finishes. That late duplicate can arrive after the successor, including on FIFO once the [broker's deduplication window](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/designing-for-outage-recovery-scenarios.html) has expired. The inbox ignores already-applied event ids; strict domain ordering additionally needs an aggregate version/sequence checked by the consumer and a policy for gaps. This recipe does not implement that policy. A stale batch cannot acknowledge a replacement claim, but no database claim can cancel an in-flight broker request.

### Running the Relay

**On Node.js**, the process that serves the application owns a loop and stops it before the application:

```typescript
// src/server.ts
const { app, container, stop } = await bootstrap(AppModule);
const relay = process.env.EVENTS_QUEUE_URL
  ? new RelayLoop(container.resolve('outboxRelay'), { onError: logError }).start()
  : undefined;

process.once('SIGTERM', () => {
  server.close(async () => {
    await relay?.stop(); // finishes the current batch, claims nothing more
    await stop();
    process.exit(0);
  });
});
```

The loop runs the next batch right away while batches are full, otherwise after an interval. Do not start it from an `onModuleInit` hook: `bootstrap()` starts applications outside tests, including Lambda handlers, where a loop does not belong.

**On Lambda**, a scheduled function publishes one bounded batch per invocation, for example every minute through an EventBridge schedule:

```typescript
// src/lambda.ts
export const relayOutbox = () =>
  (container.resolve('outboxRelay') as OutboxRelay).relayBatch(100);
```

Glasswork does not include a scheduler. Use the one your infrastructure already has.

## The Inbox

A consumer records each event it applies, in the transaction of its own change:

```sql
CREATE TABLE "InboxMessage" (
  consumer     text NOT NULL,
  "eventId"    text NOT NULL,
  "tenantId"   text NOT NULL,
  "receivedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (consumer, "eventId")
);
```

```typescript
// src/loyalty/order-events.consumer.ts
return this.#prisma.$withTenant({ tenantId: event.tenantId }, async (tx) => {
  if (!(await receiveOnce(tx, 'loyalty', event))) return 'duplicate';
  await tx.pointsEntry.create({ data: { /* … */ } });
  return 'applied';
});
```

`receiveOnce` inserts the `(consumer, eventId)` row and skips duplicates. A second delivery finds the row and changes nothing. When two deliveries arrive at the same time, the second insert waits for the first transaction and then finds the row; when the first rolls back, the second applies the event. The consumer's change and its inbox row commit together, so a crash never leaves one without the other.

The SQS handler reports failed records with `batchItemFailures`, so enable partial batch responses (`ReportBatchItemFailures`) on the event source mapping. Following the [SQS FIFO batch guidance](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html#services-sqs-batchfailurereporting), after the first failure it stops and returns that record plus all unprocessed records. Continuing past a failure would allow later records of a FIFO group to overtake it. Moving a failed record to a dead-letter queue also permits later records to proceed; applications requiring strict domain ordering must account for redrive.

## Payload Versions

Each event has a `payloadVersion`. Give an incompatible payload change a new version, and keep publishing or accepting the old one while consumers may still receive it.

A consumer rejects a version it does not know: the record fails, SQS delivers it again, and after the queue's maximum receive count it moves to the dead-letter queue. The rejected event is not written to the inbox, so after deploying a consumer that understands it, a redrive from the dead-letter queue applies it.

## Failures and Inspection

Events that exhausted their attempts, and claims older than their lease:

```sql
SELECT id, type, "aggregateId", attempts, "lastError", "createdAt"
FROM "OutboxMessage" WHERE status = 'failed' ORDER BY sequence;

SELECT id, "claimedBy", "claimedUntil" FROM "OutboxMessage"
WHERE status = 'pending' AND "claimedUntil" < LOCALTIMESTAMP - interval '1 hour';
```

After fixing the cause, retry an event, or discard it so later events of its aggregate can continue:

```sql
UPDATE "OutboxMessage" SET status = 'pending', attempts = 0, "lastError" = NULL WHERE id = $1;
UPDATE "OutboxMessage" SET status = 'discarded' WHERE id = $1;
```

On the consumer side, the dead-letter queue holds the records that kept failing, and the consumer's error log names the message and the reason.

## Retention

Delete published outbox rows after a period that covers your investigations, such as 30 days:

```sql
DELETE FROM "OutboxMessage" WHERE status = 'published' AND "publishedAt" < LOCALTIMESTAMP - interval '30 days';
```

Keep inbox rows at least as long as an event can still arrive: the retention of the source queue, plus the dead-letter queue's retention when you redrive from it. SQS keeps messages for at most 14 days per queue.

## What This Promises

- An event exists exactly when the change it describes committed.
- Committed events remain available for retry after a crash. Delivery is at least once when the broker recovers and failed events are retried; permanent failures require operator action.
- The relay schedules the oldest open event per aggregate first. FIFO preserves broker acceptance order; expired leases can still cause late duplicates as described above.
- A consumer with an inbox applies each event to its own database once.

It does not promise exactly-once delivery. A consumer that calls an external system, such as an email or payment provider, needs that provider's idempotency key or a reconciliation step: the inbox only covers the consumer's own database.

## Testing

| Claim | How the reference consumer tests it |
| --- | --- |
| No event without the change | The event row has the same `xmin` as the order; a failure after writing the event leaves no order, audit or outbox row |
| Nothing lost after a crash | An order commits without a relay running; a relay started later publishes it |
| Published again after a crash before confirming | A relay that never confirms keeps its claim until the lease expires; another relay then publishes the event again |
| Applied once | Both deliveries, concurrently and again afterwards, award the points once |
| Concurrent relays claim correctly | Two relays share 20 events without a duplicate; a relay skips an event whose row another transaction holds locked, instead of waiting |
| Order per aggregate | With the first event failing once, three events of one aggregate are published in order while another aggregate proceeds |
| Failures are inspectable | After the last attempt the event is `failed` with its error and holds its aggregate; after an operator retry, both events are published in order |
| Unknown versions are rejected | A version 2 event and a malformed message are reported as failures, and nothing is applied or recorded |
| Node shutdown | Stopping the loop finishes the batch in progress and claims nothing more |
