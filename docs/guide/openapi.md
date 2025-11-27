# OpenAPI

Glasswork automatically generates OpenAPI 3.1 specifications from your route definitions and Valibot schemas. No manual documentation required.

::: tip Under the Hood
Glasswork uses [hono-openapi](https://github.com/rhinobase/hono-openapi) for OpenAPI integration, which utilizes Valibot's [@valibot/to-json-schema](https://github.com/open-circle/valibot/tree/main/packages/to-json-schema) for converting schemas to JSON Schema.
:::

## Automatic Generation

Every route defined with the `route()` helper automatically contributes to your OpenAPI spec:

```typescript
import { object, string, pipe, email } from 'valibot';

const CreateUserDto = object({
  email: pipe(string(), email()),
  name: string(),
});

const UserResponseDto = object({
  id: string(),
  email: string(),
  name: string(),
  createdAt: string(),
});

router.post('/users', ...route({
  tags: ['Users'],
  summary: 'Create a new user',
  description: 'Creates a user account with email and name',
  body: CreateUserDto,
  responses: { 201: UserResponseDto },
  handler: ({ body }) => {
    return userService.create(body);
  },
}));
```

This generates a complete OpenAPI operation with:

- Request body schema (from `CreateUserDto`)
- Response schema (from `UserResponseDto`)
- Parameter descriptions
- Validation rules
- Example values

## Configuration

Configure OpenAPI in the `bootstrap()` options:

```typescript
import { bootstrap } from 'glasswork';
import { AppModule } from './app.module';

const { app } = bootstrap(AppModule, {
  openapi: {
    enabled: true,
    serveSpecs: true,  // Serve /api/openapi.json
    serveUI: true,     // Serve Swagger UI at /api
    writeToFile: 'openapi.json', // Write spec to file
    documentation: {
      info: {
        title: 'My API',
        version: '1.0.0',
        description: 'API for my application',
        contact: {
          name: 'API Support',
          email: 'support@example.com',
        },
      },
      servers: [
        { url: 'https://api.example.com', description: 'Production' },
        { url: 'http://localhost:3000', description: 'Development' },
      ],
    },
  },
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable OpenAPI generation |
| `serveSpecs` | `boolean` | `true` (dev) | Serve spec at `/api/openapi.json` |
| `serveUI` | `boolean` | `true` (dev) | Serve Swagger UI at `/api` |
| `writeToFile` | `string` | `undefined` | Path to write spec file |
| `documentation` | `object` | `{}` | OpenAPI metadata |

## Security Schemes

Define security schemes in the `documentation.components.securitySchemes`:

```typescript
openapi: {
  enabled: true,
  documentation: {
    info: { title: 'My API', version: '1.0.0' },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'session',
        },
      },
    },
  },
}
```

Routes automatically reference these schemes based on the `public` flag:

```typescript
// Public route - no security
router.post('/auth/login', ...route({
  public: true,
  // ...
}));

// Protected route - includes all defined security schemes
router.get('/profile', ...route({
  // Automatically documents: requires bearerAuth OR cookieAuth
  // ...
}));
```

## Tags

Organize routes with tags:

```typescript
// Auth routes
router.post('/login', ...route({
  tags: ['Authentication'],
  summary: 'User login',
  // ...
}));

// User routes
router.get('/users', ...route({
  tags: ['Users'],
  summary: 'List users',
  // ...
}));

router.post('/users', ...route({
  tags: ['Users', 'Admin'], // Multiple tags
  summary: 'Create user',
  // ...
}));
```

Define tag descriptions in the documentation:

```typescript
openapi: {
  documentation: {
    info: { /* ... */ },
    tags: [
      { name: 'Authentication', description: 'Auth endpoints' },
      { name: 'Users', description: 'User management' },
      { name: 'Admin', description: 'Admin-only operations' },
    ],
  },
}
```

## Response Documentation

Glasswork automatically adds default error responses to every route:

**Always included:**

- `500` - Internal Server Error

**Conditionally included:**

- `422` - Unprocessable Entity (when `body`, `query`, or `params` validation is configured)
- `401` - Unauthorized (when `public: false`, which is the default)

You define the success responses:

```typescript
router.post('/users', ...route({
  tags: ['Users'],
  summary: 'Create user',
  body: CreateUserDto,
  responses: {
    201: UserResponseDto, // You define success
    400: ErrorResponseDto, // Optional: custom error response
    409: ConflictResponseDto, // Optional: specific error case
  },
  handler: ({ body }) => {
    // Handler logic
  },
}));
```

The final OpenAPI spec includes:

- `201` - UserResponseDto (your success response)
- `400` - ErrorResponseDto (your custom error)
- `401` - Unauthorized (added automatically because route is protected)
- `409` - ConflictResponseDto (your conflict error)
- `422` - Unprocessable Entity (added automatically because of body validation)
- `500` - Internal Server Error (always added)

## Descriptions

Add detailed descriptions to routes and fields:

```typescript
// Route description
router.post('/users', ...route({
  summary: 'Create user', // Short summary
  description: `
    Creates a new user account. The user will receive a verification
    email at the provided address. Password must be at least 8 characters.
  `, // Detailed description
  body: CreateUserDto,
  responses: { 201: UserResponseDto },
  handler: ({ body }) => {
    return userService.create(body);
  },
}));

// Schema descriptions (via Valibot metadata)
import { object, string, pipe, email, minLength, description } from 'valibot';

const CreateUserDto = pipe(
  object({
    email: pipe(
      string(),
      email(),
      description('User email address used for login')
    ),
    password: pipe(
      string(),
      minLength(8),
      description('Password (minimum 8 characters)')
    ),
  }),
  description('User creation payload')
);
```

## Accessing the Spec

### Development

When `serveSpecs` and `serveUI` are enabled (default in development):

- **Swagger UI**: http://localhost:3000/api
- **OpenAPI JSON**: http://localhost:3000/api/openapi.json

### Production

In production, disable serving specs:

```typescript
import { isProduction } from 'glasswork';

const { app } = bootstrap(AppModule, {
  openapi: {
    enabled: true,
    serveSpecs: !isProduction(), // Only serve locally
    serveUI: !isProduction(),
  },
});
```

### Write to File

Generate a spec file during build:

```typescript
openapi: {
  enabled: true,
  writeToFile: 'openapi.json', // Written after routes register
}
```

This is useful for:

- Committing specs to version control
- Generating client SDKs
- Importing into API gateways

## Environment-Specific Servers

Adjust server URLs based on environment:

```typescript
import { isProduction } from 'glasswork';

const servers = isProduction()
  ? [{ url: 'https://api.example.com', description: 'Production' }]
  : [
      { url: 'http://localhost:3000', description: 'Local' },
      { url: 'https://staging.example.com', description: 'Staging' },
    ];

openapi: {
  documentation: {
    info: { /* ... */ },
    servers,
  },
}
```

## Response Processors

Response processors modify OpenAPI response objects based on route configuration. Glasswork includes built-in processors for common patterns:

**Built-in processors:**

- **CORS headers** - Adds when `middleware.cors` is configured
- **Rate limit headers** - Adds when `rateLimit.enabled` is true
- **Pagination headers** - Adds `X-Total-Count`, `X-Total-Pages`, etc. when query has `page`/`pageSize`
- **Custom response headers** - Adds headers from route `openapi.responseHeaders`

Create custom processors:

```typescript
import type { OpenAPIResponseProcessor } from 'glasswork';

// Add custom header to all 200 responses
const serverTimingProcessor: OpenAPIResponseProcessor = (response, context) => {
  if (context.statusCode !== '200') return response;

  return {
    ...response,
    headers: {
      ...response.headers,
      'Server-Timing': {
        description: 'Server-side operation timing',
        schema: { type: 'string' },
      },
    },
  };
};

// Register in bootstrap
openapi: {
  enabled: true,
  responseProcessors: [serverTimingProcessor],
  documentation: { /* ... */ },
}
```

## Schema References

Valibot schemas are automatically converted to JSON Schema with `$ref` support for reusable components:

```typescript
// Shared schema
const AddressDto = object({
  street: string(),
  city: string(),
  country: string(),
});

// Used in multiple places
const UserDto = object({
  id: string(),
  name: string(),
  address: AddressDto, // Becomes a $ref in OpenAPI
});

const CompanyDto = object({
  id: string(),
  name: string(),
  addresses: array(AddressDto), // Reuses same $ref
});
```

The OpenAPI spec will have `AddressDto` in `components.schemas` and reference it from multiple locations.

## Limitations

### Valibot Schema Compatibility

Most Valibot schemas convert to JSON Schema, but some advanced features may not:

- **Supported**: `object`, `string`, `number`, `boolean`, `array`, `optional`, `nullable`, `union`, `literal`, `enum`, `pipe` (with validators)
- **Limited**: Custom transformations, async validators
- **Not supported**: Recursive schemas (may cause issues)

If a schema doesn't convert properly, you'll see a warning in development.

### Dynamic Schemas

Schemas are static at build time. If you generate schemas dynamically based on runtime data, they won't appear in the OpenAPI spec.

## Best Practices

### 1. Use Descriptive Summaries

Make summaries clear and concise:

```typescript
// ✅ Good
summary: 'Create user account'
summary: 'Get user by ID'
summary: 'Delete user session'

// ❌ Bad
summary: 'POST /users'
summary: 'User'
summary: 'Endpoint'
```

### 2. Document All Response Codes

Include all possible responses:

```typescript
responses: {
  200: SuccessDto,
  400: ValidationErrorDto,
  401: UnauthorizedDto,
  404: NotFoundDto,
  500: ServerErrorDto,
}
```

### 3. Group with Tags

Use consistent tags across routes:

```typescript
tags: ['Users']      // ✅ Consistent
tags: ['User']       // ❌ Inconsistent with 'Users'
tags: ['user-mgmt']  // ❌ Inconsistent casing
```

### 4. Version Your API

Include version in the title or path:

```typescript
info: {
  title: 'My API',
  version: '2.0.0', // Semantic versioning
}

// Or in the path
basePath: 'v2'
```

## Integration with API Gateways

Export your spec for use with API gateways:

```typescript
// Generate spec
openapi: {
  enabled: true,
  writeToFile: 'dist/openapi.json',
}
```

Then import into:

- **AWS API Gateway**: Import OpenAPI 3.0 spec
- **Azure API Management**: Import OpenAPI definition
- **Kong**: Use OpenAPI spec for route configuration
- **Postman**: Import collection from OpenAPI

## Learn More

- [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.0) - Official spec documentation
- [Valibot Documentation](https://valibot.dev/) - Schema validation library
- [Swagger Editor](https://editor.swagger.io/) - Visualize and edit OpenAPI specs
