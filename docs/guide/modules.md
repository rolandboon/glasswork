# Modules

Modules are the fundamental building blocks in Glasswork. A module groups related functionality - services, routes, and dependencies - into a cohesive unit.

If you're familiar with NestJS, Glasswork modules serve the same purpose but use plain TypeScript functions instead of decorators.

::: tip Under the Hood
Glasswork uses [Awilix](https://github.com/jeffijoe/awilix) as its dependency injection container. When you define modules, Glasswork registers providers with Awilix. You have full access to the Awilix container after bootstrapping. See the [Dependency Injection guide](/guide/dependency-injection) for details.
:::

## Module Basics

Each module is defined using the `defineModule()` function:

```typescript
import { defineModule } from 'glasswork';
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
| `routes` | `RouteFactory` (optional) | Function that defines HTTP routes |
| `imports` | `ModuleConfig[]` (optional) | Other modules this module depends on |
| `exports` | `Provider[]` (optional) | Providers to make available to importing modules |

## Feature Modules

Feature modules organize code around specific application features. Each feature module encapsulates related functionality:

```typescript
// src/auth/auth.module.ts
import { defineModule } from 'glasswork';
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

The constructor pattern (object destructuring) is required for Awilix PROXY mode, which ensures dependency injection works correctly with bundler minification. See the [Dependency Injection guide](/guide/dependency-injection) for more details.

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
import { defineModule } from 'glasswork';
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
import { bootstrap } from 'glasswork';
import { AppModule } from './app.module';

const { app } = bootstrap(AppModule);
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
