---
description: Curated API reference for Glasswork 1.0 subpath exports.
---

# API Reference

**Manually curated** reference of public APIs exported by Glasswork — maintained alongside the source code, not generated from TypeDoc or other automation.

Since 1.0, exports are organized as **subpath modules** — import from `glasswork/core`, `glasswork/http`, and optional subpaths for auth, email, jobs, uploads, list-query, and observability.

:::: tip Package exports
See [Package Exports](/getting-started/package-exports) for the full subpath table, peer dependencies, and migration from 0.x.
::::

The root `glasswork` entry re-exports **core + http** only. Examples below use explicit subpaths.

## `glasswork/core`

Core bootstrap, modules, configuration, and utilities.

### Bootstrap

```typescript
import { bootstrap } from 'glasswork/core';

const { app, container, start, stop } = await bootstrap(AppModule, options);
```

| Function | Description |
|----------|-------------|
| `bootstrap(module, options?)` | Bootstrap the application with modules |

**Returns:** `{ app: Hono, container: AwilixContainer, start(): Promise<void>, stop(): Promise<void> }`

**Options (most common)**:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiBasePath` | `string` | `'/api'` | Prefix for all routes |
| `environment` | `'development' \| 'production' \| 'test'` | auto-detected | Controls logging + OpenAPI defaults |
| `openapi.enabled` | `boolean` | `false` | Generate spec + serve UI/spec when true |
| `openapi.documentation` | `OpenAPIDocumentation` | - | Info, servers, tags |
| `middleware` | `MiddlewareOptions` | - | `requestId`, `secureHeaders`, `cors` |
| `rateLimit` | `RateLimitOptions` | - | Configure per-route/global rate limiting |
| `logger` | `LoggerOptions` | - | Enable/disable logging or inject Pino instance |
| `errorHandler` | `ErrorHandler \| false` | default handler | Replace or disable default error mapping |

See [Getting Started](/getting-started/quick-start) and [Bootstrap Options](/configuration/bootstrap) for full examples. `bootstrap` is async because it resolves providers and lifecycle hooks before returning.

### Exception Tracking

```typescript
const { app } = await bootstrap(AppModule, {
  exceptionTracking: {
    tracker: createCloudWatchTracker(),
    trackStatusCodes: (status) => status >= 500,
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tracker` | `ExceptionTracker` | `createConsoleTracker()` in dev, none otherwise | Destination for captured exceptions |
| `trackStatusCodes` | `(status: number) => boolean` | `status >= 500` | Decide which responses are tracked |

### Middleware & Context

```typescript
const { app } = await bootstrap(AppModule, {
  middleware: { requestId: true, secureHeaders: true, cors: false },
  logger: { enabled: true }, // uses pino if provided
});
```

| Option | Default | Notes |
|--------|---------|-------|
| `middleware.requestId` | `true` | Adds request ID + AsyncLocalStorage context |
| `middleware.secureHeaders` | `true` | Hono secure headers |
| `middleware.cors` | `false` | Pass CORS options to enable |
| `logger` | disabled | Provide `{ pino }` for structured logs |

### Versions

- Node.js: 20+ (ESM, top-level await)
- TypeScript: strict mode recommended
- Glasswork examples align with Valibot v0.29+ and hono-openapi 0.15+

### Modules

```typescript
import { defineModule } from 'glasswork/core';

const MyModule = defineModule({
  name: 'myModule',
  basePath: 'my-module',
  providers: [...],
  routes: myRoutes,
  imports: [...],
  exports: [...],
});
```

| Function | Description |
|----------|-------------|
| `defineModule(config)` | Define a module configuration |

See [Modules](/application-structure/modules) for detailed documentation.

### Routes

```typescript
import { createRoutes, route } from 'glasswork/http';

const myRoutes = createRoutes<{ myService: MyService }>((router, services, route) => {
  router.get('/', ...route({
    summary: 'My endpoint',
    responses: { 200: ResponseDto },
    handler: async () => { ... },
  }));
});
```

| Function | Description |
|----------|-------------|
| `createRoutes<TServices>(factory)` | Create a route factory with typed services |
| `route(config)` | Create a type-safe route with validation |

**Route config** (common keys):

| Key | Type | Description |
|-----|------|-------------|
| `summary` | `string` | Short description for OpenAPI |
| `description` | `string?` | Longer description |
| `tags` | `string[]?` | OpenAPI tags |
| `public` | `boolean` | Adds/omits auth docs + 401 |
| `body/query/params` | `ValibotSchema` | Request validation |
| `responses` | `Record<number, Schema>` | Response schema per status |
| `middleware` | `MiddlewareHandler[]?` | Per-route middleware |
| `handler` | `(ctx: RouteContext) => any` | Async or sync handler |
| `openapi` | `{ exclude?: boolean; deprecated?: boolean; docs?: { url: string; description?: string } }` | OpenAPI overrides |
| `bodyType` | `'json' \| 'form'` | Request body parsing mode |
| `strictTypes` | `boolean` | Require exact types, disable auto-serialization |

See [Routes & Validation](/request-handling/routes) for detailed documentation.

### Configuration

```typescript
import { createConfig, envProvider, dotenvProvider, objectProvider, ssmProvider, toCamelCase, toSnakeCase, parseBoolean, parseJson, parseArray } from 'glasswork/core';
```

| Function | Description |
|----------|-------------|
| `createConfig(options)` | Create a validated configuration service |
| `envProvider(options?)` | Load config from environment variables |
| `dotenvProvider(options?)` | Load config from .env files |
| `objectProvider(values)` | Provide config from an object |
| `ssmProvider(options)` | Load config from AWS SSM Parameter Store |
| `toCamelCase(key)` | Transform SNAKE_CASE to camelCase |
| `toSnakeCase(key)` | Transform camelCase to SNAKE_CASE |
| `parseBoolean(value)` | Parse boolean from string |
| `parseJson(value)` | Parse JSON from string |
| `parseArray(value)` | Parse comma-separated array from string |

See [Environment Config](/configuration/environment-config) for detailed documentation.

## `glasswork/http`

Routes, validation, errors, OpenAPI helpers, and rate limiting.

### HTTP & Errors

### Exceptions

```typescript
import { BadRequestException, UnauthorizedException, ForbiddenException, NotFoundException, ConflictException, ValidationException, InternalServerErrorException } from 'glasswork/http';

throw new NotFoundException('User not found');
```

See [Error Handling](/request-handling/error-handling) for all available exceptions.

### Error Handler

```typescript
import { createErrorHandler, defaultErrorHandler } from 'glasswork/http';

const customHandler = createErrorHandler({
  logErrors: true,
  responseHandler: (error, context) => { ... },
});
```

| Function | Description |
|----------|-------------|
| `createErrorHandler(options?)` | Create a custom error handler |
| `defaultErrorHandler` | Default error handler instance |

### Error DTOs

```typescript
import { ErrorResponseDto, ValidationErrorResponseDto } from 'glasswork/http';
```

| Schema | Description |
|--------|-------------|
| `ErrorResponseDto` | Standard error response schema |
| `ValidationErrorResponseDto` | Validation error with issues |

## `glasswork/list-query`

Filtering, sorting, pagination, and optional CASL integration.

```typescript
import { createListQuery, ListQuerySchema, createFilterSchema, createSortSchema, stringFilterSchema, numberFilterSchema, dateFilterSchema, booleanFilterSchema, enumFilterSchema, relationFilterSchema, sortDirectionSchema } from 'glasswork/list-query';
```

| Function | Description |
|----------|-------------|
| `createListQuery(config)` | Create a list query builder |
| `ListQuerySchema` | Valibot schema for query parameters |
| `createFilterSchema(fields)` | Create a filter schema |
| `createSortSchema(fields)` | Create a sort schema |
| `stringFilterSchema()` | Schema for string filters |
| `numberFilterSchema()` | Schema for number filters |
| `dateFilterSchema()` | Schema for date filters |
| `booleanFilterSchema()` | Schema for boolean filters |
| `enumFilterSchema(schema)` | Schema for enum filters |
| `relationFilterSchema(schema)` | Schema for relation filters |
| `sortDirectionSchema()` | Schema for sort direction |

See [List Query](/request-handling/list-query) for detailed documentation.

## OpenAPI

```typescript
import { configureOpenAPI, defaultOpenAPIComponents } from 'glasswork/http';
```

| Function | Description |
|----------|-------------|
| `configureOpenAPI(options)` | Configure OpenAPI for an app |
| `defaultOpenAPIComponents` | Default OpenAPI component definitions |

### Response Processors

```typescript
import { applyProcessors, createBuiltinProcessors, createCorsHeadersProcessor, createRateLimitHeadersProcessor, paginationHeadersProcessor, responseHeadersProcessor } from 'glasswork/http';
```

See [OpenAPI](/request-handling/openapi) for detailed documentation.

## Middleware

```typescript
import { createRateLimitMiddleware } from 'glasswork/http';
```

| Function | Description |
|----------|-------------|
| `createRateLimitMiddleware(options)` | Create rate limiting middleware |

### Utilities

#### Environment Detection

```typescript
import { isLambda, isProduction, isDevelopment, isTest } from 'glasswork/core';

if (isLambda()) {
  // Running in AWS Lambda
}

if (isProduction()) {
  // Production environment (NODE_ENV=production or Lambda)
}

if (isDevelopment()) {
  // Development environment
}

if (isTest()) {
  // Test environment (NODE_ENV=test)
}
```

| Function | Description |
|----------|-------------|
| `isLambda()` | Check if running in AWS Lambda |
| `isProduction()` | Check if production environment |
| `isDevelopment()` | Check if development environment |
| `isTest()` | Check if test environment |

#### Logging

```typescript
import { createLogger, createPlainLogger, defaultLogger } from 'glasswork/core';

const logger = createLogger('MyService');
logger.info('Message', { context: 'data' });
logger.error('Error occurred', error);
```

| Function | Description |
|----------|-------------|
| `createLogger(name, debug?)` | Create a logger with prefix |
| `createPlainLogger()` | Create a plain logger for Lambda |
| `defaultLogger` | Default logger instance |

#### Object Utilities

```typescript
import { deepMerge, omit, pick } from 'glasswork/core';

const merged = deepMerge(obj1, obj2);
const subset = pick(obj, ['key1', 'key2']);
const filtered = omit(obj, ['sensitiveKey']);
```

| Function | Description |
|----------|-------------|
| `deepMerge(target, source)` | Deep merge two objects |
| `pick(obj, keys)` | Pick specific keys from object |
| `omit(obj, keys)` | Omit specific keys from object |

#### IP Detection

```typescript
import { getClientIp } from 'glasswork/core';

const ip = getClientIp(context);
```

| Function | Description |
|----------|-------------|
| `getClientIp(context)` | Get client IP from request |

#### Prisma Serialization

```typescript
import { serializePrismaTypes, defaultConfig } from 'glasswork/core';

const serialized = serializePrismaTypes(prismaObject);
```

| Function | Description |
|----------|-------------|
| `serializePrismaTypes(data, config?)` | Serialize Prisma types to JSON-safe values |
| `defaultConfig` | Default serialization configuration |

### Types

#### Core Types

```typescript
import { type BootstrapOptions, type BootstrapResult, type ModuleConfig, type ProviderConfig, type Constructor, type ServiceScope, type Environment } from 'glasswork/core';
import { type RouteFactory, type RouteConfig, type RouteContext } from 'glasswork/http';
```

#### OpenAPI Types

```typescript
import { type OpenAPIOptions, type OpenAPIDocumentation, type OpenAPIResponseProcessor, type OpenAPIProcessorContext, type OpenAPIResponseObject } from 'glasswork/core';
```

#### List Query Types

```typescript
import { type ListQueryBuilder, type ListQueryConfig, type PaginatedResult, type ParsedQueryParams, type PrismaListParams, type FilterOperator, type SortDirection, type AggregationConfig, type AggregationResult } from 'glasswork/list-query';
```

### Re-exported Types

```typescript
import { type AwilixContainer } from 'glasswork/core';
import { type Hono, type ErrorHandler } from 'glasswork/http';
import { type OpenAPIV3 } from 'glasswork/http';
```

## Optional subpaths

Import these only when you use the feature. Each has dedicated documentation.

| Subpath | Documentation |
| ------- | ------------- |
| `glasswork/auth` | [Auth](/auth/getting-started), [Abilities](/auth/abilities) |
| `glasswork/email` | [Email](/email/getting-started), [API](/email/api) |
| `glasswork/jobs` | [Jobs](/jobs/getting-started) |
| `glasswork/uploads` | [Uploads](/uploads/getting-started) |
| `glasswork/observability` | [Observability](/observability/overview) |

## Bootstrap Options Reference

```typescript
interface BootstrapOptions {
  // API base path (default: '/api')
  apiBasePath?: string;

  // Environment (auto-detected)
  environment?: 'development' | 'production' | 'test';

  // Error handling
  errorHandler?: ErrorHandler | false;

  // OpenAPI configuration
  openapi?: {
    enabled?: boolean;
    serveSpecs?: boolean;
    serveUI?: boolean;
    writeToFile?: string;
    responseProcessors?: OpenAPIResponseProcessor[];
    documentation?: OpenAPIDocumentation;
  };

  // Rate limiting
  rateLimit?: {
    enabled?: boolean;
    storage?: 'memory' | 'dynamodb';
    windowMs?: number;
    maxRequests?: number;
    dynamodb?: {
      tableName: string;
      region?: string;
    };
  };

  // Middleware
  middleware?: {
    requestId?: boolean;
    secureHeaders?: boolean;
    cors?: CorsOptions | false;
  };

  // Logging
  logger?: {
    enabled?: boolean;
    plain?: boolean;
  };

  // Debug mode
  debug?: boolean;
}
```

