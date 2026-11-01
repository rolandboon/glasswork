---
description: One explicit transaction per use case across modules, with Prisma, RLS and audit records that commit or roll back together.
---

# Transactions Across Modules

A use case that changes data owned by two modules must commit or roll back as a whole. Glasswork has the building blocks: the [RLS extension](/auth/row-level-security#writes-and-transactions) binds the tenant to one callback transaction, and an audit sink accepts the caller's transaction. It deliberately has no unit-of-work API. This page is a recipe of application code, taken from the [reference consumer](https://github.com/rolandboon/glasswork/tree/main/fixtures/reference-consumer), where every claim below is a test against PostgreSQL.

The rule: **one explicit application transaction per use case.** A persistence adapter opens it and builds every port from the same transaction client. Domain code receives business arguments and ports, and never sees the transaction.

## The Example

Placing an order touches two modules:

| Step | Module | Table |
| --- | --- | --- |
| Create the order | orders | `Order` |
| Reserve stock | inventory | `StockItem`, `Reservation` |
| Audit both changes | platform (audit) | `AuditLog` |
| Record the intent to notify | orders | `PendingNotification` |

A report reads orders and reservations together: the one deliberate exception to table ownership.

## The Domain Function

The use case is a plain function over ports. It imports nothing from Prisma or Glasswork, so it runs in a unit test with in-memory ports:

```typescript
// src/orders/orders.domain.ts
export async function placeOrder(ports: PlaceOrderPorts, input: PlaceOrderInput): Promise<Order> {
  const actor = { actorUserId: input.actorUserId, tenantId: input.tenantId };
  const order = await ports.orders.create({
    id: ports.newId(),
    tenantId: input.tenantId,
    sku: input.sku,
    quantity: input.quantity,
    status: 'placed',
    createdAt: ports.now(),
  });
  await ports.audit.record('Order placed', {
    action: 'order.place', subjectType: 'Order', subjectId: order.id, ...actor,
  });

  const reservation = await ports.stock.reserve({
    tenantId: input.tenantId, orderId: order.id, sku: input.sku, quantity: input.quantity,
  });
  await ports.audit.record('Stock reserved', {
    action: 'inventory.reserve', subjectType: 'Reservation', subjectId: reservation.id, ...actor,
  });

  await ports.notifications.orderPlaced(order);
  return order;
}
```

The orders module declares the ports it needs, including `StockReservations`. The inventory module implements it without the domain importing inventory code.

## The Persistence Adapter

One class opens the transaction and composes the ports:

```typescript
// src/orders/order-transactions.ts
export class OrderTransactions {
  // constructor receives prisma, inventoryFor, audit and orderNotificationsFor

  placeOrder(input: PlaceOrderInput): Promise<Order> {
    return this.#prisma.$withTenant({ tenantId: input.tenantId }, (tx) =>
      placeOrder(
        {
          orders: createOrderStore(tx),
          stock: this.#inventoryFor(tx),
          audit: auditIn(this.#audit, tx),
          notifications: this.#notificationsFor(tx),
          newId: randomUUID,
          now: () => new Date(),
        },
        input
      )
    );
  }
}
```

`$withTenant` opens the RLS callback transaction for the tenant in the input. Every port receives `tx`, so an exception anywhere rolls back the order, the reservation, the audit rows and the notification intent together.

The adapter is an ordinary singleton provider, but it holds no transaction: `tx` exists only inside the callback, so concurrent calls never share one. Avoid the alternatives that make the transaction implicit:

- **No mutable `tx` on a singleton.** Two concurrent requests would overwrite each other's transaction.
- **No AsyncLocalStorage for the transaction.** A service could no longer tell which client it writes through, and a missing context silently falls back to the root client.
- **No container scope per request.** If you use an Awilix scope, create it per transaction execution, register `tx` in it and resolve non-singleton services from it. The binders below need no container access and were simpler.

### Binding Another Module's Service

The inventory module exports a binder instead of its service on the root client:

```typescript
// src/inventory/inventory.module.ts
export type InventoryFor = (tx: Transaction) => InventoryService;

export const InventoryModule = defineModule({
  name: 'inventory',
  imports: [DatabaseModule, AuthModule],
  providers: [
    // On the root client, for reads outside a use case.
    InventoryService,
    {
      provide: 'inventoryFor',
      useValue: ((tx) => new InventoryService({ prisma: tx })) satisfies InventoryFor,
    },
  ],
  exports: ['inventoryFor'],
});
```

Other modules can only reach inventory's writes through a transaction they pass in.

### What an Existing Prisma Service Needed

`InventoryService` is written the way many existing services are: it receives a Prisma client and queries it directly. Bringing it into the transaction took two changes:

1. **Its client parameter type.** It was typed with the root client. It now uses the delegates that the root client and a transaction client share:

   ```typescript
   // src/platform/database.module.ts
   export type Transaction = RLSTransactionClient<Database>;
   export type DatabaseClient = Transaction;

   // src/inventory/inventory.service.ts
   constructor({ prisma }: { prisma: DatabaseClient }) { … }
   ```

   The root client is still assignable to it, so the class provider and its callers did not change.
2. **A binder export**, shown above.

Its queries needed no changes. Three patterns cost more:

- **A service that opens its own `$transaction`**, such as the fixture's `InvitationsService`, cannot join a larger use case. A transaction client has no `$transaction`, and nested transactions are unavailable. Move the transaction into the caller and let the service accept a client.
- **A service that reads `prisma` from shared state** at call time instead of its constructor. Pass the client in explicitly.
- **A service resolved from the container inside the use case.** The container gives you the root-client instance. The test under [Testing](#testing) finds this mistake.

## Audit in the Transaction

The audit logger accepts the caller's transaction and passes it to the sink:

```typescript
// src/platform/audit.module.ts
export function auditIn(audit: AuditingLogger<Transaction>, tx: Transaction): AuditTrail {
  return { record: (message, entry) => audit.audit(message, entry, { tx }) };
}
```

The sink writes the `AuditLog` row through `tx`, so the row commits or rolls back with the order.

**A log line describes an attempt.** The logger writes its structured line (`audit: true`) before the sink runs. When a later step fails, the transaction rolls back and the row disappears, but the line remains. Treat the audit table as the record of completed changes. Use the log lines for diagnosis, and look up the row before you rely on one. A line without a row means the change was attempted and rolled back, or the sink failed.

## HTTP Routes and Jobs

The route and the job call the same adapter with business arguments. The tenant comes from the input, not from ambient request state:

```typescript
// src/orders/orders.module.ts: the route
handler: ({ body, user }) =>
  services.orderTransactions.placeOrder({
    tenantId: user.tenantId,
    actorUserId: user.id,
    sku: body.sku,
    quantity: body.quantity,
  }),

// src/orders/place-order.job.ts: the job
handler: async (payload, { services }) => {
  await services.orderTransactions.placeOrder(payload);
},
```

The route needs no RLS middleware: `$withTenant` binds the tenant from the input. A job validates its payload and calls the same code path, in-process or through the SQS worker.

## Reads Across Modules

The report reads `Order` and `Reservation` in a separate reporting module. It only reads, and it is listed as an exception in the boundary test and the [data ownership](/application-structure/testing#data-ownership) table. Writes stay with the owning modules. When a cross-module read grows into more than a report, the owning module should export a read model instead.

## Testing

Unit tests run the domain function with in-memory ports. A [boundary test](/application-structure/testing#module-boundaries-in-code) checks that `*.domain.ts` files import only other domain files, so these tests keep running without Prisma or Glasswork.

Integration tests use PostgreSQL with a restricted role and the RLS policies, through the HTTP routes and the job worker:

| Claim | How the test shows it |
| --- | --- |
| Everything commits together | The order, reservation, audit rows and notification intent all have the same `xmin`, the id of the transaction that inserted them |
| A failure rolls everything back | A provider override replaces the notification port with one that throws after the reservation; the row counts and the stock level stay unchanged |
| Concurrent use cases do not share a transaction | Six parallel orders: each has one `xmin` across its rows, and the six values differ |
| A service on the root client is found | With `inventoryFor` overridden to return the root-client service, the rollback test fails because the reservation and the stock decrement survive |
| HTTP and jobs behave the same | An order from the route and one from a job through the SQS worker write the same rows |

The rollback check is a row count before and after, so it catches any write that escapes the transaction, whichever service made it:

```typescript
async function assertNothingCommitted(before: Record<string, number>) {
  assert.deepEqual(await counts(), before, 'a write survived the rollback');
}
```

## When to Redesign

Stop and reconsider the design when the transaction client has to switch implicitly, when a second connection writes outside the transaction, or when the solution only works through ambient global state. Each of these breaks the guarantee that the tests above check.
