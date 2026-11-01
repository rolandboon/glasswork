---
description: An Idempotency-Key header that keeps a repeated or concurrent request from changing data twice, with the key and response stored in the transaction of the change.
---

# Idempotency Keys

Clients repeat requests: after a timeout, a dropped connection, or when an offline device syncs. For a request that creates something, each repeat creates it again unless the server recognizes it. An `Idempotency-Key` header lets the client say "this is the same request". The server then changes data at most once per key and answers repeats with the first response.

Caching the response is not enough on its own. If the process stops after the change committed and before the response was stored, the next attempt changes data again. The recipe below stores the key and the response **in the same transaction as the change**, so either both exist or neither does. It is application code from the [reference consumer](https://github.com/rolandboon/glasswork/tree/main/fixtures/reference-consumer), where `POST /api/orders` accepts the header and each rule below is a test against PostgreSQL. Glasswork has no idempotency API.

## What Clients Can Rely On

| Request | Response |
| --- | --- |
| First request with a key | The normal response, such as `201` with the order |
| Same key and body again, after the first finished | The stored status and body, with `Idempotent-Replayed: true`. No second order |
| Same key, same body, while the first still runs | Waits for the first, then the stored response. After a bounded wait: `409` with code `idempotency-key-in-progress`, retry later |
| Same key with a different body | `422` with code `idempotency-key-mismatch`; the key belongs to the first request |
| A key after its lifetime (one day) | A new request |
| A key whose first request failed and rolled back | A new request: failures do not use up the key |
| No key | The normal behavior, without protection |

Keys belong to the caller: they are scoped by tenant, principal and operation, so two users, or two tenants, can use the same key without seeing each other's responses. A `409` for a key in progress and a `409` from the use case itself, such as `insufficient-stock`, call for different reactions; the error `code` tells them apart.

## The Table

```sql
CREATE TABLE "IdempotencyKey" (
  "tenantId"       text NOT NULL,
  "principalId"    text NOT NULL,
  operation        text NOT NULL,   -- 'placeOrder'
  key              text NOT NULL,
  "requestHash"    text NOT NULL,
  "responseStatus" integer,
  "responseBody"   jsonb,
  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      timestamp(3) NOT NULL,
  PRIMARY KEY ("tenantId", "principalId", operation, key)
);
```

The table has a tenant isolation policy, like the business tables. The request hash is a SHA-256 of the validated body with sorted object keys, so field order does not matter.

## In the Transaction of the Change

The persistence adapter runs the use case inside `onceForKey`, with the transaction it already opened:

```typescript
// src/orders/order-transactions.ts
async placeOrderOnce(input: PlaceOrderInput, idempotency: { key: string; principalId: string }) {
  const scope = {
    tenantId: input.tenantId,
    principalId: idempotency.principalId,
    operation: 'placeOrder',
    key: idempotency.key,
  };
  const requestHash = fingerprint({ sku: input.sku, quantity: input.quantity });
  try {
    const { replayed, response } = await this.#prisma.$withTenant({ tenantId: input.tenantId }, (tx) =>
      onceForKey(tx, scope, requestHash, this.#idempotency, async () => ({
        status: 201,
        body: toOrderResponse(await placeOrder(this.#ports(tx, input), input)),
      }))
    );
    return { replayed, order: response.body };
  } catch (error) {
    if (isLockTimeout(error)) throw new IdempotencyKeyInProgressError(); // 409
    throw error;
  }
}
```

`onceForKey` (in `src/platform/idempotency.ts`) does four things in that transaction:

1. It inserts the key with `INSERT … ON CONFLICT DO NOTHING`, or locks the existing row with `SELECT … FOR UPDATE`. If retention deletes that row between the statements, it reacquires the key before executing anything (at most three acquisition attempts).
2. When the key exists and has not expired, it compares the hash (`422` on a difference) and returns the stored response without running the use case.
3. Otherwise it runs the use case with the same transaction client.
4. It stores the status and body on the key row before the transaction commits.

The stored body is the response as the API returns it, so a replay matches the original exactly.

### Concurrent Repeats

When two requests with the same key arrive together, the second `INSERT … ON CONFLICT` waits for the first transaction:

- **The first commits:** the second finds the key with its response and replays it.
- **The first rolls back:** the second inserts the key and runs the use case itself.

The wait is bounded with `lock_timeout` (five seconds by default), set around both the insert and the row lock, including when an expired key is reused. The previous setting is restored once the key is held. When it runs out, PostgreSQL ends the transaction and the route answers `409` instead of running the request again.

## The Route

The route reads the header and keeps working without it:

```typescript
// src/orders/orders.module.ts
authorize: { action: 'create', subject: 'Order' },
handler: async ({ body, user, context }) => {
  const input = { tenantId: user.tenantId, actorUserId: user.id, sku: body.sku, quantity: body.quantity };
  const key = context.req.header('idempotency-key');
  if (key === undefined) return toOrderResponse(await services.orderTransactions.placeOrder(input));
  if (key.length === 0 || key.length > 255) {
    throw new BadRequestException('Idempotency-Key must be 1 to 255 characters');
  }

  const { replayed, order } = await services.orderTransactions.placeOrderOnce(input, {
    key,
    principalId: user.id,
  });
  if (replayed) context.header('Idempotent-Replayed', 'true');
  return order;
},
```

Document the header in OpenAPI with `openapi.parameters`, so generated clients can send it.

## Authorization on Replay

A replay goes through the same authentication and `authorize` check as a new request; the stored response is only returned afterwards. A caller who lost the permission since the first request gets `403`, not the stored order. Because keys are scoped by principal, one user's key never returns another user's response.

## Lifetime and Retention

A key protects its request for a day by default (`ttlSeconds`). After that, the same key is a new request, with any body. Choose a lifetime that covers how long your clients retry, including offline devices. Delete expired keys on a schedule:

```sql
DELETE FROM "IdempotencyKey" WHERE "expiresAt" < LOCALTIMESTAMP - interval '1 day';
```

## What This Does Not Cover

- **Different requests competing for the same data**, such as two orders for the last item. Idempotency only recognizes repeats of one request; the stock rule needs its own protection in the database.
- **Retrying business operations transparently.** A `409` for a request in progress is an answer to the client, which decides when to retry.
- **Side effects outside the database.** A request that also calls an external system needs that system's own idempotency key.

## Testing

| Rule | Test in the reference consumer |
| --- | --- |
| A repeat changes nothing | The second request returns the first body with `Idempotent-Replayed: true`; one order, stock decremented once |
| Concurrent repeats start no second change | Five parallel requests with one key: one order, four replays, the same order id |
| A different body is rejected | `422`, and still one order |
| Tenants and principals have their own keys | Two users of one tenant and a user of another tenant reuse a key and each get their own order |
| A bounded wait for a request in progress | An open transaction holds the key; the request gets `409` after 200 ms, and runs normally once that transaction rolled back |
| Failures do not use up the key | A `409` for missing stock, then the same key succeeds after restocking |
| Expired keys start over | After `expiresAt`, the same key with a different body places a new order |
| Replays need the permission | The same user, now a viewer, gets `403` for the replay |

The acquisition tests also hold an expired key locked and delete an expired key between the insert and row lock. The former returns `409` within the configured wait; the latter stores the response on a reacquired key and replays it without another change.
