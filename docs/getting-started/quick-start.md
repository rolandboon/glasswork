---
description: Step-by-step guide to creating your first Glasswork API, including project setup, modules, routes, services, and running locally.
---

# Getting Started

This guide will walk you through creating your first Glasswork API from scratch.

:::: tip New to Glasswork?
Read [Architecture Philosophy](/architecture/philosophy) to understand why Glasswork separates services, routes, and modules the way it does.
::::

## Prerequisites

- **Node.js 20+** (ESM + top-level `await`)
- **pnpm** (recommended) or npm/yarn
- **TypeScript 5.9, 6, or 7** (Glasswork itself builds with TypeScript 7)
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

:::: info Glasswork 1.0 package exports
Optional features (auth, email, jobs, uploads, observability) use **subpath imports** such as `glasswork/auth` or `glasswork/email`. See [Package Exports](/getting-started/package-exports).
::::

To use the Swagger UI shown later in this guide, install its optional peer:

```bash
npm install @hono/swagger-ui
```

Glasswork loads it on the first request to `/api`. API routes and the OpenAPI JSON
endpoint work without this package; set `openapi.serveUI: false` if you do not use the UI.

## Your First API

### 1. Create Your DTOs

First, define your data transfer objects using Valibot schemas. These will automatically generate OpenAPI documentation:

<<< @/snippets/quick-start/src/auth/auth.dto.ts [src/auth/auth.dto.ts]

### 2. Create a Service

Business logic lives in services. They receive their dependencies through the constructor and do not depend on the HTTP request, Hono or framework startup:

<<< @/snippets/quick-start/src/auth/auth.service.ts [src/auth/auth.service.ts]

`UnauthorizedException` comes from Glasswork: a plain error class that the error handler turns into a 401. To keep services free of any Glasswork import, see [Decoupling Services](/request-handling/error-handling#decoupling-services).

### 3. Add Its Dependencies

The service depends on a user repository and a password service. This guide keeps users in memory so it runs without a database; replace the repository with one backed by [Prisma](/application-structure/dependency-injection) later:

<<< @/snippets/quick-start/src/auth/user.repository.ts [src/auth/user.repository.ts]

<<< @/snippets/quick-start/src/auth/password.service.ts [src/auth/password.service.ts]

### 4. Define Routes

Routes are thin adapters between HTTP and your services:

<<< @/snippets/quick-start/src/auth/auth.routes.ts [src/auth/auth.routes.ts]

### 5. Create a Module

Modules group related providers and routes. Register every provider the module's services need; `userRepository` is created by an async factory that seeds a demo user:

<<< @/snippets/quick-start/src/auth/auth.module.ts [src/auth/auth.module.ts]

### 6. Create an App Module

Create a root module that imports your feature modules:

<<< @/snippets/quick-start/src/app.module.ts [src/app.module.ts]

### 7. Bootstrap Your App

Create a server file that handles both Lambda and local development:

<<< @/snippets/quick-start/src/server.ts [src/server.ts]

### 8. Run Locally

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

Log in as the demo user:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse"}'
```

Visit:

- **Swagger UI**: <http://localhost:3000/api>
- **OpenAPI Spec**: <http://localhost:3000/api/openapi.json>

## Growing Your App

As your application grows, add more feature modules:

```typescript
// src/app.module.ts
import { defineModule } from 'glasswork/core';
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
