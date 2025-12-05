# Bootstrap Options

The `bootstrap()` function accepts a configuration object for framework-level options that control how your Glasswork application starts and behaves.

## Basic Usage

```typescript
import { bootstrap, isProduction } from 'glasswork';
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
import {
  isLambda,
  isProduction,
  isDevelopment,
  isTest,
} from 'glasswork';

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
import { bootstrap, createCloudWatchTracker } from 'glasswork';

const { app } = await bootstrap(AppModule, {
  logger: {
    pino: pino({ level: 'info' }),
  },
  exceptionTracking: {
    tracker: createCloudWatchTracker({ namespace: 'MyApp/Errors' }),
  },
});
```

## Learn More

- [Environment Config](/configuration/environment-config) - Application configuration with type-safe schemas
- [OpenAPI Guide](/request-handling/openapi) - Detailed OpenAPI configuration
- [Error Handling](/request-handling/error-handling) - Custom error handlers
