# Testing Auth

This guide covers testing patterns for authentication and authorization in Glasswork applications.

## Testing Abilities

Test CASL abilities in isolation using `forRole()`:

```typescript
import { abilities } from './abilities';
import { subject } from 'glasswork';

describe('abilities', () => {
  describe('admin', () => {
    const ability = abilities.forRole('admin');

    it('can manage all resources', () => {
      expect(ability.can('manage', 'all')).toBe(true);
      expect(ability.can('delete', 'Project')).toBe(true);
    });
  });

  describe('member', () => {
    const ability = abilities.forRole('member', {
      id: 'user-1',
      tenantId: 'org-1',
    });

    it('can read projects in their organization', () => {
      expect(ability.can('read', subject('Project', {
        organizationId: 'org-1',
      }))).toBe(true);
    });

    it('cannot read projects in other organizations', () => {
      expect(ability.can('read', subject('Project', {
        organizationId: 'org-2',
      }))).toBe(false);
    });

    it('can only update own projects', () => {
      expect(ability.can('update', subject('Project', {
        organizationId: 'org-1',
        createdBy: 'user-1',
      }))).toBe(true);

      expect(ability.can('update', subject('Project', {
        organizationId: 'org-1',
        createdBy: 'user-2',
      }))).toBe(false);
    });

    it('cannot delete projects', () => {
      expect(ability.can('delete', 'Project')).toBe(false);
    });
  });

  describe('guest', () => {
    const ability = abilities.forRole('guest');

    it('has no abilities', () => {
      expect(ability.can('read', 'Project')).toBe(false);
      expect(ability.can('read', 'User')).toBe(false);
    });
  });
});
```

## Testing Middleware

Test auth middleware using Hono's `app.request()`:

```typescript
import { Hono } from 'hono';
import { createAuthMiddleware } from 'glasswork';
import { abilities } from './abilities';

describe('authMiddleware', () => {
  const mockProvider = {
    name: 'mock',
    validateSession: vi.fn(),
    invalidateSession: vi.fn(),
  };

  const middleware = createAuthMiddleware({
    provider: mockProvider,
    buildAbility: (user) => abilities.for(user),
    guestAbility: () => abilities.forRole('guest'),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows guest access when no session', async () => {
    mockProvider.validateSession.mockResolvedValue(null);

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({
      isAuthenticated: c.get('isAuthenticated'),
      user: c.get('user'),
    }));

    const res = await app.request('/test');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isAuthenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  it('sets user context when session is valid', async () => {
    mockProvider.validateSession.mockResolvedValue({
      session: { id: 'sess-1', userId: 'user-1', expiresAt: new Date(), createdAt: new Date() },
      user: { id: 'user-1', role: 'admin', email: 'admin@example.com' },
    });

    const app = new Hono();
    app.use('*', middleware());
    app.get('/test', (c) => c.json({
      isAuthenticated: c.get('isAuthenticated'),
      user: c.get('user'),
    }));

    const res = await app.request('/test', {
      headers: { Cookie: 'session=valid-token' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isAuthenticated).toBe(true);
    expect(body.user.id).toBe('user-1');
  });

  it('returns 401 when authorization required but not authenticated', async () => {
    mockProvider.validateSession.mockResolvedValue(null);

    const app = new Hono();
    app.use('*', middleware({ action: 'read', subject: 'Project' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');

    expect(res.status).toBe(401);
  });

  it('returns 403 when authorized but permission denied', async () => {
    mockProvider.validateSession.mockResolvedValue({
      session: { id: 'sess-1', userId: 'user-1', expiresAt: new Date(), createdAt: new Date() },
      user: { id: 'user-1', role: 'guest' },
    });

    const app = new Hono();
    app.use('*', middleware({ action: 'delete', subject: 'Project' }));
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test', {
      headers: { Cookie: 'session=valid-token' },
    });

    expect(res.status).toBe(403);
  });
});
```

## Mock Auth Provider

Create a reusable mock provider for tests:

```typescript
// test/helpers/mock-auth-provider.ts
import type { AuthProvider, AuthUser, AuthSession } from 'glasswork';

export function createMockProvider() {
  const sessions = new Map<string, { user: AuthUser; session: AuthSession }>();

  return {
    name: 'mock',

    // Add a session for testing
    addSession(token: string, user: AuthUser, session?: Partial<AuthSession>) {
      sessions.set(token, {
        user,
        session: {
          id: session?.id ?? `session-${Date.now()}`,
          userId: user.id,
          expiresAt: session?.expiresAt ?? new Date(Date.now() + 86400000),
          createdAt: session?.createdAt ?? new Date(),
          ...session,
        },
      });
    },

    async validateSession(token: string) {
      return sessions.get(token) ?? null;
    },

    async invalidateSession(sessionId: string) {
      for (const [token, data] of sessions) {
        if (data.session.id === sessionId) {
          sessions.delete(token);
          break;
        }
      }
    },

    clear() {
      sessions.clear();
    },
  };
}
```

Usage in tests:

```typescript
import { createMockProvider } from '../helpers/mock-auth-provider';

const mockProvider = createMockProvider();

beforeEach(() => {
  mockProvider.clear();
});

it('allows authenticated user access', async () => {
  mockProvider.addSession('test-token', {
    id: 'user-1',
    email: 'test@example.com',
    role: 'member',
    tenantId: 'org-1',
  });

  const res = await app.request('/api/projects', {
    headers: { Cookie: 'session=test-token' },
  });

  expect(res.status).toBe(200);
});
```

## Testing Routes with Auth

Test complete routes including auth context:

```typescript
import { bootstrap } from 'glasswork';
import { createMockProvider } from '../helpers/mock-auth-provider';
import { AppModule } from '../../src/app.module';

describe('Project Routes', () => {
  let app: Hono;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeAll(async () => {
    mockProvider = createMockProvider();
    
    const result = await bootstrap(AppModule, {
      // Override provider for testing
      authProvider: mockProvider,
    });
    app = result.app;
  });

  beforeEach(() => {
    mockProvider.clear();
  });

  describe('GET /api/projects', () => {
    it('returns 401 for unauthenticated users', async () => {
      const res = await app.request('/api/projects');
      expect(res.status).toBe(401);
    });

    it('returns projects for authenticated users', async () => {
      mockProvider.addSession('token', {
        id: 'user-1',
        role: 'member',
        tenantId: 'org-1',
      });

      const res = await app.request('/api/projects', {
        headers: { Cookie: 'session=token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('returns 403 for members', async () => {
      mockProvider.addSession('member-token', {
        id: 'user-1',
        role: 'member',
        tenantId: 'org-1',
      });

      const res = await app.request('/api/projects/123', {
        method: 'DELETE',
        headers: { Cookie: 'session=member-token' },
      });

      expect(res.status).toBe(403);
    });

    it('returns 204 for admins', async () => {
      mockProvider.addSession('admin-token', {
        id: 'admin-1',
        role: 'admin',
      });

      const res = await app.request('/api/projects/123', {
        method: 'DELETE',
        headers: { Cookie: 'session=admin-token' },
      });

      expect(res.status).toBe(204);
    });
  });
});
```

## Testing Prisma Filtering

Test that CASL abilities correctly filter Prisma queries:

```typescript
import { PrismaClient } from '@prisma/client';
import { abilities } from './abilities';
import { ProjectService } from './project.service';

describe('ProjectService with CASL', () => {
  let prisma: PrismaClient;
  let service: ProjectService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    service = new ProjectService(prisma);
    
    // Seed test data
    await prisma.project.createMany({
      data: [
        { id: 'p1', name: 'Project 1', organizationId: 'org-1', createdBy: 'user-1' },
        { id: 'p2', name: 'Project 2', organizationId: 'org-1', createdBy: 'user-2' },
        { id: 'p3', name: 'Project 3', organizationId: 'org-2', createdBy: 'user-3' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany();
    await prisma.$disconnect();
  });

  it('admin sees all projects', async () => {
    const ability = abilities.forRole('admin');
    const projects = await service.findAll(ability);
    
    expect(projects).toHaveLength(3);
  });

  it('member sees only their organization projects', async () => {
    const ability = abilities.forRole('member', {
      id: 'user-1',
      tenantId: 'org-1',
    });
    const projects = await service.findAll(ability);
    
    expect(projects).toHaveLength(2);
    expect(projects.every(p => p.organizationId === 'org-1')).toBe(true);
  });

  it('guest sees no projects', async () => {
    const ability = abilities.forRole('guest');
    const projects = await service.findAll(ability);
    
    expect(projects).toHaveLength(0);
  });
});
```

## Best Practices

### 1. Test Abilities Independently

Abilities are pure logic—test them separately from middleware and routes:

```typescript
// Test abilities in isolation
const ability = abilities.forRole('member', { id: 'user-1', tenantId: 'org-1' });
expect(ability.can('read', subject('Project', { organizationId: 'org-1' }))).toBe(true);
```

### 2. Use Factories for Test Data

Create helper functions for common test scenarios:

```typescript
function createMemberUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'member@example.com',
    role: 'member',
    tenantId: 'org-1',
    ...overrides,
  };
}

function createAdminUser(overrides = {}) {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
    ...overrides,
  };
}
```

### 3. Test Edge Cases

Cover boundary conditions:

```typescript
it('handles expired sessions', async () => {
  mockProvider.addSession('expired-token', createMemberUser(), {
    expiresAt: new Date(Date.now() - 1000), // Already expired
  });
  
  // Your expiry handling logic
});

it('handles missing tenantId', async () => {
  const ability = abilities.forRole('member', { id: 'user-1' }); // No tenantId
  expect(ability.can('read', 'Project')).toBe(false);
});
```

### 4. Use Separate Test Database

For integration tests with Prisma, use a separate database:

```bash
DATABASE_URL=postgresql://localhost/myapp_test pnpm test
```

## Next Steps

- [Abilities](./abilities) - Define and test CASL abilities
- [Middleware](./middleware) - Middleware configuration options
