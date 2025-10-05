# Glasswork

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Status](https://img.shields.io/badge/Status-Beta-orange.svg)](https://github.com/yourusername/glasswork)

**A transparent, Lambda-optimized web framework for building OpenAPI-compliant REST APIs.**

Built on Hono, Awilix, and Prisma, Glasswork helps you create production-ready APIs with automatic OpenAPI spec generation, type-safe routing, and clean architecture.

## Why Glasswork?

**Build NestJS-quality APIs that run practically for free on Lambda.**

If you're building hobby projects or side APIs, you want:

- **Near-zero hosting costs** - Lambda + S3 is practically free at low usage
- **Professional architecture** - Clean separation, DI, modules (like NestJS)
- **Automatic OpenAPI docs** - No manual Swagger decorators
- **Fast deployment** - No containers, no servers to maintain
- **Easy testing** - Services are framework-agnostic, no HTTP mocking needed

### The Problem with NestJS on Lambda

NestJS is excellent for professional projects, but on Lambda it has issues:

- Large bundle size = slower cold starts
- Decorators and reflection = harder to tree-shake
- Heavy abstractions = less control over the HTTP layer
- Requires containers for full features (not Lambda-friendly)

### The Glasswork Solution

Keep what's great about NestJS (modules, DI, OpenAPI), but:

- ~1MB bundles with fast cold starts
- No decorators, no reflection - just TypeScript
- Direct access to Hono, Awilix, Prisma (no framework lock-in)
- Built specifically for Lambda deployment
- Still maintain clean architecture and testability

**Perfect for:** Hobby projects, MVPs, side APIs, serverless-first applications

## Features

- **OpenAPI-First**: Automatic spec generation from Valibot schemas - write code, get docs
- **Type-Safe Routes**: Request/response validation with full TypeScript inference
- **Module System**: Organize your API into logical, testable modules
- **Dependency Injection**: Powered by Awilix with Lambda-compatible PROXY mode
- **Framework-Agnostic Services**: Test business logic without any HTTP mocking
- **Lambda-Optimized**: ~1MB bundles, fast cold starts, production-ready

## Installation

```bash
npm install glasswork hono awilix valibot hono-openapi
```

## Quick Start

### 1. Define Your DTOs (Valibot Schemas)

```typescript
import { object, string, email } from 'valibot';

// These schemas automatically generate OpenAPI documentation
export const LoginDto = object({
  email: string([email()]),
  password: string([minLength(8)]),
});

export const SessionDto = object({
  token: string(),
  expiresAt: string(),
});
```

### 2. Create Type-Safe Routes

```typescript
import { createRoutes, route } from 'glasswork';

export const authRoutes = createRoutes<{ authService: AuthService }>(
  (router, { authService }) => {
    // router is a real Hono instance - all features work

    router.post('/login', route({
      tags: ['Auth'],
      summary: 'User login',
      public: true,
      body: LoginDto,
      responses: { 200: SessionDto },
      handler: async ({ body }) => {
        // body is fully typed from LoginDto
        return authService.login(body.email, body.password);
      },
    }));
  }
);
```

### 3. Write Framework-Agnostic Services

```typescript
// Services have zero framework coupling
export class AuthService {
  constructor({ prismaService, hashService }: {
    prismaService: PrismaService;
    hashService: HashService;
  }) {
    this.prismaService = prismaService;
    this.hashService = hashService;
  }

  async login(email: string, password: string) {
    const user = await this.prismaService.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Invalid credentials');

    await this.hashService.verify(password, user.password);
    return this.createSession(user);
  }
}
```

### 4. Define Modules and Bootstrap

```typescript
// auth.module.ts
export const AuthModule = defineModule({
  name: 'auth',
  basePath: 'auth',
  providers: [AuthService],
  routes: authRoutes,
});

// app.ts
import { bootstrap } from 'glasswork';

const { app } = bootstrap(AppModule, {
  openapi: {
    enabled: true,
    documentation: {
      info: { title: 'My API', version: '1.0.0' },
    },
  },
});

export default app; // Ready for Lambda or local server
```

**Your OpenAPI spec is automatically generated at `/api/openapi.json`** 🎉

## When to Use Glasswork

**Choose Glasswork if you:**

- Want to deploy on Lambda (hobby projects, low-cost hosting)
- Like NestJS patterns but need smaller bundles
- Value clean architecture and testability
- Want automatic OpenAPI without decorators
- Prefer transparency over heavy abstractions

**Consider alternatives if you:**

- Need GraphQL (use Apollo Server, Pothos)
- Deploy to containers anyway (use NestJS, it's excellent)
- Want full-stack with frontend (use Next.js, Remix)
- Need minimal setup with zero opinions (use Hono directly)

## Requirements

- Node.js 18+
- TypeScript 5+
- (Optional) AWS Lambda for serverless deployment

## Contributing

Glasswork is in active development. Feedback, issues, and contributions are welcome!

## License

MIT
