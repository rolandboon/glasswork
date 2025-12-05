# Middleware

Middleware functions are functions that have access to the request object (`c.req`), the response object (`c.res`), and the `next` function in the application’s request-response cycle.

Glasswork is built on top of [Hono](https://hono.dev/), which means you can use any Hono middleware directly. This provides a powerful and flexible way to handle cross-cutting concerns like authentication, logging, and error handling.

## Using Middleware

You can apply middleware in two ways: globally or per-route.

### Global Middleware

Global middleware is applied to all routes. This is typically done in your main application entry point (e.g., `app.ts` or `main.ts`) before defining routes.

```typescript
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

const app = new Hono();

// Apply to all routes
app.use('*', logger());
app.use('*', cors());
```

### Per-Route Middleware

You can apply middleware to specific routes using the `middleware` property in the `route()` configuration.

```typescript
import { cache } from 'hono/cache';

router.get('/stats', ...route({
  summary: 'Get statistics',
  middleware: [
    cache({ cacheName: 'stats', cacheControl: 'max-age=3600' })
  ],
  responses: { 200: StatsDto },
  handler: async () => {
    return statsService.getStats();
  },
}));
```

## Concepts

If you are coming from frameworks like NestJS, you might be familiar with concepts like Guards, Interceptors, and Exception Filters. In Glasswork (and Hono), these are all implemented as **Middleware**.

### Guards

Guards are responsible for determining whether a request should be handled by the route handler or not. They are typically used for authentication and authorization.

In Glasswork, a "Guard" is simply a middleware that checks a condition and throws an exception if it fails.

```typescript
import type { MiddlewareHandler } from 'hono';
import { UnauthorizedException, ForbiddenException } from 'glasswork';

// Auth Guard
export const authGuard = (): MiddlewareHandler => {
  return async (c, next) => {
    const token = c.req.header('Authorization');
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }
    
    // Validate token logic...
    const user = await validateToken(token);
    c.set('user', user); // Attach user to context

    await next();
  };
};

// Role Guard
export const rolesGuard = (...roles: string[]): MiddlewareHandler => {
  return async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await next();
  };
};
```

Usage:

```typescript
router.get('/admin', ...route({
  middleware: [authGuard(), rolesGuard('admin')],
  // ...
}));
```

### Interceptors

Interceptors have a set of useful capabilities which are inspired by the [Aspect Oriented Programming](https://en.wikipedia.org/wiki/Aspect-oriented_programming) (AOP) technique. They make it possible to:

- bind extra logic before / after method execution
- transform the result returned from a function
- transform the exception thrown from a function

In Glasswork, you achieve this by wrapping the `await next()` call.

```typescript
import type { MiddlewareHandler } from 'hono';

export const loggingInterceptor = (): MiddlewareHandler => {
  return async (c, next) => {
    console.log(`Before...`);
    
    const start = Date.now();
    await next(); // Execute the handler
    const ms = Date.now() - start;
    
    console.log(`After... ${ms}ms`);
    c.header('X-Response-Time', `${ms}ms`);
  };
};
```

To transform the response, you can modify `c.res` after `await next()`, but be aware that if the response is already sent, you might be limited. Hono's context allows setting headers and modifying the response object.

### Exception Filters

Exception filters are responsible for catching unhandled exceptions and formatting the response.

Glasswork has a built-in global exception filter that handles `DomainException`s (like `NotFoundException`, `BadRequestException`) and validation errors automatically.

However, you can create custom error handling middleware or use Hono's `onError` hook.

**Custom Error Middleware:**

```typescript
app.onError((err, c) => {
  if (err instanceof CustomDatabaseError) {
    return c.json({
      error: 'Database Error',
      message: err.message
    }, 500);
  }
  
  // Fallback to default handling
  throw err;
});
```

Or as a middleware that wraps execution:

```typescript
export const errorFilter = (): MiddlewareHandler => {
  return async (c, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof MyCustomError) {
        return c.json({ custom: 'error' }, 400);
      }
      throw err; // Re-throw for other handlers
    }
  };
};
```

## Built-in Middleware

Hono comes with a rich set of built-in middleware that you can use out of the box.

- **[Basic Auth](https://hono.dev/docs/middleware/builtin/basic-auth)**: Basic authentication.
- **[Bearer Auth](https://hono.dev/docs/middleware/builtin/bearer-auth)**: Bearer token authentication.
- **[Compress](https://hono.dev/docs/middleware/builtin/compress)**: Gzip/Deflate compression.
- **[CORS](https://hono.dev/docs/middleware/builtin/cors)**: Cross-Origin Resource Sharing.
- **[ETag](https://hono.dev/docs/middleware/builtin/etag)**: ETag generation.
- **[Logger](https://hono.dev/docs/middleware/builtin/logger)**: Request logging.
- **[Pretty JSON](https://hono.dev/docs/middleware/builtin/pretty-json)**: Pretty print JSON responses.
- **[Secure Headers](https://hono.dev/docs/middleware/builtin/secure-headers)**: Security headers (Helmet equivalent).
- **[Timeout](https://hono.dev/docs/middleware/builtin/timeout)**: Request timeout.

Refer to the [Hono Middleware Documentation](https://hono.dev/docs/middleware/builtin/basic-auth) for the complete list and usage details.

## Creating Custom Middleware

You can create any custom middleware by defining a function that returns a `MiddlewareHandler`.

```typescript
import type { MiddlewareHandler } from 'hono';

export function myMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // 1. Logic before handler
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    
    // 2. Pass control to next middleware/handler
    await next();
    
    // 3. Logic after handler
    // (e.g., logging, cleanup)
  };
}
```

### Extending Context

If your middleware sets custom variables on the context (like `user` or `requestId`), remember to extend the Hono type definition so TypeScript knows about them.

```typescript
// src/types.d.ts or similar
import 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    user: { id: string; role: string };
  }
}
```

Now `c.get('requestId')` and `c.get('user')` will be strongly typed.

Furthermore, Glasswork automatically exposes these context variables in the route handler's argument object, allowing for direct destructuring:

```typescript
router.get('/me', ...route({
  middleware: [myMiddleware()],
  responses: { 200: UserDto },
  handler: ({ user, requestId }) => {
    // user and requestId are directly available and typed
    console.log(requestId);
    return user;
  },
}));
```
