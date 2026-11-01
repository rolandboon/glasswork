---
description: Optimistic concurrency with versions and If-Match, conditional updates and row locks for invariants, gapless numbers, and which conflicts to retry.
---

# Concurrent Changes

An [idempotency key](/application-structure/idempotency-keys) recognizes repeats of one request. It does nothing when two *different* requests change the same data at the same time: two people editing one record, two orders for the last item, two orders asking for the next invoice number. Those need a rule that PostgreSQL enforces.

This page describes three patterns from the [reference consumer](https://github.com/rolandboon/glasswork/tree/main/fixtures/reference-consumer), each tested with real concurrent transactions. Glasswork has no lock framework, picks no isolation level for you and does not retry transactions.

## Choosing a Pattern

| Situation | Pattern | Why |
| --- | --- | --- |
| A client edits something it read earlier, such as a form | A version column and `If-Match` | No lock is held while the user decides; a conflict surfaces as `412` |
| A rule on one row, such as stock that may not go below zero | A conditional update | One statement checks and changes; there is no gap between reading and writing |
| The next value depends on the current one, such as a gapless number | A row lock held until commit | A rollback restores the value; concurrent requests take turns |
| A rule across rows that no single row covers, such as no overlapping bookings | `Serializable` isolation, or a lock on a parent row | PostgreSQL detects the conflicting pattern; the application retries |

The fixture uses the first three.

## Optimistic Concurrency

Each project has a `version`. Reading it returns the version as an `ETag`; changing it requires the version the client read in `If-Match`:

```typescript
// src/projects/projects.module.ts
async rename(id: string, name: string, expectedVersion: number) {
  try {
    return await this.#prisma.project.update({
      where: { id, version: expectedVersion },
      data: { name, version: { increment: 1 } },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2025') throw error;
    if (await this.find(id)) throw new PreconditionFailedException('The project changed since you read it');
    throw new NotFoundException('Project not found');
  }
}
```

The version check and the change are one `UPDATE … WHERE id = $1 AND version = $2`. A writer that commits in between wins; this one then matches no row and answers `412`. The route answers `428` without `If-Match`, `400` for anything but a strong ETag such as `"3"`, and returns the new `ETag` after a change.

**On the client**, a `412` means someone else changed the record. Read it again, show or merge the difference, and send the change with the new `ETag`. Resending with the new `ETag` without looking would only be a slower way to overwrite.

An API that does not use headers can take the version in the body and answer `409` instead; the database statement is the same.

## Invariant Locking

### A Conditional Update

The stock rule is checked in the same statement that changes the stock:

```typescript
// src/inventory/inventory.service.ts
const { count } = await this.#prisma.stockItem.updateMany({
  where: { sku: input.sku, available: { gte: input.quantity } },
  data: { available: { decrement: input.quantity } },
});
if (count === 0) throw new InsufficientStockError(input.sku, input.quantity); // 409
```

The error carries the code `insufficient-stock`, so clients can tell it from other conflicts. When another transaction has already changed the row, the update waits for its row lock and then evaluates `available >= quantity` against the committed value. Reading the stock, comparing it in JavaScript and then writing leaves a gap in which two requests both see the last item.

### A Row Lock for Gapless Numbers

Order numbers count up per tenant without gaps. One counter row per tenant hands them out:

```sql
INSERT INTO "OrderNumberSequence" ("tenantId", next) VALUES ($1, 2)
ON CONFLICT ("tenantId") DO UPDATE SET next = "OrderNumberSequence".next + 1
RETURNING next - 1 AS number
```

The statement keeps the counter row locked until the transaction ends. A concurrent order of the same tenant waits for it, and a rollback restores the counter, so a failed order does not leave a hole.

The price is that orders of one tenant now run one after another from that point until commit. Take the number as late as the use case allows. When gaps are acceptable, a PostgreSQL `SEQUENCE` needs no lock: it never repeats a value, but a rollback skips one, and it is shared by every tenant unless you create one per tenant.

In the fixture the number is taken first, so it also serializes the stock updates of one tenant. The stock rule does not depend on that: its test uses another transaction that does not take a number.

### Serializable Transactions

For a rule across rows, such as "a room has no overlapping bookings", no single row is there to lock. Run the use case with `Serializable` isolation:

```typescript
await prisma.$withTenant({ tenantId }, (tx) => book(tx, input), { isolationLevel: 'Serializable' });
```

PostgreSQL then aborts one of two transactions whose reads and writes conflict, with error `40001`. Retrying the whole transaction is the application's choice, with a bound on the attempts. A lock on a parent row, such as the room, is the alternative when all writers can take it.

## Which Conflicts to Retry

| Outcome | Meaning | Retry |
| --- | --- | --- |
| `412`, code `precondition-failed` | The record changed since the client read it | Not unchanged: read again and decide |
| `428` Precondition Required | The client sent no version | After reading the record |
| `409`, code `insufficient-stock` | The rule says no | Only after the situation changes |
| `409`, code `idempotency-key-in-progress` | The same request still runs | Yes, later, with the same key |
| `40001` serialization failure, `40P01` deadlock | The transaction lost a race | Yes, the whole transaction, a bounded number of times; an application choice |
| `55P03` lock timeout | A lock was held too long | Later |

## Testing

A burst of parallel requests can pass by luck: in the fixture, ten concurrent orders for the last item also passed with a reservation that read before it wrote, because the order number lock happened to serialize them. Tests hold a conflicting change open and wait until PostgreSQL reports that the competing write is blocked (`pg_stat_activity` and `pg_blocking_pids`). A fixed sleep would still allow a slow request to begin only after the first commit:

```typescript
const { pending } = await database.transaction(async (tx) => {
  // Another order took the last item and has not committed.
  await tx.$queryRawUnsafe(
    `UPDATE "StockItem" SET available = available - 1 WHERE sku = 'last-one' AND available >= 1 RETURNING id`
  );
  const pending = placeOrder('last-one', 1); // waits for the row lock
  await waitForBlockedWrite('StockItem'); // poll pg_stat_activity / pg_blocking_pids
  return { pending };
}); // commits
assert.equal((await pending).status, 409);
```

| Rule | Test in the reference consumer |
| --- | --- |
| A stale version is rejected | A second client with version 1 gets `412` after the first renamed; after reading again, its change succeeds |
| No silent overwrite under concurrency | A rename from version 1 that waits for another uncommitted rename from version 1 gets `412`, and the other name stays |
| The last item is reserved once | An order waiting for another uncommitted reservation of the last item gets `409`, with no reservation and stock at zero |
| Numbers have no gaps or duplicates | Fifteen concurrent orders, five of which fail after taking a number, leave the tenant's numbers at exactly 1 to n |

Replacing any of these patterns with a read followed by a write makes its test fail.
