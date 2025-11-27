# Routes & Validation

Routes define your HTTP endpoints. In Glasswork, routes are thin adapters that validate input, call services, and return responses.

::: info Why Thin Routes?
Routes should be 5-7 lines because:

- **Business logic belongs in services** - easier to test, reuse, and maintain
- **Routes are framework-coupled** - keeping them thin minimizes lock-in
- **Validation is automatic** - schemas handle parsing and type conversion

If a route is getting long, move the logic to a service.
:::

Routes are defined using Hono (exposed directly) with Glasswork's type-safe `route()` helper that integrates Valibot schema validation.

## Defining Routes

Routes are created using the `createRoutes()` function:

```typescript
import { createRoutes } from 'glasswork';
import { LoginDto, SessionDto } from './auth.dto';
import type { AuthService } from './auth.service';

export const authRoutes = createRoutes<{ authService: AuthService }>(
  (router, { authService }, route) => {
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
  }
);
```

### Route Configuration

The `route()` function accepts a configuration object:

| Property | Type | Description |
|----------|------|-------------|
| `summary` | `string` | Short description (for OpenAPI) |
| `description` | `string` (optional) | Detailed description |
| `tags` | `string[]` (optional) | OpenAPI tags for grouping |
| `public` | `boolean` (optional) | Whether route requires authentication (default: `false`) |
| `body` | `ValibotSchema` (optional) | Schema for request body validation |
| `query` | `ValibotSchema` (optional) | Schema for query parameters |
| `params` | `ValibotSchema` (optional) | Schema for path parameters |
| `responses` | `Record<number, Schema>` | Response schemas by status code |
| `middleware` | `MiddlewareHandler[]` (optional) | Custom middleware to apply |
| `handler` | `Function` | Route handler function |

## Request Validation

Glasswork uses [Valibot](https://valibot.dev/) for schema validation. Define schemas using Valibot's API:

### Body Validation

```typescript
import { object, string, pipe, email, minLength } from 'valibot';

const CreateUserDto = object({
  email: pipe(string(), email()),
  password: pipe(string(), minLength(8)),
  name: string(),
});

router.post('/users', ...route({
  summary: 'Create user',
  body: CreateUserDto,
  responses: { 201: UserResponseDto },
  handler: ({ body }) => {
    // body is typed as { email: string; password: string; name: string }
    return userService.create(body);
  },
}));
```

### Query Parameter Validation

```typescript
import { object, string, optional, pipe, transform } from 'valibot';

const ListUsersQuery = object({
  page: optional(pipe(string(), transform(Number)), '1'),
  limit: optional(pipe(string(), transform(Number)), '10'),
  search: optional(string()),
});

router.get('/users', ...route({
  summary: 'List users',
  query: ListUsersQuery,
  responses: { 200: array(UserResponseDto) },
  handler: ({ query }) => {
    // query is typed as { page: number; limit: number; search?: string }
    return userService.list(query);
  },
}));
```

### Path Parameter Validation

```typescript
import { object, string, pipe, uuid } from 'valibot';

const UserParamsDto = object({
  id: pipe(string(), uuid()),
});

router.get('/users/:id', ...route({
  summary: 'Get user by ID',
  params: UserParamsDto,
  responses: { 200: UserResponseDto },
  handler: ({ params }) => {
    // params.id is typed as string and validated as UUID
    return userService.findById(params.id);
  },
}));
```

## Type Inference

Types are automatically inferred from your Valibot schemas:

```typescript
const UpdateUserDto = object({
  name: optional(string()),
  email: optional(pipe(string(), email())),
});

router.patch('/users/:id', ...route({
  params: object({ id: string() }),
  body: UpdateUserDto,
  responses: { 200: UserResponseDto },
  handler: ({ params, body }) => {
    // TypeScript knows:
    // - params: { id: string }
    // - body: { name?: string; email?: string }

    return userService.update(params.id, body);
  },
}));
```

## Response Validation

Glasswork validates handler return values against the **full** response schema, not just types and keys:

```typescript
import { object, string, pipe, uuid } from 'valibot';

const UserResponseDto = object({
  id: pipe(string(), uuid()), // Must be valid UUID format
  email: string(),
  name: string(),
});

router.get('/users/:id', ...route({
  params: object({ id: string() }),
  responses: { 200: UserResponseDto },
  handler: async ({ params }) => {
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        name: true,
        password: true, // ⚠️ Extra field
        createdAt: true, // ⚠️ Extra field
      },
    });

    return user; // Automatically strips password and createdAt
    // Note: id must be a valid UUID or validation fails
  },
}));
```

**Validation behavior:**

- **Extra keys**: Automatically stripped from response
- **Schema validators**: Fully validated (e.g., `uuid()`, `email()`, `minLength()`)
- **Development**: Warning logged, raw data returned (for debugging)
- **Production**: No data returned on validation failure (prevents data leaks)

**Benefits:**

- Prevents accidentally leaking sensitive data (passwords, tokens)
- Ensures data format correctness (UUIDs, emails, dates)
- Type-safe at compile time, fully validated at runtime

## Route Context

The handler receives a typed `RouteContext` with:

```typescript
handler: async ({
  body,      // Validated request body (typed from schema)
  query,     // Validated query parameters (typed from schema)
  params,    // Validated path parameters (typed from schema)
  services,  // Injected services (typed from module)
  session,   // User session (if authenticated)
  context,   // Raw Hono context (full Hono API)
  ip,        // Client IP address
  userAgent, // User agent string
}) => {
  // Your handler logic
}
```

### Accessing Hono Context

The raw Hono `context` is always available:

```typescript
router.post('/upload', ...route({
  summary: 'Upload file',
  responses: { 200: object({ url: string() }) },
  handler: async ({ context }) => {
    // Use Hono's built-in helpers
    const formData = await context.req.formData();
    const file = formData.get('file') as File;

    // Access headers
    const contentType = context.req.header('content-type');

    // Set custom headers
    context.header('X-Upload-Id', uploadId);

    return { url: uploadUrl };
  },
}));
```

::: tip Transparency
The `context` object is a real Hono `Context` instance. All Hono documentation and middleware work directly.
:::

## Extending the Route Context

You can extend the route context using Hono's module augmentation to add custom properties:

```typescript
// middleware/auth.middleware.ts
import type { MiddlewareHandler } from 'hono';
import type { AppAbility } from '../abilities';
import type { SessionWithUser } from '../auth.interface';
import type { Role } from '@prisma/client';

// Extend Hono's context
declare module 'hono' {
  interface ContextVariableMap {
    session: SessionWithUser | null;
    ability: AppAbility;
    role: Role | 'GUEST';
  }
}

export function auth(): MiddlewareHandler {
  return async (c, next) => {
    // Authenticate user and set context variables
    const session = await getSession(c);
    const ability = defineAbilityFor(session?.user.role);

    c.set('session', session);
    c.set('ability', ability);
    c.set('role', session?.user.role || 'GUEST');

    await next();
  };
}
```

Now your route handlers have access to the custom properties:

```typescript
router.get('/profile', ...route({
  middleware: [auth()],
  responses: { 200: UserProfileDto },
  handler: ({ session, ability, role }) => {
    // session, ability, and role are typed and available
    if (!ability.can('read', 'Profile')) {
      throw new ForbiddenException('Cannot read profile');
    }

    return userService.getProfile(session!.userId);
  },
}));
```

This works because Glasswork passes through Hono's context variables directly.

## Multiple Response Types

Define different schemas for different status codes:

```typescript
router.post('/login', ...route({
  summary: 'User login',
  public: true,
  body: LoginDto,
  responses: {
    200: object({ mfaRequired: literal(true), methods: array(string()) }),
    201: object({ token: string(), expiresAt: string() }),
  },
  handler: async ({ body }) => {
    const result = await authService.login(body.email, body.password);

    if (result.mfaRequired) {
      // Returns 200 with MFA response
      return { mfaRequired: true, methods: ['totp', 'sms'] };
    }

    // Returns 201 with session response
    return { token: result.token, expiresAt: result.expiresAt };
  },
}));
```

The handler return type is automatically inferred as a union of all 2xx response types.

## Error Handling

Throw domain exceptions for error responses:

```typescript
import { NotFoundException, ValidationException } from 'glasswork';

router.get('/users/:id', ...route({
  params: object({ id: string() }),
  responses: { 200: UserResponseDto },
  handler: async ({ params }) => {
    const user = await userService.findById(params.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  },
}));
```

Available exceptions:

| Exception | Status Code | Default Message |
|-----------|-------------|-----------------|
| `BadRequestException` | 400 | Bad request |
| `UnauthorizedException` | 401 | Unauthorized |
| `ForbiddenException` | 403 | Forbidden |
| `NotFoundException` | 404 | Not found |
| `MethodNotAllowedException` | 405 | Method not allowed |
| `RequestTimeoutException` | 408 | Request timeout |
| `ConflictException` | 409 | Conflict |
| `GoneException` | 410 | Gone |
| `PreconditionFailedException` | 412 | Precondition failed |
| `PayloadTooLargeException` | 413 | Payload too large |
| `UnsupportedMediaTypeException` | 415 | Unsupported media type |
| `ValidationException` | 422 | Validation error |
| `UnprocessableEntityException` | 422 | Unprocessable entity |
| `LockedException` | 423 | Locked |
| `TooManyRequestsException` | 429 | Too many requests |
| `InternalServerErrorException` | 500 | Internal server error |
| `NotImplementedException` | 501 | Not implemented |
| `BadGatewayException` | 502 | Bad gateway |
| `ServiceUnavailableException` | 503 | Service unavailable |
| `GatewayTimeoutException` | 504 | Gateway timeout |

All exceptions extend `DomainException` and are automatically mapped to HTTP status codes and JSON error responses:

```typescript
import {
  NotFoundException,
  ConflictException,
  ForbiddenException
} from 'glasswork';

// In your service
if (!user) {
  throw new NotFoundException('User not found');
}

if (existingUser) {
  throw new ConflictException('Email already in use');
}

if (!canEdit) {
  throw new ForbiddenException('Cannot edit this resource');
}
```

## Custom Middleware

Apply custom middleware to specific routes:

```typescript
import { rateLimit } from './middleware/rate-limit';

router.post('/auth/login', ...route({
  summary: 'User login',
  public: true,
  middleware: [
    rateLimit({ maxRequests: 5, windowMs: 60000 }), // Max 5 attempts per minute
  ],
  body: LoginDto,
  responses: { 200: SessionDto },
  handler: ({ body }) => {
    return authService.login(body.email, body.password);
  },
}));
```

Middleware executes before validation:

1. Custom middleware
2. Body/query/params validation
3. Handler

## Public Routes

The `public` flag controls OpenAPI documentation generation:

```typescript
// Public route - OpenAPI spec includes it's accessible without auth
router.post('/auth/login', ...route({
  public: true,
  body: LoginDto,
  responses: { 200: SessionDto },
  handler: ({ body }) => {
    return authService.login(body.email, body.password);
  },
}));

// Protected route - OpenAPI spec includes auth requirement and 401 response
router.get('/profile', ...route({
  responses: { 200: UserProfileDto },
  handler: ({ session }) => {
    return userService.getProfile(session.userId);
  },
}));
```

::: warning Authentication is User-Implemented
The `public` flag only affects OpenAPI documentation (adds security schemes and 401 responses). **Glasswork does not handle authentication**. You must implement authentication yourself using middleware.
:::

### Implementing Authentication

Create a middleware to handle authentication:

```typescript
import { UnauthorizedException } from 'glasswork';

export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await validateToken(token);
    c.set('session', session);

    await next();
  };
}
```

Apply it to protected routes:

```typescript
router.get('/profile', ...route({
  middleware: [requireAuth()],
  responses: { 200: UserProfileDto },
  handler: ({ session }) => {
    // session is available from middleware
    return userService.getProfile(session!.userId);
  },
}));
```

## Excluding Routes from OpenAPI

You can exclude specific routes from the OpenAPI documentation using the `exclude` option:

```typescript
router.get('/internal/health', ...route({
  summary: 'Internal health check',
  openapi: {
    exclude: true
  },
  handler: () => {
    return { status: 'ok' };
  },
}));
```

This is useful for internal endpoints, webhooks, or other routes that shouldn't be exposed in your public API documentation.

## Advanced OpenAPI Features

### Deprecated Routes

Mark a route as deprecated in the OpenAPI spec:

```typescript
router.get('/old-endpoint', ...route({
  summary: 'Old endpoint',
  openapi: {
    deprecated: true
  },
  handler: () => { ... }
}));
```

### External Documentation

Link to external documentation:

```typescript
router.post('/payment', ...route({
  summary: 'Process payment',
  openapi: {
    docs: {
      url: 'https://stripe.com/docs/api',
      description: 'Stripe API documentation'
    }
  },
  handler: () => { ... }
}));
```

### Form Data Support

To handle `application/x-www-form-urlencoded` or `multipart/form-data` requests (e.g., file uploads), set `bodyType` to `'form'`:

```typescript
router.post('/upload', ...route({
  summary: 'Upload file',
  body: object({
    file: any(), // Use appropriate schema for file validation
    description: string()
  }),
  bodyType: 'form', // Enable form data parsing
  handler: async ({ body }) => {
    // body is parsed from form data
  }
}));
```

## Direct Hono Usage

You can always fall back to direct Hono for special cases:

```typescript
export const specialRoutes = createRoutes((router) => {
  // Mix Glasswork routes with direct Hono
  router.get('/health', (c) => c.text('OK'));

  router.get('/redirect', (c) => c.redirect('/new-path'));

  // Use Glasswork helper when you need validation
  router.post('/users', ...route({
    body: CreateUserDto,
    responses: { 201: UserResponseDto },
    handler: ({ body }) => userService.create(body),
  }));
});
```

## Response Serialization

Glasswork automatically serializes common data types before validation. This enables seamless integration with Prisma and other ORMs.

### Default Serialization

By default, Glasswork handles:

- **Date objects** → ISO 8601 strings
- **Decimal objects** (Prisma) → numbers

Serialization is **deep and recursive**, meaning nested objects and arrays are automatically traversed and transformed. This ensures that deeply nested relationships (e.g., `user.posts[0].createdAt`) are correctly serialized.

To prevent infinite loops with circular references, serialization has a **maximum depth of 20**. If your data structure is deeper than this, an error will be thrown.

```typescript
// Your handler can return Prisma objects directly
router.get('/users/:id', ...route({
  responses: { 200: UserResponseDto },
  handler: async ({ params }) => {
    // Prisma returns Date and Decimal objects
    const user = await prisma.user.findUnique({
      where: { id: params.id },
    });

    // Glasswork automatically converts:
    // - user.createdAt (Date) → ISO string
    // - user.balance (Decimal) → number
    return user;
  },
}));
```

### Date Field Detection

For type safety, Date objects are only accepted for string fields that follow common naming conventions:

| Pattern | Examples |
|---------|----------|
| `*At` | `createdAt`, `updatedAt`, `deletedAt`, `expiresAt` |
| `*Date` | `birthDate`, `startDate`, `endDate`, `effectiveDate` |
| `*Time` | `startTime`, `endTime` |
| `*Timestamp` | `loginTimestamp`, `lastModifiedTimestamp` |
| Standalone | `date`, `timestamp`, `datetime` |

```typescript
// ✅ Date accepted - field name matches pattern
return {
  createdAt: new Date(),  // Matches *At
  birthDate: new Date(),  // Matches *Date
};

// ❌ Type error - 'title' doesn't match date patterns
return {
  title: new Date(),  // Won't compile
};
```

::: tip Unconventional Date Field Names
If you have date fields with non-standard names, either:

1. Rename them to follow conventions (recommended)
2. Use `strictTypes: true` and handle serialization manually
:::

### Strict Types Mode

For stricter type safety or custom serialization requirements, enable `strictTypes`. This disables automatic serialization (like Date → string) and forces you to return data that exactly matches your schema types.

```typescript
router.get('/users/:id', ...route({
  strictTypes: true, // Disable automatic serialization
  responses: { 200: UserResponseDto },
  handler: async ({ params }) => {
    const user = await prisma.user.findUnique({
      where: { id: params.id },
    });

    // With strictTypes: true, returning 'user' directly would be a type error
    // because user.createdAt is a Date, but schema expects string.
    
    return {
      ...user,
      // You must handle serialization manually
      createdAt: user.createdAt.toISOString(),
      // Or use a custom format
      updatedAt: format(user.updatedAt, 'yyyy-mm-dd'),
    };
  },
}));
```

| Mode | Behavior |
|------|----------|
| `strictTypes: false` (default) | Accepts Prisma types, auto-serializes Date/Decimal |
| `strictTypes: true` | Disables auto-serialization, requires manual transformation |

### Custom Serialization

Add custom type transformers for domain-specific types:

```typescript
import type { TypeTransformer } from 'glasswork';

// Custom transformer for Money class
const moneyTransformer: TypeTransformer = (value: unknown) => {
  if (value instanceof Money) {
    return { amount: value.amount, currency: value.currency };
  }
  return undefined; // Let other transformers handle it
};

router.get('/products/:id', ...route({
  responses: { 200: ProductResponseDto },
  serialization: {
    transformers: [moneyTransformer], // Your transformers run first
  },
  handler: async ({ params }) => {
    return {
      id: params.id,
      name: 'Widget',
      price: new Money(99.99, 'USD'), // Auto-serialized
      createdAt: new Date(), // Still handled by default transformer
    };
  },
}));
```

Custom transformers are prepended to the default transformers, so they take precedence.

## Best Practices

### 1. Keep Handlers Thin

Routes should only validate and delegate to services:

```typescript
// ✅ Good: Thin handler
router.post('/users', ...route({
  body: CreateUserDto,
  responses: { 201: UserResponseDto },
  handler: ({ body, services }) => {
    return services.userService.create(body);
  },
}));

// ❌ Bad: Business logic in handler
router.post('/users', ...route({
  body: CreateUserDto,
  responses: { 201: UserResponseDto },
  handler: async ({ body }) => {
    // Don't put business logic here!
    const hashedPassword = await hash(body.password);
    const user = await prisma.user.create({
      data: { ...body, password: hashedPassword },
    });
    await emailService.sendWelcome(user.email);
    return user;
  },
}));
```

### 2. Define Schemas in Separate Files

Keep route files focused:

```typescript
// dto/create-user.dto.ts
export const CreateUserDto = object({
  email: pipe(string(), email()),
  password: pipe(string(), minLength(8)),
  name: string(),
});

// dto/user-response.dto.ts
export const UserResponseDto = object({
  id: string(),
  email: string(),
  name: string(),
  createdAt: string(),
});

// user.routes.ts
import { CreateUserDto, UserResponseDto } from './dto/index';
```

### 3. Validate Everything

Don't trust client input, validate all parameters:

```typescript
// ✅ Good: Validate path params
router.get('/users/:id', ...route({
  params: object({ id: pipe(string(), uuid()) }),
  // ...
}));

// ❌ Bad: Trusting params without validation
router.get('/users/:id', ...route({
  // No params validation!
  handler: async ({ params }) => {
    // params.id could be anything
    return userService.findById(params.id);
  },
}));
```

## Learn More

- [Valibot Documentation](https://valibot.dev/) - Comprehensive schema validation guide
- [Hono Documentation](https://hono.dev/) - Full Hono API reference
- [OpenAPI Guide](/guide/openapi) - How routes generate OpenAPI specs
