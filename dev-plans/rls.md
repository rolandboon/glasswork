# Row Level Security (RLS) Development Plan for Glasswork

## Executive Summary

This document outlines a plan for seamless PostgreSQL Row Level Security (RLS) integration in Glasswork. The goal is to make multi-tenancy "just work" with minimal boilerplate, leveraging Prisma Client Extensions and Lambda's request-scoped execution model.

## Background & Context

### The RLS Challenge

Row Level Security in PostgreSQL is powerful but historically painful to implement with ORMs:

1. **Connection Management**: RLS relies on session variables (`SET app.tenant_id = '...'`), requiring careful connection handling
2. **Prisma Limitations**: Prisma doesn't natively support setting session variables before queries
3. **Connection Pooling**: External poolers (PgBouncer) complicate session state
4. **Testing Complexity**: Mocking RLS behavior is difficult

### Why Lambda Makes This Easier

Lambda's execution model actually helps:
- Each invocation is isolated (no shared state bleeding)
- Short-lived connections align with RLS session patterns
- Request-scoped DI naturally fits tenant context
- No long-lived connection pools to manage

### Prisma Client Extensions

[Prisma Client Extensions](https://www.prisma.io/docs/orm/prisma-client/client-extensions) explicitly mention RLS as a use case:

> "Implement row-level security (RLS), where each HTTP request has its own client with its own RLS extension, customized with session data."

This is our foundation.

---

## Design Goals

1. **Zero Boilerplate**: Tenant scoping should be automatic after initial setup
2. **True Database Security**: RLS policies in PostgreSQL, not just application filtering
3. **Type Safety**: Tenant context should be typed throughout
4. **Easy Testing**: Mock tenant context without complex DB setup
5. **Transparent**: Developers can see and understand the SQL being executed
6. **Escape Hatch**: Allow bypassing RLS for admin operations

---

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           HTTP Request                                  │
│                    (with tenant context in JWT/session)                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Auth Middleware                                  │
│              Extract tenant context from request                        │
│              Store in Hono context: c.set('tenant', { id, role })      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Scoped Prisma Client                                 │
│         Created per-request with tenant context                         │
│         Sets PostgreSQL session variables                               │
│         All queries automatically filtered by RLS                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL                                      │
│              RLS policies check current_setting('app.tenant_id')       │
│              Database enforces tenant isolation                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Tenant Context Type

```typescript
/**
 * Tenant context extracted from authentication
 */
interface TenantContext {
  /** Tenant/organization ID */
  tenantId: string;
  /** Current user ID within the tenant */
  userId: string;
  /** User's role for permission checks */
  role: 'admin' | 'member' | 'viewer';
}

/**
 * RLS configuration options
 */
interface RLSConfig {
  /** PostgreSQL session variable names */
  sessionVariables: {
    tenantId: string;  // default: 'app.tenant_id'
    userId: string;    // default: 'app.user_id'
    role: string;      // default: 'app.user_role'
  };
  /** Whether to use transactions for session variable isolation */
  useTransaction: boolean;  // default: true
}
```

#### 2. RLS-Enabled Prisma Extension

```typescript
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Creates a Prisma Client extension that sets RLS session variables
 * before each query.
 *
 * @example
 * ```typescript
 * const tenantPrisma = createRLSClient(basePrisma, {
 *   tenantId: 'tenant_123',
 *   userId: 'user_456',
 *   role: 'member',
 * });
 *
 * // All queries now automatically scoped to tenant_123
 * const projects = await tenantPrisma.project.findMany();
 * ```
 */
export function createRLSClient<T extends PrismaClient>(
  prisma: T,
  context: TenantContext,
  config?: Partial<RLSConfig>
): T {
  const cfg: RLSConfig = {
    sessionVariables: {
      tenantId: 'app.tenant_id',
      userId: 'app.user_id',
      role: 'app.user_role',
      ...config?.sessionVariables,
    },
    useTransaction: config?.useTransaction ?? true,
  };

  return prisma.$extends({
    name: 'rls',
    query: {
      $allOperations: async ({ operation, model, args, query }) => {
        // Set session variables before the query
        const setStatements = [
          `SET LOCAL "${cfg.sessionVariables.tenantId}" = '${escapeValue(context.tenantId)}'`,
          `SET LOCAL "${cfg.sessionVariables.userId}" = '${escapeValue(context.userId)}'`,
          `SET LOCAL "${cfg.sessionVariables.role}" = '${escapeValue(context.role)}'`,
        ];

        if (cfg.useTransaction) {
          // Wrap in transaction to ensure SET LOCAL applies
          return prisma.$transaction(async (tx) => {
            for (const stmt of setStatements) {
              await tx.$executeRawUnsafe(stmt);
            }
            // Execute the original query within the transaction
            return (tx as any)[model!][operation](args);
          });
        } else {
          // Direct execution (less safe, requires careful connection handling)
          for (const stmt of setStatements) {
            await prisma.$executeRawUnsafe(stmt);
          }
          return query(args);
        }
      },
    },
  }) as T;
}

/**
 * Escape a value for use in SET statement to prevent SQL injection
 */
function escapeValue(value: string): string {
  // Replace single quotes with doubled single quotes (PostgreSQL escaping)
  return value.replace(/'/g, "''");
}
```

#### 3. Glasswork Integration

```typescript
// rls/rls-provider.ts
import { asFunction, Lifetime } from 'awilix';

/**
 * Creates a scoped Prisma client provider for RLS
 *
 * @example
 * ```typescript
 * // In module definition
 * export const AppModule = defineModule({
 *   providers: [
 *     // Base Prisma client (singleton)
 *     PrismaService,
 *     // RLS-scoped client (request-scoped)
 *     createRLSProvider(),
 *   ],
 * });
 * ```
 */
export function createRLSProvider(config?: Partial<RLSConfig>) {
  return {
    provide: 'tenantPrisma',
    useFactory: ({
      prismaService,
      tenantContext,
    }: {
      prismaService: PrismaService;
      tenantContext: TenantContext;
    }) => {
      return createRLSClient(prismaService.client, tenantContext, config);
    },
    lifetime: Lifetime.SCOPED,  // New instance per request
  };
}

/**
 * Middleware to extract tenant context from request and register in DI
 */
export function rlsMiddleware() {
  return async (c: Context, next: Next) => {
    // Extract tenant context from auth (JWT, session, etc.)
    const auth = c.get('auth');

    if (!auth?.tenantId) {
      // No tenant context - requests will fail RLS checks
      // Or use a "public" context for unauthenticated routes
      return next();
    }

    const tenantContext: TenantContext = {
      tenantId: auth.tenantId,
      userId: auth.userId,
      role: auth.role,
    };

    // Store in Hono context for DI registration
    c.set('tenantContext', tenantContext);

    return next();
  };
}
```

#### 4. Service Usage

```typescript
// services/project.service.ts
class ProjectService {
  constructor(
    // Inject the RLS-scoped Prisma client
    private tenantPrisma: PrismaClient,
  ) {}

  async findAll(): Promise<Project[]> {
    // RLS automatically filters by tenant - no WHERE clause needed!
    return this.tenantPrisma.project.findMany();
  }

  async create(data: CreateProjectDto): Promise<Project> {
    // RLS ensures this can only be created for the current tenant
    return this.tenantPrisma.project.create({
      data: {
        ...data,
        // tenantId is set by database default or trigger
      },
    });
  }

  async findById(id: string): Promise<Project | null> {
    // RLS prevents accessing other tenants' projects
    return this.tenantPrisma.project.findUnique({
      where: { id },
    });
  }
}
```

---

## PostgreSQL RLS Setup

### Enable RLS on Tables

```sql
-- Enable RLS on the projects table
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (important!)
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
```

### Create RLS Policies

```sql
-- Policy: Users can only see their tenant's projects
CREATE POLICY tenant_isolation ON projects
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Policy: Only admins can delete
CREATE POLICY admin_delete ON projects
  FOR DELETE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND current_setting('app.user_role', true) = 'admin'
  );

-- Policy: Users can only update projects they created
CREATE POLICY owner_update ON projects
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      created_by = current_setting('app.user_id', true)::uuid
      OR current_setting('app.user_role', true) = 'admin'
    )
  );
```

### Default Tenant ID on Insert

```sql
-- Automatically set tenant_id on insert from session variable
ALTER TABLE projects
  ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- Or use a trigger for more complex logic
CREATE OR REPLACE FUNCTION set_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := current_setting('app.tenant_id', true)::uuid;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_tenant_id_trigger
  BEFORE INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_tenant_id();
```

---

## Bypass RLS for Admin Operations

Sometimes you need to bypass RLS (system operations, migrations, admin tools):

```typescript
/**
 * Creates an admin Prisma client that bypasses RLS
 * Use with caution - only for system-level operations
 */
export function createAdminClient(prisma: PrismaClient): PrismaClient {
  return prisma.$extends({
    name: 'admin-bypass',
    query: {
      $allOperations: async ({ operation, model, args, query }) => {
        // Set role to bypass RLS
        await prisma.$executeRawUnsafe(
          `SET LOCAL "app.bypass_rls" = 'true'`
        );
        return query(args);
      },
    },
  });
}

// PostgreSQL policy that respects bypass flag
// CREATE POLICY bypass_rls ON projects
//   FOR ALL
//   USING (
//     current_setting('app.bypass_rls', true) = 'true'
//     OR tenant_id = current_setting('app.tenant_id', true)::uuid
//   );
```

Alternative: Use a separate database role with BYPASSRLS privilege:

```sql
-- Create admin role that bypasses RLS
CREATE ROLE app_admin BYPASSRLS;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;
```

---

## Testing Strategy

### Unit Tests: Mock Tenant Context

```typescript
describe('ProjectService', () => {
  let service: ProjectService;
  let mockPrisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaClient>();
    service = new ProjectService(mockPrisma);
  });

  it('should find all projects', async () => {
    mockPrisma.project.findMany.mockResolvedValue([mockProject]);

    const result = await service.findAll();

    expect(result).toEqual([mockProject]);
    // No need to verify tenant filtering - RLS handles it
  });
});
```

### Integration Tests: Real RLS

```typescript
describe('ProjectService (Integration)', () => {
  let prisma: PrismaClient;
  let tenant1Prisma: PrismaClient;
  let tenant2Prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();

    // Create scoped clients for different tenants
    tenant1Prisma = createRLSClient(prisma, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'admin',
    });

    tenant2Prisma = createRLSClient(prisma, {
      tenantId: 'tenant-2',
      userId: 'user-2',
      role: 'admin',
    });
  });

  beforeEach(async () => {
    // Seed test data with admin client (bypasses RLS)
    const adminPrisma = createAdminClient(prisma);
    await adminPrisma.project.createMany({
      data: [
        { id: 'p1', name: 'Tenant 1 Project', tenantId: 'tenant-1' },
        { id: 'p2', name: 'Tenant 2 Project', tenantId: 'tenant-2' },
      ],
    });
  });

  it('tenant 1 can only see their projects', async () => {
    const projects = await tenant1Prisma.project.findMany();

    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Tenant 1 Project');
  });

  it('tenant 2 cannot access tenant 1 projects', async () => {
    const project = await tenant2Prisma.project.findUnique({
      where: { id: 'p1' },  // Tenant 1's project
    });

    expect(project).toBeNull();  // RLS blocks access
  });

  it('tenant 2 cannot delete tenant 1 projects', async () => {
    // This should silently do nothing (RLS filters it out)
    await tenant2Prisma.project.deleteMany({
      where: { id: 'p1' },
    });

    // Verify project still exists
    const project = await tenant1Prisma.project.findUnique({
      where: { id: 'p1' },
    });
    expect(project).not.toBeNull();
  });
});
```

### Test Utilities

```typescript
// testing/rls-helpers.ts

/**
 * Create a test context with a specific tenant
 */
export function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (scopedPrisma: PrismaClient) => Promise<T>
): Promise<T> {
  const scopedPrisma = createRLSClient(prisma, {
    tenantId,
    userId: 'test-user',
    role: 'admin',
  });
  return fn(scopedPrisma);
}

/**
 * Seed data for a specific tenant (bypasses RLS)
 */
export async function seedTenant(
  prisma: PrismaClient,
  tenantId: string,
  seed: (prisma: PrismaClient) => Promise<void>
): Promise<void> {
  const adminPrisma = createAdminClient(prisma);
  // Temporarily set tenant context for default values
  await adminPrisma.$executeRawUnsafe(
    `SET LOCAL "app.tenant_id" = '${tenantId}'`
  );
  await seed(adminPrisma);
}
```

---

## Prisma Schema Conventions

```prisma
// schema.prisma

model Tenant {
  id        String   @id @default(cuid(2))
  name      String
  createdAt DateTime @default(now())

  // Relations
  users    User[]
  projects Project[]
}

model User {
  id       String @id @default(cuid(2))
  email    String
  role     String @default("member")

  // Tenant relation
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  // RLS: Users can only see users in their tenant
  @@index([tenantId])
}

model Project {
  id        String   @id @default(cuid(2))
  name      String
  createdAt DateTime @default(now())

  // Tenant relation (required for RLS)
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])

  // Creator for ownership-based policies
  createdBy String

  // RLS: Index on tenant_id for performance
  @@index([tenantId])
}
```

---

## Migration Helper

Generate RLS policies from Prisma schema:

```typescript
// cli/generate-rls.ts (future CLI command)

/**
 * glasswork generate rls
 *
 * Generates RLS policies for all models with tenantId field
 */
export function generateRLSPolicies(schema: DMMF.Document): string {
  const policies: string[] = [];

  for (const model of schema.datamodel.models) {
    const hasTenantId = model.fields.some(f => f.name === 'tenantId');

    if (!hasTenantId) continue;

    const tableName = toSnakeCase(model.name);

    policies.push(`
-- RLS for ${model.name}
ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_${tableName} ON "${tableName}"
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
`);
  }

  return policies.join('\n');
}
```

---

## Full Example: Module Setup

```typescript
// modules/app.module.ts
import { defineModule } from 'glasswork';
import { createRLSProvider, rlsMiddleware } from 'glasswork/rls';

export const AppModule = defineModule({
  name: 'app',
  middleware: [
    authMiddleware(),      // Extract user from JWT
    rlsMiddleware(),       // Set tenant context
  ],
  providers: [
    // Base Prisma client (singleton, no RLS)
    PrismaService,

    // RLS-scoped Prisma client (request-scoped)
    createRLSProvider(),

    // Services inject tenantPrisma, not prismaService
    ProjectService,
    UserService,
  ],
});
```

```typescript
// routes/project.routes.ts
export const projectRoutes = createRoutes((router, { projectService }, route) => {
  router.get('/', ...route({
    responses: { 200: ProjectListDto },
    handler: async () => {
      // Automatically scoped to current tenant
      return projectService.findAll();
    },
  }));

  router.get('/:id', ...route({
    params: v.object({ id: v.string() }),
    responses: { 200: ProjectDto },
    handler: async ({ params }) => {
      // RLS prevents accessing other tenants' projects
      const project = await projectService.findById(params.id);
      if (!project) throw new NotFoundException('Project not found');
      return project;
    },
  }));
});
```

---

## Performance Considerations

### Transaction Overhead

Each query wrapped in a transaction adds ~1-2ms overhead. For most applications this is acceptable, but for high-throughput scenarios:

**Option 1: Connection-level SET (Neon/Supabase)**

Some hosted PostgreSQL providers support connection-level session variables:

```typescript
// For Neon with connection pooling
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${DATABASE_URL}?options=-c app.tenant_id=${tenantId}`,
    },
  },
});
```

**Option 2: Batched Operations**

For bulk operations, use a single transaction:

```typescript
async bulkCreate(items: CreateProjectDto[]): Promise<Project[]> {
  return this.tenantPrisma.$transaction(async (tx) => {
    // Session variables set once, all operations in same transaction
    return Promise.all(
      items.map(item => tx.project.create({ data: item }))
    );
  });
}
```

### Index Strategy

Always index `tenant_id`:

```sql
-- Composite indexes for common queries
CREATE INDEX idx_projects_tenant_created ON projects (tenant_id, created_at DESC);
CREATE INDEX idx_projects_tenant_name ON projects (tenant_id, name);
```

---

## Dependencies

```json
{
  "peerDependencies": {
    "@prisma/client": "^5.0.0 || ^6.0.0"
  }
}
```

No additional dependencies - RLS support is built on Prisma Client Extensions.

---

## Implementation Phases

### Phase 1: Core RLS Support
**Goal**: Basic RLS integration with Prisma

**Deliverables**:
1. `TenantContext` type
2. `createRLSClient()` function
3. `createAdminClient()` for bypass
4. Basic documentation
5. Example PostgreSQL policies

### Phase 2: Glasswork Integration
**Goal**: Seamless DI integration

**Deliverables**:
1. `createRLSProvider()` for Awilix
2. `rlsMiddleware()` for Hono
3. Scoped client per request
4. Integration guide

### Phase 3: Testing Utilities
**Goal**: Make RLS easy to test

**Deliverables**:
1. `withTenant()` test helper
2. `seedTenant()` helper
3. Integration test patterns
4. Testing guide

### Phase 4: CLI & DX
**Goal**: Reduce boilerplate

**Deliverables**:
1. `glasswork generate rls` command
2. Policy generation from Prisma schema
3. Migration helpers
4. Comprehensive documentation

---

## Success Criteria

A successful RLS module for Glasswork will:

1. ✅ Provide automatic tenant scoping via Prisma extensions
2. ✅ Enforce security at the database level (not just application)
3. ✅ Integrate seamlessly with Awilix DI
4. ✅ Support bypass for admin operations
5. ✅ Include comprehensive testing utilities
6. ✅ Provide SQL generation for RLS policies
7. ✅ Document PostgreSQL setup clearly
8. ✅ Have minimal performance overhead

---

## References

- [Prisma Client Extensions](https://www.prisma.io/docs/orm/prisma-client/client-extensions)
- [PostgreSQL Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Neon RLS Guide](https://neon.tech/docs/guides/row-level-security)
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security)

---

## Next Steps

1. **Technical Spike**: Test Prisma extension with SET LOCAL in transactions
2. **Phase 1**: Build core `createRLSClient`
3. **Validate**: Test with real PostgreSQL RLS policies
4. **Phase 2**: Integrate with Glasswork DI
5. **Document**: Write comprehensive guides

