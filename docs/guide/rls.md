---
title: Row Level Security
---

# Row Level Security (RLS)

Glasswork ships first-class helpers for PostgreSQL Row Level Security using Prisma Client Extensions. This guide shows how to scope every request to a tenant, provide an admin escape hatch, and test RLS behavior without extra boilerplate.

## What you get

- Per-request Prisma clients that set `SET LOCAL` session variables before each query.
- Hono middleware to place tenant context on the request.
- Awilix provider to resolve a scoped Prisma client (`tenantPrisma` by default).
- Admin/bypass client for system operations.
- Testing helpers to seed data per tenant and run code with scoped clients.

## Defaults

- Session variables:
  - `app.tenant_id`
  - `app.user_id`
  - `app.user_role`
  - `app.bypass_rls` (used by the admin client and `seedTenant`)
- Transaction wrapping is on by default so `SET LOCAL` stays scoped to the query.

## Database setup (PostgreSQL)

Enable RLS and add policies that read the session variables:

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON projects
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY admin_delete ON projects
  FOR DELETE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND current_setting('app.user_role', true) = 'admin'
  );
```

Prisma schema convention (example):

```prisma
model Project {
  id        String   @id @default(cuid())
  name      String
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdBy String

  @@index([tenantId])
}
```

## Glasswork integration

1) **Add middleware** to extract tenant info (uses `c.get('auth')` by default):

```ts
import { rlsMiddleware } from 'glasswork';

app.use(rlsMiddleware());
```

2) **Register the scoped Prisma provider** in your module:

```ts
import { createRLSProvider } from 'glasswork';

export const AppModule = defineModule({
  name: 'app',
  providers: [
    PrismaService,          // base client on prismaService.client
    createRLSProvider(),    // exposes tenantPrisma (scoped)
    ProjectService,
  ],
});
```

3) **Inject the scoped client** in services:

```ts
class ProjectService {
  constructor(private readonly tenantPrisma: PrismaClient) {}

  async findAll() {
    return this.tenantPrisma.project.findMany();
  }
}
```

### Customizing tokens and variables

```ts
createRLSProvider({
  provide: 'scopedPrisma',
  clientToken: 'prisma',      // if you register the base client directly
  clientProperty: undefined,  // set to undefined when the token is the client itself
  contextToken: 'tenantContext',
  config: {
    useTransaction: true,
    sessionVariables: {
      tenantId: 'myapp.tenant_id',
      userId: 'myapp.user_id',
      role: 'myapp.user_role',
    },
  },
});
```

### Admin / bypass client

```ts
import { createAdminClient } from 'glasswork';

const adminPrisma = createAdminClient(prisma);
await adminPrisma.project.deleteMany(); // runs with app.bypass_rls = true
```

## Testing utilities

- `withTenant(prisma, tenantContext | tenantId, fn, options?)` — runs `fn` with a scoped client.
- `seedTenant(prisma, tenantId, seedFn, options?)` — sets `app.bypass_rls` and `app.tenant_id` inside a transaction, then executes `seedFn`.

Example:

```ts
import { seedTenant, withTenant } from 'glasswork';

await seedTenant(prisma, 'tenant-1', async (tx) => {
  await tx.project.create({ data: { id: 'p1', name: 'One' } });
});

await withTenant(prisma, 'tenant-1', async (tenantPrisma) => {
  const projects = await tenantPrisma.project.findMany();
  expect(projects).toHaveLength(1);
});
```

## Performance notes

- Wrapping each query in a transaction adds a small overhead; keep it enabled unless you manage session variables per connection yourself.
- For bulk operations, batch work inside a single `prisma.$transaction` to set variables once.

## CLI status

A `glasswork generate rls` helper is planned but not shipped yet. Until then:
- Keep tenant fields consistent (`tenantId` with an index).
- Generate policies manually using the SQL snippets above.
- If you need automation, mirror the `formatSetStatement` pattern to build your own migration scripts.
