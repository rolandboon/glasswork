---
description: Bootstrap configuration options for Glasswork applications, including OpenAPI, CORS, logging, and Lambda adapter settings.
---

# Bootstrap Options

The `bootstrap()` function accepts a configuration object for framework-level options that control how your Glasswork application starts and behaves.

## Basic Usage

```typescript
import { bootstrap, isProduction } from 'glasswork/core';
import { AppModule } from './app.module';

const { app, container } = await bootstrap(AppModule, {
  // API base path (default: '/api')
  apiBasePath: '/api/v1',

  // Environment (auto-detected from NODE_ENV)
  environment: 'production',

  // Error handling
  errorHandler: customErrorHandler,

  // OpenAPI configuration
  openapi: {
    enabled: true,
    serveSpecs: !isProduction(),
    serveUI: !isProduction(),
    documentation: {
      info: {
        title: 'My API',
        version: '1.0.0',
      },
    },
  },

  // Rate limiting
  rateLimit: {
    enabled: true,
    storage: isProduction() ? 'dynamodb' : 'memory',
    windowMs: 60000,
    maxRequests: 100,
    dynamodb: {
      tableName: 'rate-limits',
      region: 'us-east-1',
    },
  },

  // Common middleware
  middleware: {
    requestId: true,
    secureHeaders: true,
    cors: {
      origin: 'https://example.com',
      credentials: true,
    },
  },

  // Logging
  logger: {
    enabled: true,
  },

  // Debug mode
  debug: false,
});
```

## Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiBasePath` | `string` | `'/api'` | Base path for API routes |
| `environment` | `string` | Auto-detected | Environment (development/production/test) |
| `errorHandler` | `ErrorHandler \| false` | Default handler | Custom error handler or disable |
| `openapi` | `OpenAPIOptions` | `undefined` | OpenAPI configuration |
| `rateLimit` | `RateLimitOptions` | `undefined` | Rate limiting configuration |
| `middleware` | `MiddlewareOptions` | `undefined` | Common middleware options |
| `logger` | `LoggerOptions` | `undefined` | Logger configuration |
| `debug` | `boolean` | `false` | Enable debug logging |

## Environment Detection

Use built-in environment helpers for conditional configuration:

```typescript
import { isLambda, isProduction, isDevelopment, isTest } from 'glasswork/core';

// Conditional configuration
const { app } = await bootstrap(AppModule, {
  openapi: {
    enabled: true,
    serveSpecs: isDevelopment(), // Only in development
    serveUI: isDevelopment(),
  },
  rateLimit: {
    enabled: true,
    storage: isProduction() ? 'dynamodb' : 'memory',
    dynamodb: isProduction()
      ? { tableName: process.env.RATE_LIMIT_TABLE!, region: process.env.AWS_REGION }
      : undefined,
  },
  logger: {
    enabled: !isTest(), // Disable in tests
  },
});
```

**Environment detection:**

- `isLambda()` - Checks for Lambda environment variables
- `isProduction()` - `NODE_ENV=production` or Lambda
- `isDevelopment()` - Not production and not test
- `isTest()` - `NODE_ENV=test`

## Observability Options

For logging and exception tracking configuration, see the dedicated guides:

- [Observability Guide](/observability/overview) - Complete setup with automatic request ID correlation
- [Logging Guide](/observability/logging) - Pino integration and structured logging
- [Exception Tracking](/observability/exception-tracking) - CloudWatch, Sentry, AppSignal integration

### Quick Example

```typescript
import pino from 'pino';
import { bootstrap } from 'glasswork/core';
import { createCloudWatchTracker } from 'glasswork/observability';

const { app } = await bootstrap(AppModule, {
  logger: {
    pino: pino({ level: 'info' }),
  },
  exceptionTracking: {
    tracker: createCloudWatchTracker({ namespace: 'MyApp/Errors' }),
  },
});
```

## Replacing Providers in Tests

Use `providerOverrides` to replace a module's provider for one bootstrap. For
example, you can use a test database instead of the application's database:

```typescript
const { app } = await bootstrap(AppModule, {
  environment: 'test',
  providerOverrides: [{ provide: 'database', useValue: testDatabase }],
});
```

Overrides use the same `provide`, `useValue`, `useFactory`, and `useClass`
options as module providers. Glasswork applies them before initializing providers.
The original module stays unchanged, so another test can use different overrides.

## Generating OpenAPI Without Starting the Application

Use `generateOpenAPI()` to build an OpenAPI document from your routes without
starting the application. This is useful in CI, where you may not have a database
or credentials for external services.

```typescript
import { generateOpenAPI } from 'glasswork/core';
import { assertOpenAPIMatches } from 'glasswork/http';
import { AppModule } from './app.module';

const document = await generateOpenAPI(AppModule);
await assertOpenAPIMatches(document, './openapi.json');
```

`assertOpenAPIMatches()` compares the document's JSON content with the saved file.
It throws if they differ and leaves the file unchanged. Your application decides
where to save the file and how to regenerate it.

### What Runs During Generation

Glasswork registers your routes with Hono to read their OpenAPI definitions. It
does not initialize application providers, run request handlers, or call lifecycle
hooks. Internally, this uses `mode: 'contract'`; a bootstrap in this mode cannot
serve HTTP requests or start the application's lifecycle.

Route handlers can still refer to services, because those handlers are not called
during generation. If the route setup itself reads a provider, such as configuration
used in a route description, supply that provider through a `useValue` override.
Only `useValue` overrides are allowed in contract mode.

Your module imports still run. Keep database connections and other external calls
out of module-level code, route setup, and the override values you supply.

## Learn More

- [Environment Config](/configuration/environment-config) - Application configuration with type-safe schemas
- [OpenAPI Guide](/request-handling/openapi) - Detailed OpenAPI configuration
- [Error Handling](/request-handling/error-handling) - Custom error handlers
