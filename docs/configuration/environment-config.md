# Environment Config

Glasswork provides a type-safe configuration system that loads from multiple sources and validates with Valibot schemas. This is ideal for application-specific configuration like database URLs, API keys, and feature flags.

After reading this guide, you will know:

- How to define type-safe configuration schemas with Valibot
- How to load configuration from environment variables, .env files, and SSM
- How to validate and transform configuration values
- How to integrate configuration with the module system

::: info Why Type-Safe Configuration?
Configuration errors are often discovered at runtime, sometimes in production. Type-safe configuration with Valibot:

- **Fails fast** - Invalid config throws during startup, not at 3am
- **Documents itself** - Schema defines what config is required and valid
- **Enables autocomplete** - TypeScript knows all available config keys
:::

## Basic Usage

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

## Multiple Providers

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

## Config Providers

### Environment Variables

```typescript
import { envProvider } from 'glasswork';

// Load all environment variables
envProvider()

// Load only APP_* variables
envProvider({ prefix: 'APP_' })

// Load APP_* and keep the prefix
envProvider({ prefix: 'APP_', removePrefix: false })
```

### .env Files

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

:::: code-group

```bash [npm]
npm install dotenv
```

```bash [pnpm]
pnpm add dotenv
```

```bash [yarn]
yarn add dotenv
```

::::

### Object Provider

```typescript
import { objectProvider } from 'glasswork';

// Useful for testing or defaults
objectProvider({
  port: 3000,
  apiKey: 'test-key',
})
```

### AWS SSM Parameter Store

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

:::: code-group

```bash [npm]
npm install @aws-sdk/client-ssm
```

```bash [pnpm]
pnpm add @aws-sdk/client-ssm
```

```bash [yarn]
yarn add @aws-sdk/client-ssm
```

::::

## Schema Validation

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

## Key Transformation

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

## Parsing Helpers

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

## Quick Reference

Common schema patterns for environment variables:

| Pattern | Schema | Input → Output |
|---------|--------|----------------|
| String | `string()` | `"value"` → `"value"` |
| Number | `pipe(string(), transform(Number))` | `"3000"` → `3000` |
| Boolean | `pipe(string(), transform(parseBoolean))` | `"true"` → `true` |
| Enum | `picklist(['dev', 'prod'])` | `"prod"` → `"prod"` |
| Optional | `optional(string(), 'default')` | `undefined` → `"default"` |
| Array | `pipe(string(), transform(parseArray))` | `"a,b,c"` → `["a","b","c"]` |
| JSON | `pipe(string(), transform(parseJson))` | `'{"a":1}'` → `{a:1}` |

## Module Integration

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
const { app } = await bootstrap(AppModule, { /* ... */ });
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

## Learn More

- [Bootstrap Options](/configuration/bootstrap) - Framework-level configuration
- [Modules Guide](/application-structure/modules) - How modules organize providers
