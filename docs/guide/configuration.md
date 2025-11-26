# Configuration

Glasswork provides a type-safe configuration system that loads from multiple sources and validates with Valibot schemas.

::: info Why Type-Safe Configuration?
Configuration errors are often discovered at runtime, sometimes in production. Type-safe configuration with Valibot:

- **Fails fast** - Invalid config throws during startup, not at 3am
- **Documents itself** - Schema defines what config is required and valid
- **Enables autocomplete** - TypeScript knows all available config keys
:::

## Bootstrap Configuration

The `bootstrap()` function accepts a configuration object for framework-level options:

```typescript
import { bootstrap, isProduction } from 'glasswork';
import { AppModule } from './app.module';

const { app, container } = bootstrap(AppModule, {
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

### Bootstrap Options

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

## Application Configuration

For application-specific configuration (database URLs, API keys, feature flags), use the config service:

### Basic Usage

```typescript
import { createConfig, envProvider } from 'glasswork';
import { object, string, number, pipe, transform } from 'valibot';

// Define your config schema
const ConfigSchema = object({
  nodeEnv: string(),
  port: pipe(string(), transform(Number)),
  databaseUrl: string(),
  apiKey: string(),
});

// Create type-safe config
const config = await createConfig({
  schema: ConfigSchema,
  providers: [envProvider()],
});

// Use config with full type safety
const port = config.get('port'); // number
const dbUrl = config.get('databaseUrl'); // string
```

### Multiple Providers

Providers are executed in order, with later providers taking precedence:

```typescript
import { createConfig, dotenvProvider, envProvider, objectProvider } from 'glasswork';

const config = await createConfig({
  schema: ConfigSchema,
  providers: [
    dotenvProvider({ path: '.env' }), // Base config from .env
    envProvider({ prefix: 'APP_' }), // Override with APP_* env vars
    objectProvider({ // Override for testing
      port: 3000,
    }),
  ],
});
```

**Provider precedence:**

1. `.env` file (lowest priority)
2. `APP_*` environment variables
3. Direct object values (highest priority)

### Config Providers

#### Environment Variables

```typescript
import { envProvider } from 'glasswork';

// Load all environment variables
envProvider()

// Load only APP_* variables
envProvider({ prefix: 'APP_' })

// Load APP_* and keep the prefix
envProvider({ prefix: 'APP_', removePrefix: false })
```

#### .env Files

```typescript
import { dotenvProvider } from 'glasswork';

// Load from .env
dotenvProvider()

// Load from specific file
dotenvProvider({ path: '.env.production' })

// Custom encoding
dotenvProvider({ path: '.env', encoding: 'utf8' })
```

**Note:** Requires `dotenv` package:

```bash
npm install dotenv
```

#### Object Provider

```typescript
import { objectProvider } from 'glasswork';

// Useful for testing or defaults
objectProvider({
  port: 3000,
  apiKey: 'test-key',
})
```

#### AWS SSM Parameter Store

```typescript
import { ssmProvider } from 'glasswork';

// Fetch all parameters under a path
ssmProvider({
  path: '/app/production',
  region: 'us-east-1',
})

// Fetch specific parameters
ssmProvider({
  names: ['DATABASE_URL', 'API_KEY'],
  region: 'us-east-1',
})

// With decryption for SecureString parameters
ssmProvider({
  path: '/app/secrets',
  withDecryption: true,
})
```

**Note:** Requires AWS SDK:

```bash
npm install @aws-sdk/client-ssm
```

### Schema Validation

Config is validated with Valibot, giving you:

- Type safety
- Runtime validation
- Custom transformations
- Detailed error messages

```typescript
import { object, string, number, email, pipe, transform, minValue } from 'valibot';

const ConfigSchema = object({
  // String validation
  nodeEnv: picklist(['development', 'production', 'test']),

  // Email validation
  adminEmail: pipe(string(), email()),

  // Transform string to number
  port: pipe(string(), transform(Number), minValue(1)),

  // Optional values with defaults
  logLevel: optional(string(), 'info'),

  // Nested objects
  database: object({
    host: string(),
    port: pipe(string(), transform(Number)),
    name: string(),
  }),
});

const config = await createConfig({
  schema: ConfigSchema,
  providers: [envProvider()],
});
```

### Key Transformation

Convert environment variable names (SNAKE_CASE) to camelCase:

```typescript
import { toCamelCase } from 'glasswork';

const config = await createConfig({
  schema: ConfigSchema,
  providers: [envProvider()],
  transformKey: toCamelCase, // DATABASE_URL → databaseUrl
});
```

Available helpers:

- `toCamelCase` - SNAKE_CASE → camelCase
- `toSnakeCase` - camelCase → SNAKE_CASE

### Parsing Helpers

Parse complex environment variable values:

```typescript
import { parseBoolean, parseJson, parseArray } from 'glasswork';

// Parse boolean strings
parseBoolean('true')  // true
parseBoolean('false') // false
parseBoolean('1')     // true
parseBoolean('0')     // false

// Parse JSON strings
parseJson('{"key":"value"}') // { key: 'value' }

// Parse comma-separated arrays
parseArray('a,b,c') // ['a', 'b', 'c']
```

Use in schema transformations:

```typescript
import { pipe, transform } from 'valibot';

const ConfigSchema = object({
  // Parse boolean from env string
  debug: pipe(string(), transform(parseBoolean)),

  // Parse JSON object
  features: pipe(string(), transform(parseJson)),

  // Parse array
  allowedOrigins: pipe(string(), transform(parseArray)),
});
```

## Module-Specific Config

Provide configuration to modules via dependency injection:

```typescript
// config.module.ts
import { defineModule } from 'glasswork';
import { createConfig, envProvider } from 'glasswork';
import { ConfigSchema } from './config.schema';

export const ConfigModule = defineModule({
  name: 'config',
  providers: [
    {
      provide: 'config',
      useFactory: async () => {
        return await createConfig({
          schema: ConfigSchema,
          providers: [envProvider()],
        });
      },
    },
  ],
  exports: ['config'],
});

// app.module.ts
export const AppModule = defineModule({
  name: 'app',
  imports: [ConfigModule], // Config available to all modules
});

// user.service.ts
export class UserService {
  constructor({
    config,
    prismaService,
  }: {
    config: Config<typeof ConfigSchema>;
    prismaService: PrismaService;
  }) {
    this.apiKey = config.get('apiKey');
  }
}
```

## Environment Detection

Use built-in environment helpers:

```typescript
import {
  isLambda,
  isProduction,
  isDevelopment,
  isTest,
} from 'glasswork';

// Conditional configuration
const { app } = bootstrap(AppModule, {
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

## Validation Errors

When validation fails, you get detailed error messages:

```typescript
import { ConfigValidationException } from 'glasswork';

try {
  const config = await createConfig({
    schema: ConfigSchema,
    providers: [envProvider()],
  });
} catch (error) {
  if (error instanceof ConfigValidationException) {
    console.error('Config validation failed:');
    console.error(error.issues);
    // [
    //   {
    //     path: ['port'],
    //     message: 'Invalid number: Received "abc"',
    //   }
    // ]
  }
}
```

## Best Practices

### 1. Define Schema Strictly

Define all required config upfront:

```typescript
// ✅ Good - explicit required fields
const ConfigSchema = object({
  nodeEnv: string(),
  databaseUrl: string(),
  apiKey: string(),
  port: pipe(string(), transform(Number)),
});

// ❌ Bad - allowing unknown keys
const ConfigSchema = object({
  nodeEnv: string(),
  // Missing other required fields
});
```

### 2. Use Environment-Specific Files

```typescript
const envFile = isProduction() ? '.env.production' : '.env.development';

const config = await createConfig({
  schema: ConfigSchema,
  providers: [
    dotenvProvider({ path: envFile }),
    envProvider(),
  ],
});
```

### 3. Validate Early

Create config at startup to fail fast:

```typescript
// server.ts
const config = await createConfig({
  schema: ConfigSchema,
  providers: [envProvider()],
});

// If validation fails, app won't start
const { app } = bootstrap(AppModule, { /* ... */ });
```

### 4. Export Config Type

```typescript
// config.schema.ts
export const ConfigSchema = object({
  // ...
});

export type AppConfig = InferOutput<typeof ConfigSchema>;

// Reuse the type
import type { AppConfig } from './config.schema';

function useConfig(config: AppConfig) {
  // ...
}
```

## Logging

Glasswork provides simple logging utilities for your services.

### Creating a Logger

```typescript
import { createLogger } from 'glasswork';

const logger = createLogger('MyService');

logger.info('Starting service');
// [MyService] Starting service

logger.error('Operation failed', { userId: '123', error });
// [MyService] Operation failed { userId: '123', error: ... }
```

### Logger Interface

```typescript
interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}
```

### Conditional Logging

Disable logging (useful for tests):

```typescript
const logger = createLogger('MyService', false); // Disabled
logger.info('This won\'t print');
```

### Lambda-Friendly Logger

Use `createPlainLogger()` for Lambda (strips ANSI color codes):

```typescript
import { createPlainLogger, isLambda } from 'glasswork';

const { app } = bootstrap(AppModule, {
  logger: {
    enabled: true,
    plain: isLambda(), // Auto-detected by default
  },
});
```

### Using in Services

```typescript
import { createLogger } from 'glasswork';

const logger = createLogger('UserService');

export class UserService {
  async create(data: CreateUserDto) {
    logger.info('Creating user', { email: data.email });

    try {
      const user = await this.prisma.user.create({ data });
      logger.info('User created', { userId: user.id });
      return user;
    } catch (error) {
      logger.error('Failed to create user', { error });
      throw error;
    }
  }
}
```
