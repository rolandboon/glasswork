---
layout: home

hero:
  name: Glasswork
  text: Transparent Serverless Framework
  tagline: Build OpenAPI-compliant REST APIs with clean architecture, zero magic, and Lambda-first design.
  image:
    src: /logo.png
    alt: Glasswork
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/rolandboon/glasswork

features:
  - icon: 🪶
    title: Small & Fast
    details: Small bundles (~1MB with Prisma), no decorators, no reflection. Optimized for Lambda cold starts.

  - icon: 🏗️
    title: Clean Architecture
    details: Module system with dependency injection (Awilix). Keep business logic pure and framework-agnostic.

  - icon: 📋
    title: OpenAPI Built-in
    details: Automatic spec generation from Valibot schemas. Documentation generated from code.

  - icon: 🔍
    title: Transparent
    details: Direct access to Hono, no heavy abstractions. All library features remain accessible.

  - icon: ✅
    title: Type-Safe
    details: Full TypeScript inference from schemas to handlers. Session and body types automatically inferred.

  - icon: 🧪
    title: Framework-Agnostic Services
    details: Test business logic without HTTP mocking. Your services work in CLI, jobs, or any context.
---

## Quick Example

```typescript
import { defineModule, bootstrap, route, createRoutes } from 'glasswork';
import { object, string, pipe, email, minLength } from 'valibot';

// 1. Define your DTOs with Valibot
const LoginDto = object({
  email: pipe(string(), email()),
  password: pipe(string(), minLength(8)),
});

const SessionDto = object({
  token: string(),
  expiresAt: string(),
});

// 2. Create type-safe routes
export const authRoutes = createRoutes((router, { authService }, route) => {
  router.post('/login', ...route({
    tags: ['Auth'],
    summary: 'User login',
    public: true,
    body: LoginDto,
    responses: { 200: SessionDto },
    handler: ({ body }) => {
      // Body is fully typed from LoginDto
      return authService.login(body.email, body.password);
    },
  }));
});

// 3. Define modules
export const AuthModule = defineModule({
  name: 'auth',
  basePath: 'auth',
  providers: [AuthService],
  routes: authRoutes,
});

// 4. Bootstrap
const { app } = bootstrap(AuthModule, {
  openapi: { enabled: true }
});

export default app; // Ready for Lambda or local server
```

Your OpenAPI spec is automatically generated at `/api/openapi.json`.

---

## Why Glasswork?

Glasswork provides NestJS-style architecture optimized for serverless deployment.

It uses common patterns from NestJS (modules, DI, OpenAPI) with smaller bundle sizes and Lambda-optimized performance:

### Optimized For
- Lambda-first projects
- MVPs and hobby APIs
- Services where bundle size matters
- Teams that value clean architecture

### Consider Alternatives
- **GraphQL?** Use Apollo Server or Pothos
- **Container deployment?** NestJS is excellent for this
- **Full-stack app?** Use Next.js or Remix
- **Minimal framework?** Use Hono directly
