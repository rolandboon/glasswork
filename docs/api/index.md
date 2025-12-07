# API Reference

This section provides a complete reference of all public APIs exported by Glasswork.

## Core

### Bootstrap

```typescript
import { bootstrap } from 'glasswork';

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
import { defineModule } from 'glasswork';

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
import { createRoutes, route } from 'glasswork';

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

## Configuration

```typescript
import {
  createConfig,
  envProvider,
  dotenvProvider,
  objectProvider,
  ssmProvider,
  toCamelCase,
  toSnakeCase,
  parseBoolean,
  parseJson,
  parseArray,
} from 'glasswork';
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

## HTTP & Errors

### Exceptions

```typescript
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  ValidationException,
  InternalServerErrorException,
  // ... and more
} from 'glasswork';

throw new NotFoundException('User not found');
```

See [Error Handling](/request-handling/error-handling) for all available exceptions.

### Error Handler

```typescript
import { createErrorHandler, defaultErrorHandler } from 'glasswork';

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
import { ErrorResponseDto, ValidationErrorResponseDto } from 'glasswork';
```

| Schema | Description |
|--------|-------------|
| `ErrorResponseDto` | Standard error response schema |
| `ValidationErrorResponseDto` | Validation error with issues |

## List Query

```typescript
import {
  createListQuery,
  ListQuerySchema,
  createFilterSchema,
  createSortSchema,
  stringFilterSchema,
  numberFilterSchema,
  dateFilterSchema,
  booleanFilterSchema,
  enumFilterSchema,
  relationFilterSchema,
  sortDirectionSchema,
} from 'glasswork';
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
import { configureOpenAPI, defaultOpenAPIComponents } from 'glasswork';
```

| Function | Description |
|----------|-------------|
| `configureOpenAPI(options)` | Configure OpenAPI for an app |
| `defaultOpenAPIComponents` | Default OpenAPI component definitions |

### Response Processors

```typescript
import {
  applyProcessors,
  createBuiltinProcessors,
  createCorsHeadersProcessor,
  createRateLimitHeadersProcessor,
  paginationHeadersProcessor,
  responseHeadersProcessor,
} from 'glasswork';
```

See [OpenAPI](/request-handling/openapi) for detailed documentation.

## Middleware

```typescript
import { createRateLimitMiddleware } from 'glasswork';
```

| Function | Description |
|----------|-------------|
| `createRateLimitMiddleware(options)` | Create rate limiting middleware |

## Utilities

### Environment Detection

```typescript
import { isLambda, isProduction, isDevelopment, isTest } from 'glasswork';

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

### Logging

```typescript
import { createLogger, createPlainLogger, defaultLogger } from 'glasswork';

const logger = createLogger('MyService');
logger.info('Message', { context: 'data' });
logger.error('Error occurred', error);
```

| Function | Description |
|----------|-------------|
| `createLogger(name, debug?)` | Create a logger with prefix |
| `createPlainLogger()` | Create a plain logger for Lambda |
| `defaultLogger` | Default logger instance |

### Object Utilities

```typescript
import { deepMerge, omit, pick } from 'glasswork';

const merged = deepMerge(obj1, obj2);
const subset = pick(obj, ['key1', 'key2']);
const filtered = omit(obj, ['sensitiveKey']);
```

| Function | Description |
|----------|-------------|
| `deepMerge(target, source)` | Deep merge two objects |
| `pick(obj, keys)` | Pick specific keys from object |
| `omit(obj, keys)` | Omit specific keys from object |

### IP Detection

```typescript
import { getClientIp } from 'glasswork';

const ip = getClientIp(context);
```

| Function | Description |
|----------|-------------|
| `getClientIp(context)` | Get client IP from request |

### Prisma Serialization

```typescript
import { serializePrismaTypes, defaultConfig } from 'glasswork';

const serialized = serializePrismaTypes(prismaObject);
```

| Function | Description |
|----------|-------------|
| `serializePrismaTypes(data, config?)` | Serialize Prisma types to JSON-safe values |
| `defaultConfig` | Default serialization configuration |

## Types

### Core Types

```typescript
import type {
  BootstrapOptions,
  BootstrapResult,
  ModuleConfig,
  ProviderConfig,
  RouteFactory,
  RouteConfig,
  RouteContext,
  Constructor,
  ServiceScope,
  Environment,
} from 'glasswork';
```

### OpenAPI Types

```typescript
import type {
  OpenAPIOptions,
  OpenAPIDocumentation,
  OpenAPIResponseProcessor,
  OpenAPIProcessorContext,
  OpenAPIResponseObject,
} from 'glasswork';
```

### List Query Types

```typescript
import type {
  ListQueryBuilder,
  ListQueryConfig,
  PaginatedResult,
  ParsedQueryParams,
  PrismaListParams,
  FilterOperator,
  SortDirection,
  AggregationConfig,
  AggregationResult,
} from 'glasswork';
```

### Re-exported Types

```typescript
import type { AwilixContainer } from 'glasswork';
import type { Hono, ErrorHandler } from 'glasswork';
import type { OpenAPIV3 } from 'glasswork';
```

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

