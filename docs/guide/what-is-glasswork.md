# What is Glasswork?

Glasswork is a **transparent, serverless-optimized web framework** for building OpenAPI-compliant REST APIs with TypeScript.

## Framework Comparison

Glasswork provides:

- **More structure than Hono** - Module system, DI, automatic OpenAPI generation
- **Lighter than NestJS** - No decorators, ~1MB bundles, Lambda-first design
- **Type-safe routing** - Built-in validation with modern TypeScript patterns

## Who is it for?

**Suitable for:**

- Lambda-first APIs
- MVPs and hobby projects
- Startups that value clean architecture
- Teams that want NestJS patterns without the bundle size
- Developers who prefer plain TypeScript over decorators

**Not a good fit if:**

- You need GraphQL (use Apollo Server or Pothos instead)
- You're deploying to containers (NestJS is excellent for this)
- You need a full-stack framework (use Next.js or Remix)
- You want maximum simplicity (use Hono directly)

## Core Features

### Small & Fast

- Small bundles (~1MB including Prisma)
- No decorators, no reflection
- Optimized for Lambda cold starts

### Clean Architecture

- Module system with dependency injection (Awilix)
- Business logic stays framework-agnostic
- Services work in HTTP, CLI, jobs—anywhere

### OpenAPI Built-in

- Automatic spec generation from Valibot schemas
- Swagger UI in development
- Documentation generated from code

### Transparent

- Direct access to Hono (no wrappers)
- All library features remain accessible
- Documentation from underlying libraries applies directly

### Type-Safe

- Full TypeScript inference
- Session and body types inferred from schemas
- Catch bugs at compile time

### Framework-Agnostic Services

- Test business logic without HTTP mocking
- Reuse services in any context
- Zero framework coupling

## Philosophy

Glasswork is built on three core principles:

1. **Framework as a Detail** - Business logic never knows about the framework
2. **Enhance, Don't Replace** - Expose underlying libraries directly
3. **Serverless-First** - Optimized for Lambda and edge runtimes

Learn more in [Architecture Philosophy](/core-concepts/philosophy).

## Real-World Example

Here's what a complete feature looks like in Glasswork:

```typescript
// 1. Define DTO
const LoginDto = object({
  email: pipe(string(), email()),
  password: pipe(string(), minLength(8)),
});

const SessionDto = object({
  token: string(),
  expiresAt: string(),
});

// 2. Write Service (zero framework coupling)
export class AuthService {
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
    const user = await this.prismaService.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Invalid credentials');

    await this.hashService.verify(password, user.password);

    return {
      token: generateToken(user.id),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}

// 3. Define Routes (thin HTTP adapters)
export const authRoutes = createRoutes((router, { authService }, route) => {
  router.post('/login', ...route({
    tags: ['Auth'],
    summary: 'User login',
    public: true,
    body: LoginDto,
    responses: { 200: SessionDto },
    handler: ({ body }) => {
      return authService.login(body.email, body.password);
    },
  }));
});

// 4. Create Module
export const AuthModule = defineModule({
  name: 'auth',
  basePath: 'auth',
  providers: [AuthService],
  routes: authRoutes,
});

// 5. Bootstrap
const { app } = await bootstrap(AuthModule, {
  openapi: { enabled: true }
});

// Your OpenAPI spec is automatically generated at /api/openapi.json
```

## Glossary

| Term | Description |
|------|-------------|
| **Module** | A unit of organization that groups related routes, services, and dependencies. Modules can import other modules. |
| **Route** | A thin HTTP adapter that handles request validation, calls services, and formats responses. Should be 5-7 lines. |
| **Service** | A class containing business logic with zero framework coupling. Can be reused in CLI, jobs, or tests. |
| **Provider** | A service class registered with the DI container. Can be scoped per-request or singleton. |
| **DTO** | Data Transfer Object. A Valibot schema defining request/response shapes, used for validation and OpenAPI generation. |
| **Schema** | A Valibot definition used for validation (input constraints, allowed operations). |
| **RouteFactory** | A function created by `createRoutes()` that defines routes and receives injected services. |
| **DI Container** | Awilix container that manages service lifecycles and dependencies. |
| **Bootstrap** | The process of creating the Hono app, registering modules, and setting up middleware. |
