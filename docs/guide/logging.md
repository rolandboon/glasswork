# Logging

Glasswork provides structured logging with automatic request ID correlation, optimized for AWS Lambda and CloudWatch Logs Insights.

::: tip Quick Start
For a complete observability setup including logging, exception tracking, and request correlation, see the [Observability Guide](/guide/observability).
:::

## Default Behavior

When you don't configure logging, Glasswork:

- **In Lambda**: Uses plain text logging (no ANSI colors) for cleaner CloudWatch output
- **In development**: Uses colored console logging for readability

## Pino Integration (Recommended)

For production Lambda deployments, use Pino with the built-in configuration:

```bash
npm install pino
```

```typescript
import pino from 'pino';
import { bootstrap, lambdaPinoConfig } from 'glasswork';

const { app } = await bootstrap(AppModule, {
  logger: {
    pino: pino(lambdaPinoConfig),
  },
});
```

### What You Get

**Automatic HTTP request logging:**

```json
{
  "level": "info",
  "requestId": "abc-123-def",
  "method": "POST",
  "path": "/api/users",
  "status": 201,
  "duration": 45,
  "msg": "HTTP Request"
}
```

**Automatic request context** via AsyncLocalStorage - use `getRequestId()` anywhere:

```typescript
import { getRequestId } from 'glasswork';

export class UserService {
  async create(data: CreateUserDto) {
    const requestId = getRequestId(); // Works automatically!
    console.log(JSON.stringify({ requestId, msg: 'Creating user' }));
  }
}
```

## Context-Aware Logger

For cleaner service code, create a context-aware logger:

```typescript
import pino from 'pino';
import { createContextAwarePinoLogger, lambdaPinoConfig } from 'glasswork';

const basePino = pino(lambdaPinoConfig);

export const logger = createContextAwarePinoLogger({
  pino: basePino,
  service: 'user-service',
});

// In your service
logger.info('Creating user', { email: data.email });
// Output: {"requestId":"abc-123","service":"user-service","email":"...","msg":"Creating user"}
```

## Logger Service with Dependency Injection (Recommended)

For cleaner service code, create a `LoggerService` that can be injected into your services:

```typescript
// src/modules/common/logger.service.ts
import pino from 'pino';
import { createContextAwarePinoLogger, lambdaPinoConfig, type Logger } from 'glasswork';

const basePino = pino(lambdaPinoConfig);

export class LoggerService {
  private readonly loggers = new Map<string, Logger>();

  /** Get a context-aware logger for a service */
  for(serviceName: string): Logger {
    let logger = this.loggers.get(serviceName);
    if (!logger) {
      logger = createContextAwarePinoLogger({
        pino: basePino,
        service: serviceName,
      });
      this.loggers.set(serviceName, logger);
    }
    return logger;
  }

  /** Get the base pino logger (for bootstrap config) */
  get pino() {
    return basePino;
  }
}

export const loggerService = new LoggerService();
```

Register it in your module:

```typescript
// src/modules/common/common.module.ts
import { defineModule } from 'glasswork';
import { loggerService } from './logger.service';

export const CommonModule = defineModule({
  name: 'common',
  providers: [
    { provide: 'loggerService', useValue: loggerService },
    // ... other providers
  ],
});
```

Use in bootstrap:

```typescript
// src/server.ts
import { loggerService } from './modules/common/logger.service';

const { app } = await bootstrap(AppModule, {
  logger: { pino: loggerService.pino },
});
```

Now inject it into your services:

```typescript
// src/modules/user/user.service.ts
import type { Logger } from 'glasswork';
import type { LoggerService } from '../common/logger.service';

export class UserService {
  private readonly logger: Logger;

  constructor({ loggerService }: { loggerService: LoggerService }) {
    this.logger = loggerService.for('UserService');
  }

  async create(data: CreateUserDto) {
    this.logger.info('Creating user', { email: data.email });
    // Output: {"requestId":"abc-123","service":"UserService","email":"...","msg":"Creating user"}
  }
}
```

**Benefits:**

- Just 2 lines of boilerplate per service
- `requestId` automatically included via AsyncLocalStorage
- Service name automatically tagged
- Shared pino instance across all services
- Full TypeScript support

## Built-in Logger in Route Handlers

When using `createRoutes`, a context-aware logger is automatically available in the handler context:

```typescript
import { createRoutes } from 'glasswork';

export const userRoutes = createRoutes<{ userService: UserService }>(
  (router, { userService }, route) => {
    router.post('/users', ...route({
      tags: ['Users'],
      body: CreateUserDto,
      responses: { 201: UserDto },
      handler: async ({ body, logger }) => {
        // Logger automatically includes requestId and uses first tag as service name
        logger.info('Creating user', { email: body.email });
        // Output: {"requestId":"abc-123","service":"Users","email":"...","msg":"Creating user"}

        return userService.create(body);
      }
    }));
  }
);
```

The route handler logger:

- Uses the route's first tag (e.g., `'Users'`) as the service name
- Falls back to `operationId` or `'Route'` if no tags defined
- Requires `logger.pino` configured in bootstrap options

## User and Custom Context

```typescript
import { setRequestUser, setRequestContextValue } from 'glasswork';

// In auth middleware - included in all subsequent logs
setRequestUser(user.id);

// Add any custom context
setRequestContextValue('tenantId', tenant.id);
```

## CloudWatch Logs Insights

Query your structured logs:

```sql
-- Find all logs for a request
fields @timestamp, service, msg
| filter requestId = "abc-123-def"
| sort @timestamp asc

-- Slow requests
fields requestId, method, path, duration
| filter msg = "HTTP Request" and duration > 1000
| sort duration desc
```

See [CloudWatch Insights Queries](/examples/cloudwatch-insights) for more examples.

## Built-in Logger

For development or simple cases, use the built-in logger:

```typescript
import { createLogger } from 'glasswork';

const logger = createLogger('UserService');
logger.info('Creating user', { email });
// Output: [UserService] Creating user { email: '...' }
```

## Testing

### Automatic Silent Logging in Tests

When `NODE_ENV=test`, route handlers automatically use a silent logger if no pino logger is configured. This means you don't need to configure anything - logs are automatically silenced in tests.

```typescript
// In your test setup
process.env.NODE_ENV = 'test';

// Routes created directly (without bootstrap) will use silent logger
const router = new Hono();
rangerRoutes(router, { rangerService, authService });
```

### Explicit Silent Logging with Bootstrap

If you use `bootstrap` in tests, configure a silent pino logger:

```typescript
import pino from 'pino';

const { app } = await bootstrap(AppModule, {
  logger: { pino: pino({ level: 'silent' }) },
});
```

**Note:** When `NODE_ENV=test` and no pino logger is configured, route handlers automatically use a silent logger, so explicit configuration is optional.

## Advanced Patterns

### Getting Full Request Context

Access all context data, not just the request ID:

```typescript
import { getRequestContext } from 'glasswork';

export function getFullRequestContext() {
  const ctx = getRequestContext();
  return {
    requestId: ctx?.requestId,
    userId: ctx?.userId,
    method: ctx?.method,
    path: ctx?.path,
    ...ctx?.custom,
  };
}
```

### Custom Context Logger

If you need more control than `createContextAwarePinoLogger`:

```typescript
import pino from 'pino';
import { getRequestContext } from 'glasswork';

const basePino = pino({ level: 'info' });

export const logger = {
  info(msg: string, extra?: object) {
    const ctx = getRequestContext();
    basePino.info({
      requestId: ctx?.requestId,
      userId: ctx?.userId,
      service: 'my-service',
      ...ctx?.custom,
      ...extra,
    }, msg);
  },
  error(msg: string, extra?: object) {
    const ctx = getRequestContext();
    basePino.error({
      requestId: ctx?.requestId,
      userId: ctx?.userId,
      service: 'my-service',
      ...ctx?.custom,
      ...extra,
    }, msg);
  },
};
```

### Performance Notes

AsyncLocalStorage has minimal overhead (~1-2% in typical workloads). For best performance:

```typescript
// ✅ Fast - structured objects
logger.info('User created', { userId, email });

// ❌ Slower - string interpolation
logger.info(`User ${userId} created with email ${email}`);
```
