# Testing

Testing in Glasswork is straightforward because of its clean architecture. Services have no framework dependencies, making them easy to test with simple mocks.

## Testing Philosophy

Glasswork follows these testing principles:

1. **Services are framework-agnostic** - No framework mocking required
2. **Routes are thin adapters** - Test separately with minimal configuration
3. **Unit tests are fast** - No database or HTTP server needed
4. **Integration tests verify wiring** - Ensure modules connect correctly

## Unit Testing Services

Services have zero framework coupling, so testing is simple:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { UserService } from './user.service';

describe('UserService', () => {
  it('should create a user', async () => {
    // Create mocks for dependencies
    const mockPrisma = {
      user: {
        create: vi.fn().mockResolvedValue({
          id: '1',
          email: 'test@example.com',
          name: 'Test User',
        }),
      },
    };

    const mockEmail = {
      sendWelcome: vi.fn().mockResolvedValue(true),
    };

    // Instantiate service with mocks
    const userService = new UserService({
      prismaService: mockPrisma as any,
      emailService: mockEmail as any,
    });

    // Execute and assert
    const user = await userService.create({
      email: 'test@example.com',
      name: 'Test User',
      password: 'password123',
    });

    expect(user.email).toBe('test@example.com');
    expect(mockPrisma.user.create).toHaveBeenCalledOnce();
    expect(mockEmail.sendWelcome).toHaveBeenCalledWith('test@example.com');
  });

  it('should throw when email already exists', async () => {
    const mockPrisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: '1' }),
      },
    };

    const userService = new UserService({
      prismaService: mockPrisma as any,
      emailService: {} as any,
    });

    await expect(
      userService.create({
        email: 'existing@example.com',
        name: 'Test',
        password: 'password',
      })
    ).rejects.toThrow('Email already exists');
  });
});
```

**No framework mocking needed** - just plain dependency injection with mock objects.

## Testing Routes

Routes are HTTP adapters that call services. Since routes are thin and primarily handle validation/serialization, the recommended approach is to test them via integration tests using the full bootstrap.

### Route Integration Tests

Test routes using `bootstrap` with mock providers:

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { bootstrap, defineModule } from 'glasswork';
import { object, string, pipe, email, minLength } from 'valibot';
import { createRoutes } from 'glasswork';

// Define test DTOs
const CreateUserDto = object({
  email: pipe(string(), email()),
  name: string(),
  password: pipe(string(), minLength(8)),
});

const UserResponseDto = object({
  id: string(),
  email: string(),
  name: string(),
});

describe('User Routes', () => {
  let app: ReturnType<typeof bootstrap>['app'];
  let mockUserService: { create: ReturnType<typeof vi.fn> };

  beforeAll(() => {
    // Create mock service
    mockUserService = {
      create: vi.fn(),
    };

    // Define routes inline for testing
    const userRoutes = createRoutes<{ userService: typeof mockUserService }>(
      (router, { userService }, route) => {
        router.post('/', ...route({
          summary: 'Create user',
          body: CreateUserDto,
          responses: { 201: UserResponseDto },
          handler: async ({ body }) => {
            return userService.create(body);
          },
        }));
      }
    );

    // Define test module with mock provider
    const TestModule = defineModule({
      name: 'test',
      basePath: 'users',
      providers: [
        { provide: 'userService', useValue: mockUserService },
      ],
      routes: userRoutes,
    });

    // Bootstrap with test module
    const result = bootstrap(TestModule, {
      logger: { enabled: false },
    });
    app = result.app;
  });

  it('should validate email format', async () => {
    const res = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid-email',
        name: 'Test',
        password: 'password123',
      }),
    });

    expect(res.status).toBe(422); // Validation error
    expect(mockUserService.create).not.toHaveBeenCalled();
  });

  it('should call service with valid data', async () => {
    mockUserService.create.mockResolvedValue({
      id: '1',
      email: 'test@example.com',
      name: 'Test',
    });

    const res = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test',
        password: 'password123',
      }),
    });

    expect(res.status).toBe(201);
    expect(mockUserService.create).toHaveBeenCalledWith({
      email: 'test@example.com',
      name: 'Test',
      password: 'password123',
    });
  });
});
```

::: tip Focus on Service Tests
Since routes are thin adapters, most of your testing should focus on services (which are framework-agnostic and easy to test). Route tests are primarily useful for verifying:

- Validation rules work correctly
- Response serialization strips sensitive fields
- Middleware is applied correctly
:::

## Integration Testing

Test the full application with real dependencies:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootstrap } from 'glasswork';
import { AppModule } from './app.module';
import { PrismaClient } from '@prisma/client';

describe('App Integration', () => {
  let app: Hono;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Use test database
    prisma = new PrismaClient({
      datasources: {
        db: { url: process.env.TEST_DATABASE_URL },
      },
    });

    // Bootstrap app with test config
    const result = bootstrap(AppModule, {
      environment: 'test',
      logger: { enabled: false },
    });

    app = result.app;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should complete full user flow', async () => {
    // Register user
    const registerRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'integration@example.com',
        password: 'password123',
        name: 'Integration Test',
      }),
    });

    expect(registerRes.status).toBe(201);
    const user = await registerRes.json();
    expect(user.email).toBe('integration@example.com');

    // Login
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'integration@example.com',
        password: 'password123',
      }),
    });

    expect(loginRes.status).toBe(200);
    const session = await loginRes.json();
    expect(session.token).toBeDefined();

    // Access protected route
    const profileRes = await app.request('/api/users/profile', {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    });

    expect(profileRes.status).toBe(200);
  });
});
```

## Testing with Prisma

### In-Memory Database

Use SQLite for fast tests:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'file:./test.db',
    },
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

```typescript
// src/test/setup.ts
import { PrismaClient } from '@prisma/client';
import { beforeEach } from 'vitest';

const prisma = new PrismaClient();

beforeEach(async () => {
  // Clean database between tests
  await prisma.$executeRaw`DELETE FROM User`;
  await prisma.$executeRaw`DELETE FROM Post`;
});
```

### Test Containers

Use Docker for PostgreSQL tests:

```typescript
import { GenericContainer, StartedTestContainer } from 'testcontainers';

let container: StartedTestContainer;
let prisma: PrismaClient;

beforeAll(async () => {
  // Start PostgreSQL container
  container = await new GenericContainer('postgres:15')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'test',
    })
    .withExposedPorts(5432)
    .start();

  const port = container.getMappedPort(5432);
  const databaseUrl = `postgresql://test:test@localhost:${port}/test`;

  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await prisma.$executeRaw`...`; // Run migrations
}, 30000); // Increase timeout for container startup

afterAll(async () => {
  await prisma.$disconnect();
  await container.stop();
});
```

### Transactional Testing (Recommended)

An alternative to mocking is using real database transactions that rollback after each test. This approach:

- ✅ Tests against a real database (more realistic)
- ✅ Reduces mocking complexity
- ✅ Catches database-specific issues (constraints, indexes)
- ⚠️ Sequential tests only (parallel tests may hit transaction locks)

**Required package:**
```bash
npm install -D @chax-at/transactional-prisma-testing
```

**Setup** (`src/test/setup.ts`):

```typescript
import { PrismaTestingHelper } from '@chax-at/transactional-prisma-testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

let prismaTestingHelper: PrismaTestingHelper<PrismaClient>;

beforeAll(async () => {
  const prismaClient = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  prismaTestingHelper = new PrismaTestingHelper(prismaClient);
});

beforeEach(async () => {
  await prismaTestingHelper.startNewTransaction();
});

afterEach(async () => {
  await prismaTestingHelper.rollbackCurrentTransaction();
});

afterAll(async () => {
  await prismaTestingHelper.getProxyClient().$disconnect();
});

export function getTestDb(): PrismaClient {
  return prismaTestingHelper.getProxyClient();
}
```

**Usage in Tests:**

```typescript
import { describe, it, expect } from 'vitest';
import { getTestDb } from '@test/setup';
import { UserService } from './user.service';

describe('UserService', () => {
  it('should create a user', async () => {
    const db = getTestDb();

    const userService = new UserService({
      prismaService: db,
      emailService: mockEmail as any,
    });

    // Test with real database
    const user = await userService.create({
      email: 'new@example.com',
      name: 'New User',
      password: 'password123',
    });

    expect(user.email).toBe('new@example.com');

    // Verify in database
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
    });
    expect(dbUser).toBeDefined();

    // Transaction will rollback - data won't persist
  });

  it('should reject duplicate email', async () => {
    const db = getTestDb();

    // Create existing user
    await db.user.create({
      data: {
        email: 'duplicate@example.com',
        name: 'Existing',
        password: 'hashed',
      },
    });

    const userService = new UserService({ prismaService: db });

    await expect(
      userService.create({
        email: 'duplicate@example.com',
        name: 'User',
        password: 'password',
      })
    ).rejects.toThrow();
  });
});
```

**Trade-offs:**

| Aspect | Mocking | Transactional Testing |
|--------|---------|----------------------|
| Speed | Very fast | Fast (with local DB) |
| Realism | Low | High |
| Complexity | Mock setup | Test DB setup |
| Parallelization | Full | Limited (locks) |
| Database Issues | Won't catch | Catches constraints, indexes |

::: tip Recommended Approach
Use transactional testing for integration and service tests that interact with the database. Reserve mocking for pure unit tests of business logic.
:::

### Test Data Factories

Factories simplify test data creation. [prisma-fabbrica](https://github.com/Quramy/prisma-fabbrica) generates type-safe factories from your Prisma schema.

**Installation:**

```bash
npm install -D prisma-fabbrica
```

**Add generator to schema** (`prisma/schema.prisma`):

```prisma
generator client {
  provider = "prisma-client-js"
}

generator fabbrica {
  provider = "prisma-fabbrica"
  output   = "../test/factories/__generated__"
}

model User {
  id       String @id @default(cuid())
  email    String @unique
  name     String
  password String
  posts    Post[]
}

model Post {
  id      String @id @default(cuid())
  title   String
  content String
  userId  String
  user    User   @relation(fields: [userId], references: [id])
}
```

**Generate factories:**

```bash
npx prisma generate
```

This will generate factory files in `test/factories/__generated__/`.

**Define custom factory** (`test/factories/user.factory.ts`):

```typescript
import { defineUserFactory } from './__generated__/fabbrica';

export const UserFactory = defineUserFactory({
  defaultData: {
    email: async () => `test-${Date.now()}@example.com`,
    name: 'Test User',
    password: 'hashed-password',
  },
});
```

**Usage:**

```typescript
import { UserFactory } from '@test/factories';

describe('UserService', () => {
  it('should update user', async () => {
    // Create test user with factory
    const user = await UserFactory.create({
      email: 'specific@example.com',
    });

    const userService = new UserService({ prismaService: db });

    const updated = await userService.update(user.id, {
      name: 'Updated Name',
    });

    expect(updated.name).toBe('Updated Name');
  });

  it('should handle related data', async () => {
    // Create user with related posts
    const user = await UserFactory.create({
      posts: {
        create: [
          { title: 'Post 1', content: 'Content' },
          { title: 'Post 2', content: 'Content' },
        ],
      },
    });

    expect(user.posts).toHaveLength(2);
  });
});
```

**Combine with transactional testing:**

```typescript
// src/test/setup.ts
import { initialize, UserFactory, TripFactory } from '@test/factories';

beforeAll(async () => {
  const prismaClient = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  prismaTestingHelper = new PrismaTestingHelper(prismaClient);

  // Initialize Fabbrica with transactional client
  initialize({ prisma: () => prismaTestingHelper.getProxyClient() });
});

// Access both in tests
export function getTestUtils() {
  return {
    db: prismaTestingHelper.getProxyClient(),
    factories: { user: UserFactory, trip: TripFactory },
  };
}
```

## Mocking Dependencies

### Service Mocks

Create reusable mock factories:

```typescript
// test/mocks/user.service.mock.ts
export function createMockUserService(): UserService {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

// Use in tests
const mockUserService = createMockUserService();
mockUserService.create.mockResolvedValue({ id: '1', ... });
```

### Prisma Mocks

Mock Prisma client for unit tests:

```typescript
export function createMockPrisma() {
  return {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    post: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(this)),
    $disconnect: vi.fn(),
  };
}
```

## Testing Error Handling

```typescript
import { NotFoundException, ValidationException } from 'glasswork';

describe('Error Handling', () => {
  it('should throw NotFoundException', async () => {
    const mockPrisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const userService = new UserService({
      prismaService: mockPrisma as any,
    });

    await expect(
      userService.findById('non-existent')
    ).rejects.toThrow(NotFoundException);
  });

  it('should handle validation errors in routes', async () => {
    // Using the bootstrapped app from route integration tests (see above)
    const res = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid',
        // Missing required fields
      }),
    });

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });
});
```

## Testing Configuration

Use environment-specific configs for tests:

```typescript
import { createConfig, objectProvider, envProvider } from 'glasswork';

// Test config
const testConfig = await createConfig({
  schema: ConfigSchema,
  providers: [
    objectProvider({
      nodeEnv: 'test',
      databaseUrl: 'file:./test.db',
      apiKey: 'test-key',
    }),
    envProvider(), // Allow overrides from env
  ],
});
```

## Test Organization

Organize tests by type:

```text
src/
├── users/
│   ├── user.service.ts
│   ├── user.service.spec.ts    # Unit tests
│   ├── user.routes.ts
│   └── user.routes.spec.ts     # Route tests
├── test/
│   ├── setup.ts                # Global test setup
│   ├── mocks/                  # Shared mocks
│   │   ├── prisma.mock.ts
│   │   └── services.mock.ts
│   └── integration/            # Integration tests
│       └── user-flow.spec.ts
└── vitest.config.ts
```

## Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.spec.ts',
        '**/*.test.ts',
      ],
    },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./test.db',
    },
  },
});
```

## Best Practices

### 1. Test Behavior, Not Implementation

```typescript
// ✅ Good - tests behavior
it('should create user and send welcome email', async () => {
  const user = await userService.create(createUserDto);
  expect(user.email).toBe(createUserDto.email);
  expect(mockEmail.sendWelcome).toHaveBeenCalledWith(user.email);
});

// ❌ Bad - tests implementation details
it('should call prisma.user.create', async () => {
  await userService.create(createUserDto);
  expect(mockPrisma.user.create).toHaveBeenCalled();
});
```

### 2. Use Test Factories

```typescript
// test/factories/user.factory.ts
export function createUserData(overrides = {}) {
  return {
    email: 'test@example.com',
    name: 'Test User',
    password: 'password123',
    ...overrides,
  };
}

// Use in tests
const userData = createUserData({ email: 'custom@example.com' });
```

### 3. Test Edge Cases

```typescript
describe('UserService.create', () => {
  it('should handle duplicate email', async () => {
    // ...
  });

  it('should handle invalid email format', async () => {
    // ...
  });

  it('should handle database errors', async () => {
    // ...
  });

  it('should rollback on email send failure', async () => {
    // ...
  });
});
```

### 4. Keep Tests Fast

- Use in-memory databases for unit tests
- Mock external services (email, S3, etc.)
- Run integration tests in CI only
- Use `describe.concurrent` for parallel tests

## Continuous Integration

Example GitHub Actions workflow:

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - name: Run tests
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/test
        run: npm test

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Learn More

- [Vitest Documentation](https://vitest.dev/) - Testing framework
- [Transactional Prisma Testing](https://github.com/chax-at/transactional-prisma-testing) - Transaction-based test isolation
- [Prisma Fabbrica](https://github.com/Quramy/prisma-fabbrica) - Type-safe factories for Prisma
- [Hono Testing](https://hono.dev/docs/guides/testing) - Testing Hono applications
