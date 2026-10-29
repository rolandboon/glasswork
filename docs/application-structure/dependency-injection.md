---
description: Dependency injection in Glasswork using Awilix, including registering providers, scoped containers, and accessing services.
---

# Dependency Injection

Dependency Injection (DI) is a design pattern where objects receive their dependencies from external sources rather than creating them internally. This makes code more modular, testable, and maintainable.

Glasswork uses [Awilix](https://github.com/jeffijoe/awilix) as its dependency injection container. You define providers in modules, and Glasswork registers them with Awilix.

## Why Dependency Injection?

```typescript
// ❌ Without DI: Hard to test, tightly coupled
export class UserService {
  private db = new PrismaClient(); // Hard-coded dependency

  async getUser(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }
}

// ✅ With DI: Easy to test, loosely coupled
export class UserService {
  constructor({
    prismaService,
  }: {
    prismaService: PrismaService;
  }) {
    this.prismaService = prismaService;
  }

  async getUser(id: string) {
    return this.prismaService.user.findUnique({ where: { id } });
  }
}
```

Benefits:
- **Testability**: Inject mock dependencies in tests
- **Modularity**: Services don't know how dependencies are created
- **Flexibility**: Swap implementations without changing code
- **Lifecycle control**: Manage when dependencies are created and destroyed

## Provider Types

Glasswork supports four types of providers, all corresponding to Awilix registration patterns:

### 1. Class Providers

The most common provider type. Glasswork automatically resolves constructor dependencies:

```typescript
export const UserModule = defineModule({
  name: 'user',
  providers: [UserService], // Shorthand for class provider
});
```

This is equivalent to:

```typescript
providers: [
  {
    provide: UserService,
    useClass: UserService,
    scope: 'SINGLETON', // Default scope
  },
]
```

### 2. Factory Providers

Use a factory function to create the dependency. Useful for runtime configuration:

```typescript
import { isDevelopment } from 'glasswork/core';

export const DatabaseModule = defineModule({
  name: 'database',
  providers: [
    {
      provide: 'prisma',
      useFactory: () => {
        return new PrismaClient({
          log: isDevelopment() ? ['query'] : [],
        });
      },
    },
  ],
});
```

Factory functions can also receive dependencies:

```typescript
{
  provide: 'emailService',
  useFactory: ({ config }) => {
    return new EmailService({
      apiKey: config.get('EMAIL_API_KEY'),
      from: config.get('EMAIL_FROM'),
    });
  },
}
```

### 3. Value Providers

Directly provide a value. Useful for configuration or constants:

```typescript
export const ConfigModule = defineModule({
  name: 'config',
  providers: [
    {
      provide: 'apiUrl',
      useValue: 'https://api.example.com',
    },
    {
      provide: 'config',
      useValue: {
        port: 3000,
        env: 'production',
      },
    },
  ],
});
```

### 4. Explicit Class Providers

Provide a class with a custom name:

```typescript
export const DatabaseModule = defineModule({
  name: 'database',
  providers: [
    {
      provide: 'database',
      useClass: PrismaService,
      scope: 'SINGLETON',
    },
  ],
});
```

## Service Scopes

Awilix supports three lifecycle scopes:

### SINGLETON (Default)

One instance shared across the entire application:

```typescript
providers: [
  {
    provide: PrismaService,
    useClass: PrismaService,
    scope: 'SINGLETON', // Created once, reused everywhere
  },
]
```

Use for:
- Database connections
- Configuration
- Stateless services

### SCOPED

One instance per request/scope:

```typescript
providers: [
  {
    provide: UserContext,
    useClass: UserContext,
    scope: 'SCOPED', // New instance per HTTP request
  },
]
```

Use for:
- Request-specific data
- User context
- Transaction managers

For HTTP routes, Glasswork creates an Awilix child scope before the route
handler runs and disposes it when the request finishes. A scoped service
destructured from the route factory's `services` argument is a lazy proxy: it
resolves to the current request's instance when a handler uses it. Do not read a
scoped service during route registration, because no request scope exists yet.
Transient services captured by route factories are also resolved inside each request;
repeated access through a captured service uses that request's instance.
Async factories must use `SINGLETON` scope. For request-specific initialization,
use a synchronous scoped factory and await initialization from the handler.

### TRANSIENT

New instance every time it's injected:

```typescript
providers: [
  {
    provide: EventEmitter,
    useClass: EventEmitter,
    scope: 'TRANSIENT', // New instance every injection
  },
]
```

Use for:
- Lightweight, stateful objects
- Objects that should never be shared

## Constructor Injection Pattern

Glasswork uses Awilix's **PROXY mode**, which requires object destructuring in constructors:

```typescript
export class UserService {
  private readonly prismaService: PrismaService;
  private readonly emailService: EmailService;

  constructor({
    prismaService,
    emailService,
  }: {
    prismaService: PrismaService;
    emailService: EmailService;
  }) {
    this.prismaService = prismaService;
    this.emailService = emailService;
  }
}
```

### Why PROXY Mode?

Awilix supports two injection modes:

**CLASSIC Mode** (cleaner syntax, but breaks with minification):
```typescript
constructor(
  private prismaService: PrismaService,
  private emailService: EmailService,
) {}
```

This breaks when bundlers minify parameter names: `prismaService` becomes `a`, `emailService` becomes `b`.

**PROXY Mode** (verbose, but works with minification):
```typescript
constructor({
  prismaService,
  emailService,
}: {
  prismaService: PrismaService;
  emailService: EmailService;
}) {
  this.prismaService = prismaService;
  this.emailService = emailService;
}
```

Property names in objects survive minification, so DI continues to work in production Lambda bundles.

::: tip Lambda Compatibility
Glasswork defaults to PROXY mode for Lambda compatibility. This is an Awilix feature, not a framework invention. All Awilix documentation applies.
:::

## Accessing the Container

After bootstrapping, the returned Awilix container view resolves the root module’s own providers and imported exports. `resolve`, `cradle`, `register`, `build`, and `createScope` use that module’s namespace:

```typescript
const { app, container } = bootstrap(AppModule);

// Resolve dependencies manually
const userService = container.resolve('userService');

// Create a scope for work outside HTTP routes, such as a CLI operation
const scope = container.createScope();
const scopedService = scope.resolve('userContext');
await scope.dispose();

// Register additional providers at runtime
container.register({
  dynamicService: asClass(DynamicService).singleton(),
});
```

`register` adds or replaces providers of the root module only. Registering a name that the root module imports throws, because it would replace the provider for every module that uses it; use `providerOverrides` to replace an imported provider. Names registered on a scope are visible only in that scope and its children.

This is useful for:
- Testing: Manually resolve services
- Background jobs: Create scopes for job execution
- Advanced scenarios: Direct Awilix API usage

## Provider Naming

Glasswork automatically converts class names to camelCase for registration:

```typescript
// Class name: AuthService
// Registered as: 'authService'

export class AuthService {
  constructor({ userService }: { userService: UserService }) {
    // Injected as 'userService'
  }
}
```

For custom names, use explicit providers:

```typescript
providers: [
  {
    provide: 'auth', // Custom name
    useClass: AuthService,
  },
]

// Inject as 'auth'
constructor({ auth }: { auth: AuthService }) {}
```

### Async dependency ordering

Async factories must use singleton scope. When a factory depends on another async factory, declare its dependencies with `inject`. Glasswork awaits those dependencies before invoking the factory, regardless of provider or module registration order:

```typescript
{
  provide: 'client',
  inject: ['config'],
  useFactory: async ({ config }) => connect(config.url),
}
```

`inject` remains a list of named cradle dependencies, not positional arguments. Every named dependency must be visible in the declaring module. Declare dependencies on intermediate synchronous factories as well if they lead to an async factory. Cycles in this initialization graph fail before the factories are invoked. Undeclared async dependencies still depend on registration order; native `async` functions are required for automatic async-factory initialization.

## Circular Dependencies

Awilix detects eager provider cycles when a provider is resolved, including during application startup. The error includes module-qualified provider names:

```typescript
// ❌ Circular: UserService → PostService → UserService
export class UserService {
  constructor({ postService }: { postService: PostService }) {}
}

export class PostService {
  constructor({ userService }: { userService: UserService }) {}
}
```

For a deliberate runtime cycle, keep the injected cradle and read the other service only after construction. This uses Awilix PROXY injection; it does not create a placeholder service or change instance identity:

```typescript
class UserService {
  constructor(private readonly dependencies: { postService: PostService }) {}

  listPosts(userId: string) {
    return this.dependencies.postService.listForUser(userId);
  }
}

class PostService {
  constructor(private readonly dependencies: { userService: UserService }) {}

  listForUser(userId: string) {
    // Use dependencies.userService here if needed, after construction.
    return [];
  }
}
```

Do not destructure the circular dependency in the constructor or call the other service there. Module boundaries still apply; mutually importing modules need `forwardRef` as described in the [module guide](/application-structure/modules#circular-module-imports). Keep cyclic services in compatible scopes, and never retain a request-scoped dependency in a singleton. Async initialization cycles cannot be solved by a lazy lookup that is invoked during initialization.

**Solution**: Introduce an abstraction or refactor to remove the cycle:

```typescript
// ✅ Break the cycle with an interface
export class UserService {
  constructor({ postRepository }: { postRepository: PostRepository }) {}
}

export class PostService {
  constructor({ userRepository }: { userRepository: UserRepository }) {}
}
```

## Testing with DI

DI makes testing straightforward - just provide mock dependencies:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { UserService } from './user.service';

describe('UserService', () => {
  it('should create a user', async () => {
    // Create mocks
    const mockPrisma = {
      user: {
        create: vi.fn().mockResolvedValue({ id: '1', email: 'test@example.com' }),
      },
    };

    const mockEmail = {
      send: vi.fn().mockResolvedValue(true),
    };

    // Inject mocks
    const userService = new UserService({
      prismaService: mockPrisma as any,
      emailService: mockEmail as any,
    });

    // Test
    const user = await userService.createUser('test@example.com');

    expect(user.email).toBe('test@example.com');
    expect(mockPrisma.user.create).toHaveBeenCalled();
    expect(mockEmail.send).toHaveBeenCalled();
  });
});
```

No framework mocking required - just plain dependency injection.

## Best Practices

### 1. Depend on Abstractions

Use interfaces or abstract classes for dependencies:

```typescript
// Define an interface
export interface IEmailService {
  send(to: string, subject: string, body: string): Promise<void>;
}

// Implement the interface
export class SesEmailService implements IEmailService {
  async send(to: string, subject: string, body: string) {
    // AWS SES implementation
  }
}

// Depend on the interface
export class UserService {
  constructor({
    emailService,
  }: {
    emailService: IEmailService; // Interface, not concrete class
  }) {
    this.emailService = emailService;
  }
}
```

### 2. Keep Constructors Simple

Constructors should only assign dependencies, not perform logic:

```typescript
// ✅ Good
constructor({ prismaService }: { prismaService: PrismaService }) {
  this.prismaService = prismaService;
}

// ❌ Bad
constructor({ prismaService }: { prismaService: PrismaService }) {
  this.prismaService = prismaService;
  this.init(); // Don't call methods in constructor
  this.loadData(); // Don't perform async operations
}
```

### 3. Use Appropriate Scopes

Choose the right scope for each provider:

- **SINGLETON**: Stateless services, database connections, config
- **SCOPED**: Request context, transaction managers
- **TRANSIENT**: Rarely needed, only for stateful lightweight objects

### 4. Avoid Service Locator Pattern

Don't inject the container itself:

```typescript
// ❌ Bad: Service locator anti-pattern
export class UserService {
  constructor({ container }: { container: AwilixContainer }) {
    this.container = container;
  }

  async getUser(id: string) {
    const db = this.container.resolve('prismaService'); // Hidden dependency
    return db.user.findUnique({ where: { id } });
  }
}

// ✅ Good: Explicit dependencies
export class UserService {
  constructor({
    prismaService,
  }: {
    prismaService: PrismaService;
  }) {
    this.prismaService = prismaService;
  }

  async getUser(id: string) {
    return this.prismaService.user.findUnique({ where: { id } });
  }
}
```

## Learn More

- [Awilix Documentation](https://github.com/jeffijoe/awilix) - Full Awilix API reference
- [Modules Guide](/application-structure/modules) - How modules organize providers
- [Architecture Philosophy](/architecture/philosophy) - Why DI enables clean architecture
