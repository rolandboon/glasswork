<div align="center">
  <a href="https://glasswork.dev" target="_blank" rel="noopener noreferrer">
    <img width="180" src="./docs/public/logo.png" alt="Glasswork logo">
  </a>

  &nbsp;

  [![npm version][npm-version-src]][npm-version-href]
  [![Coverage][coverage-src]][coverage-href]
  [![CI][build-src]][build-href]
  [![License: MIT][license-src]][license-href]
  [![TypeScript][type-script-src]][type-script-href]

  <h4>
    <a href="https://glasswork.dev/" target="_blank">Documentation</a>
    <span> · </span>
    <a href="https://github.com/rolandboon/glasswork/issues/" target="_blank">Report Bug</a>
  </h4>

  <br />
</div>

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

Glasswork 1.0 uses **subpath exports** (`glasswork/core`, `glasswork/http`, `glasswork/auth`, …). The root `glasswork` import covers core and HTTP only; optional subsystems use their own subpath. See [Package Exports](https://glasswork.dev/getting-started/package-exports).

## Quick Start

### 1. Define Your DTOs (Valibot Schemas)

```typescript
import { object, string, email, pipe, minLength } from 'valibot';

// These schemas automatically generate OpenAPI documentation
export const LoginDto = object({
  email: pipe(string(), email()),
  password: pipe(string(), minLength(8)),
});

export const SessionDto = object({
  token: string(),
  expiresAt: string(),
});
```

### 2. Create Type-Safe Routes

```typescript
import { createRoutes, route } from 'glasswork/http';

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
import { NotFoundException } from 'glasswork/http';

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
import { bootstrap } from 'glasswork/core';

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
- TypeScript 5.9, 6, or 7 (verified against the published declarations)

## Contributing

Glasswork is in active development. Feedback, issues, and contributions are welcome!

Builds and typechecks use stable TypeScript 7. Vitest stays on the latest 4.x
release to remain compatible with Better Auth's testing peer range. CI runs the
full test suite on Node.js 20, 22, 24, and 26, and checks the packed package's
TypeScript 5.9, 6, and 7 consumer inference on Node.js 20.

The repository can be developed and verified independently with npm:

```sh
npm ci
npm run verify
npm run docs:build
```

`npm run smoke:pack` installs the tarball in an isolated npm project, checks its
published types, and imports its public entry points. Set `TYPESCRIPT_VERSION`
to test another supported compiler, for example
`TYPESCRIPT_VERSION=5.9.3 npm run smoke:pack` after building. Prisma's development
tooling requires Node.js 20.19+, 22.12+, or 24+ on the respective supported lines.

The RLS integration suite creates a temporary schema and restricted role in an
existing PostgreSQL **test database**, then removes them afterwards. Set
`RLS_TEST_DATABASE_URL` to a test administrator connection allowed to create schemas
and roles; the actual isolation checks run as the restricted role:

```sh
RLS_TEST_DATABASE_URL=postgresql://test_admin:password@localhost:5432/test_db npm run verify
```

Without this variable, the PostgreSQL suite is skipped. CI sets it for both tests
and coverage. To run coverage locally, use the same variable with
`npm run test:coverage`.

## License

MIT


<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/glasswork?flat&colorA=1b1b1f&colorB=3e63dd
[npm-version-href]: https://npmjs.com/package/glasswork
[coverage-src]: https://img.shields.io/codecov/c/github/rolandboon/glasswork?style=flat&colorA=1b1b1f&colorB=3e63dd
[coverage-href]: https://codecov.io/gh/rolandboon/glasswork
[build-src]: https://img.shields.io/github/actions/workflow/status/rolandboon/glasswork/ci.yml?style=flat&colorA=1b1b1f&colorB=3e63dd
[build-href]: https://github.com/rolandboon/glasswork/actions/workflows/ci.yml
[license-src]: https://img.shields.io/github/license/rolandboon/glasswork.svg?flat&colorA=1b1b1f&colorB=3e63dd
[license-href]: https://opensource.org/licenses/MIT
[type-script-src]: https://img.shields.io/badge/TypeScript-5.9%20%7C%206%20%7C%207-blue?style=flat&labelColor=1b1b1f&color=3e63dd
[type-script-href]: https://www.typescriptlang.org/
