# Getting Started

This guide will walk you through creating your first Glasswork API from scratch.

:::: tip New to Glasswork?
Read [Architecture Philosophy](/architecture/philosophy) to understand why Glasswork separates services, routes, and modules the way it does.
::::

## Prerequisites

- **Node.js 20+** (ESM + top-level `await`)
- **pnpm** (recommended) or npm/yarn
- **TypeScript strict + ESM config**:

```json
// tsconfig.json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2024"],
    "esModuleInterop": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

If you use Prisma or other ESM-sensitive tooling, keep `"type": "module"` in `package.json`.

## Installation

:::: code-group

```bash [npm]
npm install glasswork hono awilix valibot hono-openapi
```

```bash [pnpm]
pnpm add glasswork hono awilix valibot hono-openapi
```

```bash [yarn]
yarn add glasswork hono awilix valibot hono-openapi
```

::::

## Your First API

### 1. Create Your DTOs

First, define your data transfer objects using Valibot schemas. These will automatically generate OpenAPI documentation:

```typescript
// src/auth/auth.dto.ts
import { object, string, minLength, email, pipe } from 'valibot';

export const LoginDto = object({
  email: pipe(string(), email()),
  password: pipe(string(), minLength(8)),
});

export const SessionDto = object({
  token: string(),
  expiresAt: string(),
});
```

### 2. Create a Service

Business logic lives in services, which have **zero framework coupling**:

```typescript
// src/auth/auth.service.ts
import { NotFoundException } from 'glasswork';
import type { PrismaService } from '../database/prisma.service';
import type { HashService } from './hash.service';

export class AuthService {
  private readonly prismaService: PrismaService;
  private readonly hashService: HashService;

  constructor({
    prismaService,
    hashService,
  }: {
    prismaService: PrismaService;
    hashService: HashService;
  }) {
    this.prismaService = prismaService;
    this.hashService = hashService;
  }

  async login(email: string, password: string) {
    const user = await this.prismaService.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new NotFoundException('Invalid credentials');
    }

    await this.hashService.verify(password, user.password);

    // Generate token (implementation depends on your auth strategy)
    const token = crypto.randomUUID(); // Or use JWT, etc.

    return {
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}
```

### 3. Define Routes

Routes are thin adapters between HTTP and your services:

```typescript
// src/auth/auth.routes.ts
import { createRoutes } from 'glasswork';
import { LoginDto, SessionDto } from './auth.dto';
import type { AuthService } from './auth.service';

export const authRoutes = createRoutes<{ authService: AuthService }>(
  (router, { authService }, route) => {
    router.post('/login', ...route({
      tags: ['Authentication'],
      summary: 'User login with email and password',
      public: true, // No authentication required
      body: LoginDto,
      responses: { 200: SessionDto },
      handler: ({ body }) => {
        // body is typed from LoginDto
        return authService.login(body.email, body.password);
      },
    }));
  }
);
```

### 4. Create a Module

Modules group related providers and routes:

```typescript
// src/auth/auth.module.ts
import { defineModule } from 'glasswork';
import { AuthService } from './auth.service';
import { authRoutes } from './auth.routes';

export const AuthModule = defineModule({
  name: 'auth',
  basePath: 'auth', // Routes mounted at /api/auth
  providers: [AuthService],
  routes: authRoutes,
});
```

### 5. Create an App Module

Create a root module that imports your feature modules:

```typescript
// src/app.module.ts
import { defineModule } from 'glasswork';
import { AuthModule } from './auth/auth.module';

export const AppModule = defineModule({
  name: 'app',
  imports: [AuthModule],
});
```

### 6. Bootstrap Your App

Create a server file that handles both Lambda and local development:

```typescript
// src/server.ts
import { serve } from '@hono/node-server';
import { bootstrap, isLambda } from 'glasswork';
import { handle } from 'hono/aws-lambda';
import { AppModule } from './app.module';

const { app } = await bootstrap(AppModule, {
  openapi: {
    enabled: true,
    documentation: {
      info: {
        title: 'My API',
        version: '1.0.0',
      },
    },
  },
});

// Export for Lambda
export const handler = handle(app);

// Start local server if not in Lambda
if (!isLambda()) {
  const port = Number(process.env.PORT) || 3000;
  console.log(`Server is running on http://localhost:${port}`);

  serve({
    fetch: app.fetch,
    port,
  });
}
```

### 7. Run Locally

Install the development server:

:::: code-group

```bash [npm]
npm install -D @hono/node-server tsx
```

```bash [pnpm]
pnpm add -D @hono/node-server tsx
```

```bash [yarn]
yarn add -D @hono/node-server tsx
```

::::

Run your server:

```bash
tsx src/server.ts
```

Visit:

- **API**: <http://localhost:3000/api/auth/login>
- **Swagger UI**: <http://localhost:3000/api>
- **OpenAPI Spec**: <http://localhost:3000/api/openapi.json>

## Growing Your App

As your application grows, add more feature modules:

```typescript
// src/app.module.ts
import { defineModule } from 'glasswork';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PostsModule } from './posts/posts.module';

export const AppModule = defineModule({
  name: 'app',
  imports: [AuthModule, UsersModule, PostsModule],
});
```

Each module can have its own providers, routes, and even import other modules.

## Next steps

- Build your first feature module: [Modules](/application-structure/modules)
- Add validation and OpenAPI: [Routes & Validation](/request-handling/routes) and [OpenAPI](/request-handling/openapi)
- Harden for production: [Production Checklist](/deployment/production-readiness)
