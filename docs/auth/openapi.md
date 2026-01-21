# OpenAPI Integration

Better Auth includes a built-in OpenAPI plugin that generates documentation for all auth endpoints. This guide shows how to set it up and combine it with your Glasswork API documentation.

## Setup

### 1. Install the OpenAPI Plugin

The OpenAPI plugin is included with Better Auth:

```typescript
// src/auth/auth.config.ts
import { betterAuth } from 'better-auth';
import { openAPI } from 'better-auth/plugins';
import { prismaAdapter } from 'better-auth/adapters/prisma';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  plugins: [
    openAPI(), // Add the OpenAPI plugin
  ],
});
```

### 2. Access the Reference

Once configured, Better Auth exposes:

| Endpoint | Description |
|----------|-------------|
| `/api/auth/reference` | Interactive API reference (Scalar) |
| `/api/auth/open-api/generate-schema` | Raw OpenAPI JSON schema |

Navigate to `http://localhost:3000/api/auth/reference` to see the interactive documentation.

## Endpoints Documentation

The OpenAPI plugin automatically documents:

- **Core Authentication**: Sign up, sign in, sign out, session management
- **Email/Password**: Password reset, email verification
- **Social OAuth**: Provider-specific endpoints
- **Plugin Endpoints**: 2FA, magic links, passkeys, organizations, etc.

Endpoints are grouped by plugin name, with core endpoints under "Default" and model schemas under "Models".

## Getting the Schema Programmatically

Generate the OpenAPI schema in code:

```typescript
import { auth } from './auth.config';

const openAPISchema = await auth.api.generateOpenAPISchema();
console.log(JSON.stringify(openAPISchema, null, 2));
```

This returns a complete OpenAPI 3.0 specification object.

## Combining with Glasswork Routes

To show both your API routes and auth routes in a single documentation UI, use Scalar's multiple sources feature:

```typescript
import { Scalar } from '@scalar/hono-api-reference';
import { bootstrap } from 'glasswork';

const { app } = await bootstrap(AppModule, {
  openapi: {
    enabled: true,
    serveSpecs: true,    // Serves at /api/openapi.json
    serveUI: false,      // We'll use custom Scalar instead
  },
});

// Mount auth routes
app.route('/api/auth', authRoutes);

// Custom Scalar with multiple sources
app.get('/docs', Scalar({
  pageTitle: 'API Documentation',
  sources: [
    { 
      url: '/api/openapi.json', 
      title: 'API' 
    },
    { 
      url: '/api/auth/open-api/generate-schema', 
      title: 'Auth' 
    },
  ],
}));
```

Now `/docs` shows a tabbed interface with both API and Auth documentation.

## Configuration Options

The OpenAPI plugin accepts configuration:

```typescript
import { openAPI } from 'better-auth/plugins';

plugins: [
  openAPI({
    // Customize the reference page title
    // pageTitle: 'Auth API Reference',
  }),
],
```

## Security Schemes

Better Auth's OpenAPI spec includes security scheme definitions. When combining with Glasswork routes, ensure your security schemes are consistent:

```typescript
// In Glasswork bootstrap options
openapi: {
  documentation: {
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'session',
          description: 'Session cookie from Better Auth',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'JWT token from Better Auth',
        },
      },
    },
  },
},
```

## Writing Schema to File

For CI/CD or client generation, write the combined schema:

```typescript
// scripts/generate-openapi.ts
import { auth } from '../src/auth/auth.config';
import fs from 'fs';

async function generateSchemas() {
  // Auth schema
  const authSchema = await auth.api.generateOpenAPISchema();
  fs.writeFileSync(
    'openapi-auth.json', 
    JSON.stringify(authSchema, null, 2)
  );
  
  console.log('Generated openapi-auth.json');
}

generateSchemas();
```

Add to your build scripts:

```json
{
  "scripts": {
    "build:openapi": "tsx scripts/generate-openapi.ts",
    "build": "pnpm build:openapi && tsc"
  }
}
```

## Route Security in Glasswork

Mark routes as public or protected for correct OpenAPI security documentation:

```typescript
// Public route - no security requirements in OpenAPI
router.post('/auth/callback', ...route({
  public: true,
  handler: async ({ body }) => {
    // OAuth callback handling
  },
}));

// Protected route - includes security schemes in OpenAPI
router.get('/profile', ...route({
  // public: false (default)
  authorize: { action: 'read', subject: 'User' },
  handler: async ({ user }) => {
    return user;
  },
}));
```

## Best Practices

### Consistent Base Paths

Mount auth routes under a consistent path:

```typescript
// All auth routes under /api/auth
app.route('/api/auth', authRoutes);

// Your API routes under /api
app.route('/api/projects', projectRoutes);
app.route('/api/users', userRoutes);
```

### Environment-Specific Docs

Disable docs in production:

```typescript
import { isProduction } from 'glasswork';

if (!isProduction()) {
  app.get('/docs', Scalar({
    sources: [
      { url: '/api/openapi.json', title: 'API' },
      { url: '/api/auth/open-api/generate-schema', title: 'Auth' },
    ],
  }));
}
```

### Tag Organization

Use consistent tags across your API and auth routes. Better Auth groups by plugin name; organize your routes similarly:

```typescript
router.get('/users', ...route({
  tags: ['Users'],  // Matches organizational style
  // ...
}));
```

## Next Steps

- [Testing](./testing) - Test auth flows and integration
- [OpenAPI Routes](/request-handling/openapi) - Glasswork's OpenAPI configuration
