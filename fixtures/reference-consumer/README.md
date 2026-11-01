# Reference consumer

A small application that uses Glasswork the way applications do: installed from the packed
tarball, compiled against the published declarations, and run against PostgreSQL. Run it
from the repository root after `npm run build`:

```sh
REFERENCE_DATABASE_URL=postgresql://admin:password@localhost:5432/test_db npm run consumer:reference
```

The runner copies this directory to a temporary folder, installs the tarball and these
dependencies, generates the Prisma client, compiles the application and its tests, runs the
tests, checks `contract/openapi.json` against the routes, generates a HeyAPI client from it,
typechecks `client-check.ts` against that client, and bundles and runs the Lambda and Node
entry points. It prints the bundle size and the time a fresh process needs to import the
Lambda bundle. `REFERENCE_DATABASE_URL` needs a test database user
that may create schemas and roles; every run uses its own schema and a restricted role.
Set `KEEP_REFERENCE_CONSUMER=1` to keep the temporary folder.

## What it guards

| Pattern | Where |
| --- | --- |
| Feature modules with private providers, platform modules and explicit exports | `src/**/*.module.ts` |
| Stable error codes, translated auth errors, cookie behavior, legacy decoding and runtime/DTO agreement | `test/error-codes.test.ts`, `client-check.ts` |
| Auth middleware with a protected and a guest route | `src/projects/projects.module.ts` |
| Tenant isolation with the RLS extension and a restricted database role | `test/support.ts`, `src/platform/database.module.ts` |
| A claim and its audit record in one transaction, then a versioned job | `src/invitations/invitations.service.ts` |
| One use case across the orders and inventory modules: order, reservation, audit rows and an outbox event in one RLS transaction, from a route and from a job | `src/orders/order-transactions.ts`, `test/transactions.test.ts` |
| A domain function without Prisma or Glasswork, unit-tested with in-memory ports | `src/orders/orders.domain.ts`, `test/orders.domain.test.ts` |
| An existing service that queries Prisma directly, bound to the use case's transaction | `src/inventory/inventory.module.ts` |
| A report that reads across modules as the one listed exception | `src/reporting/reporting.module.ts` |
| An outbox relay that claims with leases and `SKIP LOCKED`, keeps order per aggregate and runs as a Node loop or a bounded Lambda batch; an inbox that applies each event once | `src/platform/outbox.ts`, `src/loyalty/order-events.consumer.ts`, `test/outbox.test.ts` |
| An `Idempotency-Key` header whose key and response are stored in the order's transaction, with a bounded wait for concurrent repeats and a permission check on replay | `src/platform/idempotency.ts`, `test/idempotency.test.ts` |
| A pg-boss job inserted through `fromPrisma(tx)` in the use case's RLS transaction, with a publishing role limited to `INSERT` and `SELECT (id)` | `test/pgboss.test.ts` |
| A job that uses a private service of its own module, in-process and through the SQS serializer and worker | `src/invitations/send-invitation.job.ts` |
| Job payloads as JSON values (an ISO timestamp transformed to a `Date`) | `src/invitations/send-invitation.job.ts` |
| Booting one feature module with `bootstrap(FeatureModule)` | `test/application.test.ts` |
| Import boundaries between module folders, domain files without packages, and table ownership with listed read exceptions | `test/boundaries.test.ts` |
| OpenAPI generation without providers, using metadata-only overrides, checked against the committed contract | `src/openapi.ts`, `contract/openapi.json` |
| A generated client whose types fail when a response field disappears | `client-check.ts` |
| Lambda API and worker handlers and a Node server, bundled with the documented esbuild settings and run against PostgreSQL | `src/lambda.ts`, `src/server.ts`, `scripts/bundle.mjs`, `scripts/check-bundles.mjs` |
| Minification without `keepNames` breaking class provider tokens | runner, expected failure |

pg-boss 12 needs Node.js 22.12 or later, so the fixture does too; CI runs it on Node.js 24.

The fixture uses TypeScript 6 because the HeyAPI generator relies on the TypeScript
compiler API, which TypeScript 7 no longer provides. The pack smoke test covers TypeScript
5.9, 6 and 7 for the published declarations.

After changing a route or schema, rewrite the contract from a built copy with
`node dist/src/openapi.js` (for example in a folder kept with `KEEP_REFERENCE_CONSUMER=1`)
and commit `contract/openapi.json`.
