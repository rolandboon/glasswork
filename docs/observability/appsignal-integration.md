# AppSignal Integration

Complete example of integrating [AppSignal](https://www.appsignal.com/) for application monitoring with Glasswork.

::: tip Recommended Setup
For most applications, the built-in [CloudWatch integration](/observability/overview) provides excellent observability without additional dependencies. Use AppSignal when you need advanced APM features, team-focused error triage, or integrated uptime monitoring.
:::

## Installation

:::: code-group

```bash [npm]
npm install @appsignal/nodejs
```

```bash [pnpm]
pnpm add @appsignal/nodejs
```

```bash [yarn]
yarn add @appsignal/nodejs
```

::::

## AppSignal Initialization

AppSignal must be loaded **before** any other dependencies to enable automatic instrumentation (Prisma, HTTP clients, etc.). Create an `appsignal.cjs` file:

```javascript
// appsignal.cjs
const { Appsignal } = require("@appsignal/nodejs");

new Appsignal({
  active: process.env.APPSIGNAL_ACTIVE === "true",
  name: process.env.APPSIGNAL_APP_NAME || "my-api",
  pushApiKey: process.env.APPSIGNAL_PUSH_API_KEY,
  environment: process.env.NODE_ENV || "development",
});
```

## Running Your Application

Use the `--require` flag to load AppSignal before your application:

```bash
# Development
node --require ./appsignal.cjs dist/server.js

# With TypeScript source maps
node --enable-source-maps --require ./appsignal.cjs dist/server.js
```

Add to your `package.json`:

```json
{
  "scripts": {
    "start": "node --enable-source-maps --require ./appsignal.cjs dist/server.js",
    "dev": "tsx watch --require ./appsignal.cjs src/server.ts"
  }
}
```

For Lambda deployments with esbuild, use `NODE_OPTIONS`:

```bash
NODE_OPTIONS='--require ./appsignal.cjs' node dist/lambda.js
```

## Exception Tracker for Glasswork

Create an adapter to integrate AppSignal with Glasswork's exception tracking:

```typescript
// src/observability/appsignal-tracker.ts
import { Appsignal } from '@appsignal/nodejs';
import type { ExceptionTracker } from 'glasswork';

export function createAppSignalTracker(): ExceptionTracker {
  const client = Appsignal.client;

  return {
    captureException(error: Error, context?: Record<string, unknown>) {
      client?.sendError(error, span => {
        if (context?.requestId) {
          span.setTag('requestId', String(context.requestId));
        }
        if (context?.path) {
          span.setTag('path', String(context.path));
        }
        if (context?.method) {
          span.setTag('method', String(context.method));
        }
        if (context?.statusCode) {
          span.setTag('statusCode', String(context.statusCode));
        }
      });
    },

    captureMessage(
      message: string,
      level: 'info' | 'warning' | 'error',
      context?: Record<string, unknown>
    ) {
      if (level === 'error') {
        client?.sendError(new Error(message), span => {
          span.setTag('level', level);
          if (context) {
            Object.entries(context).forEach(([key, value]) => {
              span.setTag(key, String(value));
            });
          }
        });
      }
    },

    setUser(user: { id: string; email?: string }) {
      // User context is set per-span - no-op at global level
    },

    setContext(key: string, data: Record<string, unknown>) {
      // Context is set per-span - no-op at global level
    },
  };
}
```

## Bootstrap Configuration

```typescript
// src/server.ts
import pino from 'pino';
import {
  bootstrap,
  isDevelopment,
  lambdaPinoConfig,
  createContextAwarePinoLogger,
} from 'glasswork';
import { createAppSignalTracker } from './observability/appsignal-tracker';
import { AppModule } from './app.module';

// Create Pino logger
const basePino = pino(lambdaPinoConfig);

// Create context-aware logger for services
export const logger = createContextAwarePinoLogger({
  pino: basePino,
  service: 'my-api',
});

// Create AppSignal tracker (uses globally initialized client)
const tracker = isDevelopment() ? undefined : createAppSignalTracker();

export const { app, start, stop } = await bootstrap(AppModule, {
  logger: { pino: basePino },
  ...(tracker && {
    exceptionTracking: {
      tracker,
      trackStatusCodes: (status) => status >= 500,
    },
  }),
  openapi: {
    enabled: true,
    serveSpecs: isDevelopment(),
    serveUI: isDevelopment(),
    documentation: {
      info: {
        title: 'My API',
        version: '1.0.0',
      },
    },
  },
});
```

## Environment Variables

```bash
# .env.production
APPSIGNAL_ACTIVE=true
APPSIGNAL_APP_NAME=my-api
APPSIGNAL_PUSH_API_KEY=your-push-api-key-here
NODE_ENV=production
LOG_LEVEL=info
```

## What You Get

With the `--require` setup, AppSignal automatically instruments:

- **HTTP requests** - Automatic request tracking and timing
- **Prisma queries** - Database query performance monitoring
- **External HTTP calls** - Outgoing request tracking
- **Errors** - Automatic error capture with stack traces

Plus Glasswork's exception tracking adds:

- Request ID correlation
- Custom error context
- Explicit tracking control via `{ track: true/false }`

## Service Usage

```typescript
// src/modules/user/user.service.ts
import { NotFoundException, InternalServerErrorException } from 'glasswork';
import { logger } from '../../server';
import type { PrismaService } from '../prisma/prisma.service';

export class UserService {
  constructor({ prisma }: { prisma: PrismaService }) {
    this.prisma = prisma;
  }

  private prisma: PrismaService;

  async findById(id: string) {
    logger.info('Finding user', { userId: id });

    // This Prisma query is automatically tracked by AppSignal!
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      // Not tracked in AppSignal (404 by default)
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(data: CreateUserDto) {
    logger.info('Creating user', { email: data.email });

    try {
      const user = await this.prisma.user.create({ data });
      logger.info('User created', { userId: user.id });
      return user;
    } catch (error) {
      // This 500 will be tracked in AppSignal
      throw new InternalServerErrorException('Failed to create user');
    }
  }
}
```

## Dashboard Features

AppSignal dashboard provides:

- **Errors** - Grouped by type, with trends and frequency
- **Performance** - Request traces, percentiles, throughput
- **Database** - Query performance, slow query detection
- **Alerts** - Configurable notifications for error rates
- **Deploy markers** - Track errors by deployment

## Alerts Configuration

Set up alerts in the AppSignal dashboard:

1. **Error Rate Alert** - Trigger: >5 errors/minute
2. **Slow Response Alert** - Trigger: P95 latency >1000ms
3. **Database Alert** - Trigger: Slow queries >100ms

## Learn More

- [AppSignal Node.js Documentation](https://docs.appsignal.com/nodejs/) - Official docs
- [AppSignal Bundling with esbuild](https://docs.appsignal.com/nodejs/3.x/bundling-with-esbuild.html) - For Lambda deployments
