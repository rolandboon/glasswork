---
description: Tenant isolation with PostgreSQL RLS, Prisma Client Extensions, and transaction-scoped context.
---

# Row Level Security

`glasswork/rls` connects trusted tenant context to PostgreSQL Row Level Security.
PostgreSQL filters reads and rejects writes to another tenant. Glasswork applies
settings and executes the query on **the same transaction connection**.

## RLS and CASL

Use [CASL abilities](./abilities) to define which actions a user may perform. Add
RLS when tenant isolation must also be enforced in PostgreSQL, including queries
that omit an application-level tenant filter.

| Concern | Enforcement |
| --- | --- |
| Validate the session and resolve trusted tenant membership | [Authentication middleware](./middleware) and application logic |
| Allow an action on a resource or field | CASL abilities, route `authorize`, and service `assertCan` checks |
| Filter queries to records allowed by an ability | CASL's `accessibleBy` |
| Restrict reads and writes to the active tenant | PostgreSQL RLS policies with context from `glasswork/rls` |

For example, a member may read projects in their tenant but update only their own.
RLS enforces the tenant boundary; CASL enforces the ownership and action rules.
Keep `accessibleBy` filters for record-level permissions within the tenant. Even
`can('manage', 'all')` does not bypass RLS, and RLS does not grant that ability.
Both layers must allow the operation. `glasswork/rls` can also be used with an
authorization system other than CASL.

## Prerequisites

The integration uses Prisma's public extension and transaction APIs. It requires
no custom Prisma proxy, query filter DSL, or private Prisma transaction fields.
Install `@prisma/client` and the PostgreSQL adapter matching your generated client.
Import from `glasswork/rls`; the root export does not include this optional subsystem.
The context helpers use Node.js `AsyncLocalStorage`. These examples assume a
PostgreSQL database, a generated Prisma client, and a `Project` model with a text
`tenantId` column. `trustedTenantId` represents an ID whose membership the
application has already verified.

::: info Prisma Transaction Contract
The extension adds a transaction and tenant-setting query to individual operations
with context. Its `$transaction` supports the callback form only, and RLS must be
applied last when composing extensions. Review [Writes and Transactions](#writes-and-transactions)
and [Using Prisma Directly](#using-prisma-directly) before adopting it.
:::

## Prepare the Database

Use separate database roles for the application and migrations. The runtime role
must not be a superuser, have `BYPASSRLS`, or own tables. Grant only the required
privileges:

```sql
-- Create the login and password through your deployment configuration.
ALTER ROLE app_runtime NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Project" TO app_runtime;
```

Do not grant `TRUNCATE`, schema `CREATE`, or access to migration metadata.
`FORCE ROW LEVEL SECURITY` subjects the table owner to policies, but does not
protect against a superuser, `BYPASSRLS`, or an owner changing those policies.
PostgreSQL does not apply RLS to `TRUNCATE` or foreign key checks.
See [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Generate SQL for a **reviewed Prisma migration**, not during application startup:

```typescript
import { generateRLSPolicies } from 'glasswork/rls';

const sql = generateRLSPolicies({
  models: ['Project'], // SQL table names, respecting any @@map.
  tenantField: 'tenantId', // SQL column name, respecting any @map.
});
```

The generator produces `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`,
and a `FOR ALL` policy with the same tenant condition in `USING` and `WITH CHECK`.
The condition compares a text tenant column with
`NULLIF(current_setting('app.current_tenant_id', true), '')`. A missing or empty
setting grants no access. CUIDs and other text IDs work directly; for a UUID
column, for example, write an explicit policy with the appropriate cast. The
generator does not execute SQL or inspect the Prisma schema.

Add indexes on tenant columns. For relations between tenant tables, use composite
foreign keys, such as `(tenantId, projectId)` referencing `(tenantId, id)`. RLS
alone does not prevent relations across tenants. Review existing policies as
well: PostgreSQL combines permissive policies with `OR`, so a broader policy can
remove the tenant boundary.

## Configure Prisma

```typescript
import { PrismaPg } from '@prisma/adapter-pg';
import { createRLSExtension, runWithTenant } from 'glasswork/rls';
import { PrismaClient } from './generated/prisma/client.js';

const base = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const prisma = base.$extends(createRLSExtension({
  models: ['Project'], // Prisma model names, not SQL table names.
}));

const projects = await runWithTenant({ tenantId: trustedTenantId }, () =>
  prisma.project.findMany()
);
```

An individual query runs in a Prisma batch with a parameterized
`set_config(..., true)`. The setting and query therefore share one connection,
and the setting expires after commit or rollback. The helper also awaits lazy
`PrismaPromise` values within the context. Concurrent requests use separate
AsyncLocalStorage contexts; a warm Lambda process or reused pool does not make
session settings safe without this transaction boundary.

The extension also applies context to raw queries and models omitted from
`models`, because they can load relations to tenant tables. `models` only controls
where missing context produces an application error. Without `models`, this guard
covers all model and raw queries. With an explicit model list, raw queries without
context reach PostgreSQL, which continues to enforce its policies; this allows a
health check to execute `SELECT 1`, for example. `missingContextBehavior: 'ignore'`
also passes model queries without context to the database. It does not disable RLS.

Apply RLS **as the last Prisma extension**. Previously applied extensions remain
available in transactions. Keep the base client in the infrastructure layer;
application code should receive the extended client.

### Application Boundaries

Bind context at entry points: HTTP middleware, a job handler, or a CLI command.
Keep Prisma configuration and transaction helpers in infrastructure adapters.
Services depend on repository interfaces and receive any tenant ID needed for
business decisions as an explicit argument; they do not import `requireTenantId`
or read ambient Glasswork context. See [Architecture Philosophy](/architecture/philosophy#tenant-context-at-the-boundary).

AsyncLocalStorage stays within the current execution chain. A queued job needs a
validated tenant ID in its payload and a new `runWithTenant` boundary in the
worker; context does not travel through the queue automatically.

## Writes and Transactions

In the persistence adapter, pass `tenantId` explicitly from trusted context:

```typescript
import { requireTenantId } from 'glasswork/rls';

await runWithTenant({ tenantId: trustedTenantId }, () =>
  prisma.project.create({
    data: { tenantId: requireTenantId(), name: 'Annual plan' },
  })
);
```

Glasswork does not rewrite create, upsert, or nested relation input. This preserves
Prisma's input types and error behavior. If automatic population is required,
declare a PostgreSQL default using Prisma's `@default(dbgenerated(...))` and include
it in the migration. This also works for nested writes and SQL; `WITH CHECK`
continues to reject an explicitly incorrect tenant.

For multiple atomic steps, use the callback form of `$transaction` inside
`runWithTenant`, or the explicit `$withTenant` helper:

```typescript
await prisma.$withTenant({ tenantId: trustedTenantId }, async (tx) => {
  const project = await tx.project.create({
    data: { tenantId: requireTenantId(), name: 'Annual plan' },
  });
  return tx.project.update({
    where: { id: project.id },
    data: { name: 'Final annual plan' },
  });
}, { isolationLevel: 'Serializable', timeout: 10_000 });
```

Both forms configure the connection once and pass a standard, typed Prisma
transaction client to the callback. An exception rolls back the transaction.
Use **`tx`** for every step: a query through the outer client starts a separate
transaction, just as with ordinary Prisma. Changing the tenant or bypass context
on the transaction client is rejected. Nested transactions are unavailable.

The array form `$transaction([...])` is explicitly rejected: a second batch around
automatically wrapped queries can break the intended atomicity. The callback form
is the supported contract, both in TypeScript and at runtime. `maxWait`, `timeout`,
and `isolationLevel` are passed through. `runWithTenant` itself only establishes
context; it does not make multiple individual queries atomic together.

Explicit transactions require tenant or bypass context, even when `models`
excludes the queried model or `missingContextBehavior` is `'ignore'`.

### Using Prisma Directly

If you need Prisma's array transaction API or different transaction management,
use the unextended client inside an infrastructure adapter and set the tenant in
the same transaction yourself:

```typescript
const projects = await base.$transaction(async (tx) => {
  await tx.$executeRaw`
    SELECT set_config('app.current_tenant_id', ${trustedTenantId}, true)
  `;
  return tx.project.findMany();
});
```

This uses the same restricted database role and existing policies. Match the
setting names to your policies, including explicitly clearing or setting any
configured bypass variable. Removing the extension does not remove PostgreSQL
RLS; the adapter takes responsibility for context validation and transaction
setup. See [The Transparency Principle](/architecture/transparency#prisma-extensions-and-rls).

## HTTP and Authentication

Install RLS middleware after [authentication middleware](./middleware) and before
the protected routes:

```typescript
import { createRLSMiddleware } from 'glasswork/rls';

app.use('*', authMiddleware());
app.use('*', createRLSMiddleware({ allowUnauthenticated: false }));
```

The default extractor reads `tenantId`, `id`, and `role` from `context.get('user')`,
or `tenantId`, `userId`, and `role` from `context.get('auth')`. A custom
`extractTenant(context)` can be asynchronous. Derive the tenant from a validated
session or verified membership; an unchecked header, URL parameter, or request
body does not grant permission.

With `allowUnauthenticated: true` (the default), public requests proceed without
tenant context; any inherited tenant or bypass is cleared. Tenant queries remain
subject to their application guard and database policy.

Authentication may need to find a user before the tenant is known. An explicit,
optional bypass supports this:

```typescript
import { createRLSExtension, generateRLSPolicies, runWithBypass } from 'glasswork/rls';

const prisma = base.$extends(createRLSExtension({
  models: ['User', 'Project'],
  bypassVariable: 'app.auth_bypass',
}));
const authSql = generateRLSPolicies({
  models: ['User'], // Only this table allows bypass.
  bypassVariable: 'app.auth_bypass',
});

const session = await runWithBypass(() => authProvider.validateSession(token));
// Bypass has ended here. Bind the validated session's tenant next.
```

The policy accepts exactly the setting `'true'`. `runWithBypass` introduces no
fictitious tenant ID; `requireTenantId()` still fails without a real tenant.
Without `bypassVariable`, the extension rejects bypass. Tables without a bypass
policy remain protected. For authentication tables without their own tenant
column, write policies that check through their user, while global verification
records remain with the authentication provider.

A bypass flag is **not a secret** and does not protect against arbitrary SQL
execution with application credentials. The application can also set a tenant
setting itself. Here, RLS protects against missing or incorrect query filters
within trusted server code. Stronger separation of privileges requires separate
database roles and connections. Keep bypass narrowly scoped to session validation
or the authentication handler, never the subsequent public or authenticated request.

## Error Handling

`MissingTenantContextException` is a Glasswork `ForbiddenException`.
`RLSConfigurationException` reports invalid configuration, unsupported
transactions, or context changes. SQL policy errors remain ordinary Prisma or
PostgreSQL errors; the application determines their safe HTTP representation.

## Testing

`withTenant(tenantId, callback, options?)` and `withBypass(callback)` are test
helpers. They only change context and do not independently enable or disable
PostgreSQL RLS.

Test your application's policies with its restricted runtime role against a
separate test database. Seed records for two tenants, then verify isolation even
when a query has no tenant filter:

```typescript
import { withTenant } from 'glasswork/rls';

it('hides projects from another tenant', async () => {
  // Fixtures include project-a in tenant-a and project-b in tenant-b.
  const projects = await withTenant('tenant-a', () => prisma.project.findMany());

  expect(projects.map((project) => project.id)).toEqual(['project-a']);
});
```

Also cover rejected writes, raw queries, relations, transaction rollback,
concurrent tenants, and restoration after bypass. Verify CASL separately and test
the combined HTTP flow: a user can belong to the right tenant and still lack
permission for an action. See [Testing Auth](./testing#testing-tenant-isolation).
A passing test with a superuser does not prove tenant isolation.

For Glasswork's own PostgreSQL integration suite, see the repository's
[contributing instructions](https://github.com/rolandboon/glasswork#contributing).

## Next Steps

- [Abilities (CASL)](./abilities#tenant-isolation-with-rls) - Combine tenant isolation with action and record permissions
- [Middleware](./middleware#tenant-context-with-rls) - Bind context after session validation
- [Testing](./testing#testing-tenant-isolation) - Verify authentication, abilities, and tenant isolation together
- [API Reference](/api/#glassworkrls) - RLS helpers, options, and types
