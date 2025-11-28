# Error Handling

Glasswork provides a error handling system that automatically maps domain exceptions to HTTP responses with consistent error formats.

## Overview

Error handling in Glasswork follows these principles:

1. **Domain exceptions** - Throw specific exceptions in your services
2. **Automatic mapping** - Exceptions map to HTTP status codes
3. **Consistent format** - All errors return the same JSON structure
4. **Production safety** - Internal errors don't leak sensitive information

## Domain Exceptions

Throw domain exceptions in your services to signal errors:

```typescript
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException
} from 'glasswork';

export class UserService {
  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(data: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email }
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    return this.prisma.user.create({ data });
  }

  async delete(id: string, requestingUserId: string) {
    const user = await this.findById(id);

    if (user.id !== requestingUserId && !this.isAdmin(requestingUserId)) {
      throw new ForbiddenException('Cannot delete other users');
    }

    return this.prisma.user.delete({ where: { id } });
  }
}
```

## Available Exceptions

All exceptions extend `DomainException` and include a message and error code:

| Exception | Status | Code | Default Message |
|-----------|--------|------|-----------------|
| `BadRequestException` | 400 | BAD_REQUEST | Bad request |
| `UnauthorizedException` | 401 | UNAUTHORIZED | Unauthorized |
| `ForbiddenException` | 403 | FORBIDDEN | Forbidden |
| `NotFoundException` | 404 | NOT_FOUND | Not found |
| `MethodNotAllowedException` | 405 | METHOD_NOT_ALLOWED | Method not allowed |
| `RequestTimeoutException` | 408 | REQUEST_TIMEOUT | Request timeout |
| `ConflictException` | 409 | CONFLICT | Conflict |
| `GoneException` | 410 | GONE | Gone |
| `PreconditionFailedException` | 412 | PRECONDITION_FAILED | Precondition failed |
| `PayloadTooLargeException` | 413 | PAYLOAD_TOO_LARGE | Payload too large |
| `UnsupportedMediaTypeException` | 415 | UNSUPPORTED_MEDIA_TYPE | Unsupported media type |
| `ValidationException` | 422 | VALIDATION_ERROR | Validation error |
| `UnprocessableEntityException` | 422 | UNPROCESSABLE_ENTITY | Unprocessable entity |
| `LockedException` | 423 | LOCKED | Locked |
| `TooManyRequestsException` | 429 | TOO_MANY_REQUESTS | Too many requests |
| `InternalServerErrorException` | 500 | INTERNAL_SERVER_ERROR | Internal server error |
| `NotImplementedException` | 501 | NOT_IMPLEMENTED | Not implemented |
| `BadGatewayException` | 502 | BAD_GATEWAY | Bad gateway |
| `ServiceUnavailableException` | 503 | SERVICE_UNAVAILABLE | Service unavailable |
| `GatewayTimeoutException` | 504 | GATEWAY_TIMEOUT | Gateway timeout |

## Error Response Format

### Standard Errors

All non-validation errors return this format:

```json
{
  "error": "User not found"
}
```

### Validation Errors (422)

Validation failures include detailed issues:

```json
{
  "error": "Validation failed",
  "issues": [
    {
      "message": "Invalid email format",
      "path": ["email"]
    },
    {
      "message": "Password must be at least 8 characters",
      "path": ["password"]
    }
  ]
}
```

## Custom Error Handler

Create a custom error handler to modify error responses:

```typescript
import { bootstrap, createErrorHandler, isDevelopment } from 'glasswork';

const customErrorHandler = createErrorHandler({
  // Log errors in development
  logErrors: isDevelopment(),

  // Custom response format
  responseHandler: (error, context) => {
    return context.json({
      success: false,
      error: {
        message: error.message,
        code: error.statusCode,
        timestamp: new Date().toISOString(),
        requestId: context.get('requestId'),
      },
    }, error.statusCode);
  },
});

const { app } = bootstrap(AppModule, {
  errorHandler: customErrorHandler,
});
```

### Disable Error Handler

If you want to handle errors entirely yourself:

```typescript
const { app } = bootstrap(AppModule, {
  errorHandler: false, // Disable default handler
});

// Add your own error handler
app.onError((err, c) => {
  // Your custom error handling
  return c.json({ error: err.message }, 500);
});
```

## Error Handling in Routes

Errors thrown in route handlers are automatically caught:

```typescript
router.get('/users/:id', ...route({
  params: object({ id: string() }),
  responses: {
    200: UserDto,
    404: ErrorResponseDto, // Document error response
  },
  handler: async ({ params }) => {
    const user = await userService.findById(params.id);
    // If NotFoundException is thrown, returns 404 automatically
    return user;
  },
}));
```

## Error DTOs for OpenAPI

Import error DTOs to document error responses in OpenAPI:

```typescript
import { ErrorResponseDto, ValidationErrorResponseDto } from 'glasswork';

router.post('/users', ...route({
  body: CreateUserDto,
  responses: {
    201: UserDto,
    400: ErrorResponseDto,      // Bad request
    409: ErrorResponseDto,      // Conflict (email exists)
    422: ValidationErrorResponseDto, // Validation failed
  },
  handler: ({ body }) => {
    return userService.create(body);
  },
}));
```

::: tip Automatic Error Responses
Glasswork automatically adds these error responses to the OpenAPI spec:

- `422` - When validation schemas are configured
- `401` - When `public: false` (default)
- `500` - Always included

You only need to explicitly add custom error responses like `404` or `409`.
:::

## Creating Custom Exceptions

Extend `DomainException` for domain-specific errors:

```typescript
import { DomainException } from 'glasswork';

export class InsufficientFundsException extends DomainException {
  constructor(
    public readonly balance: number,
    public readonly required: number
  ) {
    super(
      `Insufficient funds: balance ${balance}, required ${required}`,
      'INSUFFICIENT_FUNDS'
    );
  }
}

// Register the status code mapping
// In your error handler setup:
const statusCodeMap: Record<string, number> = {
  INSUFFICIENT_FUNDS: 402, // Payment Required
};
```

Or use existing exceptions with custom messages:

```typescript
// Preferred: use existing exceptions with specific messages
throw new BadRequestException('Insufficient funds in account');
throw new ConflictException('Transaction already processed');
throw new ForbiddenException('Account is frozen');
```

## Error Handling Best Practices

### 1. Use Specific Exceptions

```typescript
// ✅ Good - specific exception
if (!user) {
  throw new NotFoundException('User not found');
}

// ❌ Bad - generic error
if (!user) {
  throw new Error('User not found');
}
```

### 2. Include Helpful Messages

```typescript
// ✅ Good - helpful message
throw new NotFoundException(`User with ID ${id} not found`);

// ❌ Bad - generic message
throw new NotFoundException('Not found');
```

### 3. Don't Leak Sensitive Information

```typescript
// ✅ Good - generic message for security
if (!user || !validPassword) {
  throw new UnauthorizedException('Invalid credentials');
}

// ❌ Bad - reveals which field is wrong
if (!user) {
  throw new UnauthorizedException('User not found');
}
if (!validPassword) {
  throw new UnauthorizedException('Invalid password');
}
```

### 4. Handle Errors at the Right Level

```typescript
// ✅ Good - service handles domain logic
class PaymentService {
  async charge(userId: string, amount: number) {
    const user = await this.userService.findById(userId);

    if (user.balance < amount) {
      throw new BadRequestException('Insufficient funds');
    }

    // Process payment...
  }
}

// ❌ Bad - route handles domain logic
router.post('/charge', ...route({
  handler: async ({ body }) => {
    const user = await userService.findById(body.userId);

    if (user.balance < body.amount) {
      throw new BadRequestException('Insufficient funds');
    }

    // This should be in a service!
  },
}));
```

### 5. Log Appropriately

```typescript
// Internal errors should be logged
try {
  await externalApi.call();
} catch (error) {
  logger.error('External API call failed', { error });
  throw new ServiceUnavailableException('Service temporarily unavailable');
}

// User errors don't need logging
if (!user) {
  throw new NotFoundException('User not found'); // No logging needed
}
```

## Production vs Development

| Behavior | Development | Production |
|----------|-------------|------------|
| Error logging | Enabled | 500 errors only |
| Stack traces | In console | Never exposed |
| Error messages | Detailed | From exceptions |
| Unhandled errors | Full details | "Internal server error" |

## Decoupling Services

A core philosophy of Glasswork is keeping services decoupled from the framework. However, you might notice that our examples often throw Glasswork exceptions (like `NotFoundException`) directly in services.

This presents a trade-off between **pragmatism** and **strict purity**.

### Strategy 1: Pragmatic (Recommended)

Use Glasswork exceptions in your services.

- **Pros**: Zero boilerplate, automatic HTTP mapping, consistent error responses.
- **Cons**: Services import from `glasswork`.
- **Why it's okay**: Glasswork exceptions are simple classes extending `Error`. They don't carry runtime overhead or side effects. Importing them doesn't couple your logic to the HTTP layer or Hono context, only to a set of standard error definitions.

```typescript
// service.ts
import { NotFoundException } from 'glasswork';

class UserService {
  findById(id: string) {
    if (!found) throw new NotFoundException('User not found');
  }
}
```

### Strategy 2: Strict Purity

Define your own error classes to keep services 100% framework-free.

- **Pros**: Services have zero external dependencies.
- **Cons**: Requires defining error classes and mapping them manually.

```typescript
// errors/user-not-found.error.ts
export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`User ${id} not found`);
    this.name = 'UserNotFoundError';
  }
}

// service.ts
// No imports from glasswork!
import { UserNotFoundError } from './errors/user-not-found.error';

class UserService {
  findById(id: string) {
    if (!found) throw new UserNotFoundError(id);
  }
}
```

Then, map these errors in a custom error handler:

```typescript
// error-handler.ts
const errorHandler = createErrorHandler({
  responseHandler: (error, c) => {
    // Map custom errors to HTTP status codes
    if (error instanceof UserNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    
    // Fallback to default handling
    return defaultResponseHandler(error, c);
  }
});
```
