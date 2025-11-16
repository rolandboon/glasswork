# Glasswork

[![npm version](https://img.shields.io/npm/v/glasswork)](https://www.npmjs.com/package/glasswork)
[![Coverage](https://img.shields.io/codecov/c/github/rolandboon/glasswork)](https://www.npmjs.com/package/glasswork)
[![CI](https://github.com/rolandboon/glasswork/actions/workflows/ci.yml/badge.svg)](https://github.com/rolandboon/glasswork/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/rolandboon/glasswork.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

**A transparent, serverless-optimized web framework for building OpenAPI-compliant REST APIs.**

Built on Hono, Awilix, and Valibot, Glasswork provides automatic OpenAPI spec generation, type-safe routing, dependency injection, and clean modular architecture.

## Why Glasswork?

**NestJS-style architecture with serverless-first design.**

Glasswork combines the best patterns from NestJS (modules, DI, OpenAPI) with the performance characteristics needed for serverless:

- **Small & Fast** - tiny bundles (~1MB incl Prisma), no decorators, no reflection
- **Clean Architecture** - Module system with dependency injection (Awilix)
- **OpenAPI Built-in** - Automatic spec generation from Valibot schemas
- **Framework-Agnostic Services** - Test business logic without HTTP mocking
- **Transparent** - Direct access to Hono, no heavy abstractions

**Perfect for:** Lambda-first projects, MVPs, hobby APIs, or anywhere you want NestJS patterns without the bundle size.

## Features

- **OpenAPI-First**: Automatic spec generation from Valibot schemas - write code, get docs
- **Type-Safe Routes**: Request/response validation with full TypeScript inference
- **Module System**: Organize your API into logical, testable modules
- **Dependency Injection**: Powered by Awilix with serverless-compatible PROXY mode
- **Framework-Agnostic Services**: Test business logic without any HTTP mocking
- **Production-Ready**: Small bundles, fast cold starts, works anywhere Node.js runs

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

**Choose Glasswork when you want:**

- NestJS-style architecture with smaller bundles
- Automatic OpenAPI generation without decorators
- Serverless-first design (Lambda, Cloudflare Workers, etc.)
- Clean, testable code with dependency injection

**Consider alternatives:**

- **GraphQL?** Use Apollo Server or Pothos
- **Container deployment?** NestJS is excellent for this
- **Full-stack app?** Use Next.js or Remix
- **Minimal framework?** Use Hono directly

## Requirements

- Node.js 20+
- TypeScript 5+

## Contributing

Glasswork is in active development. Feedback, issues, and contributions are welcome!

## License

MIT
