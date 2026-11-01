---
description: How to define and compose modules in Glasswork to group services, routes, and dependencies into cohesive units.
---

# Modules

Modules are the fundamental building blocks in Glasswork. A module groups related functionality - services, routes, and dependencies - into a cohesive unit.

After reading this guide, you will know:

- How to define and organize modules
- How to share providers between modules with imports and exports
- How to implement lifecycle hooks for initialization and cleanup
- How modules compare to NestJS patterns

If you're familiar with NestJS, Glasswork modules serve the same purpose but use plain TypeScript functions instead of decorators.

::: tip Under the Hood
Glasswork uses [Awilix](https://github.com/jeffijoe/awilix) as its dependency injection container. When you define modules, Glasswork registers providers with Awilix. After bootstrapping, the returned container exposes the root module’s local providers and imported exports. See the [Dependency Injection guide](/application-structure/dependency-injection) for details.
:::

## Module Basics

Each module is defined using the `defineModule()` function:

```typescript
import { defineModule } from 'glasswork/core';
import { UserService } from './user.service';
import { userRoutes } from './user.routes';

export const UserModule = defineModule({
  name: 'user',
  basePath: 'users',
  providers: [UserService],
  routes: userRoutes,
});
```

### Module Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Unique identifier for the module |
| `basePath` | `string` (optional) | Base path for routes (e.g., `'users'` → `/api/users`) |
| `providers` | `Provider[]` | Services and dependencies to register |
| `routes` | `RouteFactory | RouteFactory[]` (optional) | Function(s) that define HTTP routes |
| `imports` | `(ModuleConfig | ForwardReference)[]` (optional) | Other modules this module depends on |
| `exports` | `Provider[]` (optional) | Providers to make available to importing modules |

### Multiple Route Files

Modules can register multiple route files by passing an array:

```typescript
// src/users/user.module.ts
import { defineModule } from 'glasswork/core';
import { userRoutes } from './user.routes';
import { userAdminRoutes } from './user-admin.routes';

export const UserModule = defineModule({
  name: 'user',
  providers: [UserService],
  routes: [userRoutes, userAdminRoutes], // Multiple route files
});
```

## Feature Modules

Feature modules organize code around specific application features. Each feature module encapsulates related functionality:

```typescript
// src/auth/auth.module.ts
import { defineModule } from 'glasswork/core';
import { AuthService } from './auth.service';
import { HashService } from './hash.service';
import { authRoutes } from './auth.routes';

export const AuthModule = defineModule({
  name: 'auth',
  basePath: 'auth',
  providers: [
    AuthService,
    HashService,
  ],
  routes: authRoutes,
  exports: [AuthService], // Export for use by other modules
});
```

## Shared Modules

When a module exports providers, those providers become available to any module that imports it:

```typescript
// src/database/database.module.ts
export const DatabaseModule = defineModule({
  name: 'database',
  providers: [PrismaService],
  exports: [PrismaService], // Available to importing modules
});

// src/users/user.module.ts
export const UserModule = defineModule({
  name: 'user',
  imports: [DatabaseModule], // Can now use PrismaService
  providers: [UserService],
});
```

**Important**: Only exported providers are accessible to importing modules. Non-exported providers remain private to the module.

## Module Re-exporting

Modules can re-export modules they import, creating a cleaner import structure:

```typescript
// src/common/common.module.ts
export const CommonModule = defineModule({
  name: 'common',
  imports: [DatabaseModule, LoggerModule, CacheModule],
  exports: [DatabaseModule, LoggerModule, CacheModule],
});

// Other modules can now import CommonModule instead of each individually
export const UserModule = defineModule({
  name: 'user',
  imports: [CommonModule], // Gets database, logger, and cache
  providers: [UserService],
});
```

## Dependency Injection

Providers registered in a module are automatically available for dependency injection using Awilix's PROXY mode:

```typescript
// Module definition
export const UserModule = defineModule({
  name: 'user',
  imports: [DatabaseModule],
  providers: [UserService, EmailService],
});

// UserService can inject EmailService and PrismaService
export class UserService {
  constructor({
    emailService,
    prismaService, // From DatabaseModule
  }: {
    emailService: EmailService;
    prismaService: PrismaService;
  }) {
    this.emailService = emailService;
    this.prismaService = prismaService;
  }
}
```

The constructor pattern (object destructuring) is required for Awilix PROXY mode, which ensures dependency injection works correctly with bundler minification. See the [Dependency Injection guide](/application-structure/dependency-injection) for more details.

## Global Modules

There is no concept of "global modules" in Glasswork. All dependencies must be explicitly imported. This improves code clarity and makes dependencies explicit.

If you need a module everywhere, import it in your root AppModule and re-export it:

```typescript
export const AppModule = defineModule({
  name: 'app',
  imports: [ConfigModule, LoggerModule, ...featureModules],
  exports: [ConfigModule, LoggerModule],
});
```

## Lifecycle Hooks

Services can implement lifecycle hooks to run initialization or cleanup logic. This is useful for establishing database connections, subscribing to events, or performing cleanup when the application shuts down.

### OnModuleInit

The `OnModuleInit` interface allows services to run initialization logic after all providers are registered but before the application starts accepting requests.

```typescript
import { type OnModuleInit, createLogger } from 'glasswork/core';

const logger = createLogger('database');

export class DatabaseService implements OnModuleInit {
  private connection: Connection | null = null;

  async onModuleInit() {
    // Establish database connection
    this.connection = await createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT),
    });
    logger.info('Database connected');
  }

  getConnection() {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }
    return this.connection;
  }
}
```

### OnModuleDestroy

The `OnModuleDestroy` interface allows services to run cleanup logic when the application is shutting down.

```typescript
import { type OnModuleDestroy, createLogger } from 'glasswork/core';

const logger = createLogger('database');

export class DatabaseService implements OnModuleDestroy {
  private connection: Connection | null = null;

  async onModuleDestroy() {
    // Close database connection
    if (this.connection) {
      await this.connection.close();
      logger.info('Database connection closed');
    }
  }
}
```

### Combined Example

Services can implement both hooks:

```typescript
import { type OnModuleInit, type OnModuleDestroy, createLogger } from 'glasswork/core';

const logger = createLogger('cache');

export class CacheService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClient | null = null;

  async onModuleInit() {
    this.client = await createRedisClient({
      url: process.env.REDIS_URL,
    });
    logger.info('Redis connected');
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      logger.info('Redis disconnected');
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) throw new Error('Cache not initialized');
    return this.client.get(key);
  }
}
```

### Manual Control

The `bootstrap` function is async and automatically runs `onModuleInit` hooks in production and development environments. In test environments, you need to manually call `start()`:

```typescript
const { app, container, start, stop } = await bootstrap(AppModule, {
  environment: 'test',
});

// Manually start (runs onModuleInit)
await start();

// Run your tests...

// Manually stop (runs onModuleDestroy)
await stop();
```

In production/development, hooks run automatically:

```typescript
// Hooks run automatically before this returns
const { app, container } = await bootstrap(AppModule);

// App is fully initialized and ready to accept requests
export default app;
```

`start()` and `stop()` each run their hooks once:

- Concurrent `start()` calls resolve together, after every `onModuleInit` hook has finished.
- After a failed start, every `start()` call rejects with the original error. Hooks are not retried.
- Concurrent `stop()` calls share the same completion. `stop()` waits for a pending start to settle, so it also cleans up after a failed start.
- `start()` rejects once `stop()` has been called. Bootstrap a new application to start again.

### Execution Order

- **Parallel Execution**: All hooks execute in parallel across all services
- **Async Support**: Hooks can be synchronous or asynchronous
- **Error Handling**: If any hook throws an error, the application will fail to start/stop

## Dynamic Modules

Unlike NestJS, Glasswork doesn't have a "dynamic module" pattern. Instead, use factory providers for runtime configuration:

```typescript
// src/config/config.module.ts
export const ConfigModule = defineModule({
  name: 'config',
  providers: [
    {
      provide: 'config',
      useFactory: () => {
        return createConfig({
          schema: ConfigSchema,
          providers: [dotenv(), env()],
        });
      },
    },
  ],
  exports: ['config'],
});
```

## Root Module

Every Glasswork application has a root module that imports all feature modules:

```typescript
// src/app.module.ts
import { defineModule } from 'glasswork/core';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './users/user.module';
import { PostModule } from './posts/post.module';

export const AppModule = defineModule({
  name: 'app',
  imports: [
    AuthModule,
    UserModule,
    PostModule,
  ],
});
```

The root module is then passed to `bootstrap()`:

```typescript
import { bootstrap } from 'glasswork/core';
import { AppModule } from './app.module';

const { app } = await bootstrap(AppModule);
```

## Module Structure

A typical module directory structure:

```
src/
├── users/
│   ├── dto/
│   │   ├── create-user.dto.ts
│   │   └── user-response.dto.ts
│   ├── user.service.ts
│   ├── user.routes.ts
│   └── user.module.ts
├── auth/
│   ├── dto/
│   ├── auth.service.ts
│   ├── auth.routes.ts
│   └── auth.module.ts
└── app.module.ts
```

## Comparison with NestJS

| Feature | NestJS | Glasswork |
|---------|--------|-----------|
| **Definition** | `@Module()` decorator | `defineModule()` function |
| **Syntax** | Decorators + classes | Plain TypeScript |
| **Providers** | Array of classes | Array of classes or configs |
| **Imports** | Module classes | Module objects |
| **Exports** | Re-export imports or providers | Re-export imports or providers |
| **Global modules** | `@Global()` decorator | Explicit imports (no globals) |
| **Dynamic modules** | `forRoot()`, `forFeature()` | Factory providers |

## Module boundaries and migration

Providers are private by default. Providers, route factories, and worker jobs can access only their own module’s providers and the exports of modules they import. Importing two feature modules into the application root does not let those features inject each other’s providers.

An exported provider is always constructed in its declaring module. Its private dependencies remain available to it, and its singleton instance is shared by all importers. Scoped providers share an instance within one request or job attempt, including when reached through an imported service.

Module re-exports pass through the imported module’s public exports, never its private providers. Re-export the module object, as in `exports: [DatabaseModule]`; exporting an imported provider token directly is not supported. Global modules are not supported.

Module names must be unique across the application. Provider names must be unique within a module. Different modules may use the same private provider name. A local provider takes precedence over an imported name; conflicting exports from two imports fail at bootstrap instead of silently overwriting each other. Re-importing the same provider through multiple paths is allowed.

**Breaking change:** previous releases registered every provider globally, regardless of `imports` or `exports`. When migrating:

1. Add the declaring module to each consumer’s `imports` and add the shared provider to its owner’s `exports`.
2. Move cross-cutting dependencies into explicit shared modules. Providers in the application root are not automatically visible to feature modules.
3. Update direct `container.resolve()` and `container.register()` calls: the returned container has the root module’s visibility, including imported exports. It cannot resolve private feature providers, and `register()` cannot replace an imported provider; use `providerOverrides` for that.
4. Check worker modules as well as HTTP modules. Jobs resolve dependencies in the module that declares the job. The job context logger uses a `logger` provider visible in that module, otherwise the root module’s `logger`.
5. `providerOverrides` replace every existing declaration of the matching token, without changing visibility. Unknown override tokens are rejected.

Application lifecycle hooks run once per provider registration, including private singleton and value providers. Request-scoped and transient providers are not instantiated for application lifecycle hooks; their Awilix scopes are disposed after each request or job attempt.

## Circular module imports

Ordinary circular imports fail at bootstrap. Use `forwardRef` to defer a deliberate circular import until the full module graph is defined:

```typescript
import { defineModule, forwardRef, type ModuleConfig } from 'glasswork/core';

const UsersModule: ModuleConfig = defineModule({
  name: 'users',
  imports: [forwardRef(() => PostsModule)],
  providers: [UserService],
  exports: [UserService],
});

const PostsModule: ModuleConfig = defineModule({
  name: 'posts',
  imports: [forwardRef(() => UsersModule)],
  providers: [PostService],
  exports: [PostService],
});
```

At least one edge in each cycle must be deferred. Use deferred references on both sides when modules live in separate files to avoid reading an uninitialized JavaScript binding. The callbacks must return the same module object each time.

This only resolves the module graph. A constructor that eagerly requests a provider which eagerly requests it back still fails. Use the [lazy provider pattern](/application-structure/dependency-injection#circular-dependencies) or extract the shared responsibility into a third service.

## Best Practices

### 1. One Module Per Feature

Keep modules focused on a single feature or domain:

```typescript
// ✅ Good - focused on user management
export const UserModule = defineModule({
  name: 'user',
  providers: [UserService, UserValidator],
  routes: userRoutes,
});

// ❌ Bad - too many unrelated features
export const MiscModule = defineModule({
  name: 'misc',
  providers: [UserService, EmailService, FileService, CacheService],
});
```

### 2. Export Only What's Necessary

Keep module internals private:

```typescript
export const UserModule = defineModule({
  name: 'user',
  providers: [
    UserService,
    UserRepository,    // Private - internal implementation
    UserValidator,     // Private - internal validation
  ],
  exports: [UserService], // Only export the public API
});
```

### 3. Keep the Dependency Graph Shallow

Avoid deep import chains. If many modules need the same dependencies, create a shared module:

```typescript
// Instead of: A → B → C → DatabaseModule
// Do this:
export const CommonModule = defineModule({
  name: 'common',
  imports: [DatabaseModule, LoggerModule],
  exports: [DatabaseModule, LoggerModule],
});

// Now all modules import CommonModule
```

### 4. Use Meaningful Names

Module names should clearly describe their purpose:

```typescript
// ✅ Good
export const UserModule = defineModule({ name: 'user', ... });
export const AuthModule = defineModule({ name: 'auth', ... });
export const PaymentModule = defineModule({ name: 'payment', ... });

// ❌ Bad
export const Module1 = defineModule({ name: 'module1', ... });
export const UtilsModule = defineModule({ name: 'utils', ... });
```

## Next Steps

- [Dependency Injection](/application-structure/dependency-injection) - Deep dive into Awilix and provider patterns
- [Routes & Validation](/request-handling/routes) - How routes use injected services
- [Testing](/application-structure/testing) - How to test modules and services
- [Bootstrap Options](/configuration/bootstrap) - Configure your application at startup
