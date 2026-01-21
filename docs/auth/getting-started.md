# Authentication - Getting Started

Glasswork provides a focused auth module that integrates [Better Auth](https://better-auth.com) for authentication with [CASL](https://casl.js.org) for authorization, giving you type-safe, role-based access control with minimal setup.

After reading this guide, you will know:

- How to configure Better Auth with Prisma
- How to define CASL abilities for authorization
- How to set up auth middleware for routes
- How to integrate auth with OpenAPI documentation

## Quick Start

### 1. Install Dependencies

:::: code-group

```bash [npm]
npm install better-auth @casl/ability @casl/prisma
```

```bash [pnpm]
pnpm add better-auth @casl/ability @casl/prisma
```

```bash [yarn]
yarn add better-auth @casl/ability @casl/prisma
```

::::

### 2. Generate Prisma Schema

Better Auth requires tables for users, sessions, and accounts. Generate the schema using the Better Auth CLI:

```bash
npx @better-auth/cli@latest generate
```

This adds the required models to your `schema.prisma`. Run the migration:

```bash
npx prisma migrate dev --name add-auth-tables
```

### 3. Configure Better Auth

Create your Better Auth configuration using the Prisma adapter:

```typescript
// src/auth/auth.config.ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { openAPI } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql', // or 'sqlite', 'mysql'
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    openAPI(), // Enables OpenAPI spec generation
  ],
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'member' },
    },
  },
});
```

::: tip Performance Tip
Enable database joins for 2-3x performance improvements on session queries:

```typescript
export const auth = betterAuth({
  experimental: { joins: true },
  // ... rest of config
});
```
:::

### 4. Define Abilities

Create CASL abilities to define what each role can do:

```typescript
// src/auth/abilities.ts
import { defineRoleAbilities, type AuthUser } from 'glasswork';
import type { Subjects } from '@casl/prisma';
import type { User, Project, Organization } from '@prisma/client';

type AppSubjects = Subjects<{
  User: User;
  Project: Project;
  Organization: Organization;
}> | 'all';

type AppAction = 'create' | 'read' | 'update' | 'delete' | 'manage';
type AppRole = 'admin' | 'member' | 'guest';

export const abilities = defineRoleAbilities<AppSubjects, AppAction, AppRole>({
  admin: ({ can }) => {
    can('manage', 'all');
  },

  member: ({ can, cannot, user }) => {
    can('read', 'Organization', { id: user.tenantId });
    can('read', 'Project', { organizationId: user.tenantId });
    can('create', 'Project', { organizationId: user.tenantId });
    can('update', 'Project', { createdBy: user.id });
    cannot('delete', 'Project');
  },

  guest: () => {
    // No abilities
  },
});

export type AppAbility = ReturnType<typeof abilities.for>;
```

### 5. Create Auth Middleware

Wire up the middleware that validates sessions and builds abilities:

```typescript
// src/auth/auth.middleware.ts
import { createAuthMiddleware, createBetterAuthProvider } from 'glasswork';
import { auth } from './auth.config';
import { abilities } from './abilities';

// Create the provider that wraps Better Auth
const provider = createBetterAuthProvider({
  auth,
  mapUser: (user) => ({
    id: user.id as string,
    email: user.email as string,
    role: (user.role as string) ?? 'member',
    tenantId: user.organizationId as string | undefined,
  }),
});

// Create the middleware
export const authMiddleware = createAuthMiddleware({
  provider,
  buildAbility: (user) => abilities.for(user),
  guestAbility: () => abilities.forRole('guest'),
  cookieName: 'session',
});
```

### 6. Mount Better Auth Routes

Mount Better Auth's handler to expose auth endpoints:

```typescript
// src/auth/auth.routes.ts
import { Hono } from 'hono';
import { auth } from './auth.config';

const router = new Hono();

// Mount all Better Auth routes
router.all('/*', (c) => auth.handler(c.req.raw));

export { router as authRoutes };
```

### 7. Use in Your App

Register the auth module and use middleware in routes:

```typescript
// src/app.ts
import { bootstrap } from 'glasswork';
import { authMiddleware } from './auth/auth.middleware';
import { authRoutes } from './auth/auth.routes';

const { app } = await bootstrap(AppModule, {
  // ... options
});

// Mount auth routes
app.route('/auth', authRoutes);

// Use auth middleware on protected routes
app.use('/api/*', authMiddleware());
```

### 8. Protected Routes with Authorization

Use the `authorize` option to enforce permissions:

```typescript
import { createRoutes, route } from 'glasswork';
import { authMiddleware } from './auth/auth.middleware';

export const projectRoutes = createRoutes((router, services, route) => {
  // Apply auth middleware
  router.use('*', authMiddleware());

  // List projects - requires 'read' permission on 'Project'
  router.get('/', ...route({
    authorize: { action: 'read', subject: 'Project' },
    responses: { 200: ProjectListSchema },
    handler: async ({ ability }) => {
      return services.projectService.findAll(ability);
    },
  }));

  // Create project
  router.post('/', ...route({
    authorize: { action: 'create', subject: 'Project' },
    body: CreateProjectSchema,
    responses: { 201: ProjectSchema },
    handler: async ({ body, user }) => {
      return services.projectService.create(body, user!.id);
    },
  }));
});
```

## Route Context

The auth middleware adds these values to the Hono context, available in all route handlers:

| Property | Type | Description |
|----------|------|-------------|
| `user` | `AuthUser \| null` | Authenticated user, or null for guests |
| `session` | `AuthSession \| null` | Current session data |
| `ability` | `AppAbility` | CASL ability instance |
| `isAuthenticated` | `boolean` | Whether user is authenticated |

Access these in route handlers:

```typescript
handler: async ({ user, ability, isAuthenticated }) => {
  if (!isAuthenticated) {
    // Handle guest access
  }
  
  // Use ability for permission checks
  if (ability.can('delete', 'Project')) {
    // Show delete option
  }
}
```

## Environment Variables

Configure Better Auth via environment variables:

```env
# Required
DATABASE_URL=postgresql://...

# Optional - Session configuration
BETTER_AUTH_SECRET=your-secret-key  # For JWT signing
```

## Next Steps

- [Abilities (CASL)](./abilities) - Advanced ability patterns and Prisma integration
- [Middleware](./middleware) - Configuration options and error handling
- [OpenAPI Integration](./openapi) - Document auth endpoints
- [Testing](./testing) - Test auth flows
