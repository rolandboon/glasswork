# Exception Tracking

Glasswork provides built-in exception tracking with sensible defaults and AWS CloudWatch integration.

::: tip Quick Start
For a complete observability setup including logging, exception tracking, and request correlation, see the [Observability Guide](/observability/overview).
:::

## CloudWatch Tracker (Default)

Track exceptions with CloudWatch metrics - zero external dependencies:

```typescript
import { bootstrap, createCloudWatchTracker } from 'glasswork';

const { app } = await bootstrap(AppModule, {
  exceptionTracking: {
    tracker: createCloudWatchTracker({
      namespace: 'MyApp/Errors',
      dimensions: {
        environment: process.env.NODE_ENV,
        service: 'user-api',
      },
    }),
  },
});
```

### What Gets Tracked

- **`ErrorCount` metric** per error type/path/status code
- **Console logging** of full error details (appears in CloudWatch Logs)
- **Request context** including requestId, path, method

### CloudWatch Alarms

Create alarms on the `ErrorCount` metric:

```yaml
HighErrorRateAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: high-error-rate
    MetricName: ErrorCount
    Namespace: MyApp/Errors
    Statistic: Sum
    Period: 300
    Threshold: 10
    ComparisonOperator: GreaterThanThreshold
```

## Console Tracker (Development)

For local development:

```typescript
import { createConsoleTracker, isDevelopment } from 'glasswork';

const tracker = isDevelopment()
  ? createConsoleTracker()
  : createCloudWatchTracker();
```

## Default Behavior

By default, only **5xx server errors** are tracked:

- ✅ Track: `InternalServerErrorException`, `ServiceUnavailableException`, unexpected errors
- ❌ Don't track: `NotFoundException`, `BadRequestException` (client errors)

### Custom Tracking Rules

```typescript
exceptionTracking: {
  tracker,
  // Track 5xx and 404 errors
  trackStatusCodes: (status) => status >= 500 || status === 404,
}
```

### Explicit Override

Override tracking for specific exceptions:

```typescript
import { NotFoundException, InternalServerErrorException } from 'glasswork';

// Force track this 404
throw new NotFoundException('Critical lookup failed', { track: true });

// Never track this 500
throw new InternalServerErrorException('Known issue', { track: false });
```

## Request Context

All tracked exceptions include:

```json
{
  "requestId": "abc-123-def",
  "path": "/api/users/123",
  "method": "GET",
  "statusCode": 500,
  "errorCode": "INTERNAL_SERVER_ERROR"
}
```

## Third-Party Integrations

Implement the `ExceptionTracker` interface for Sentry, AppSignal, etc.:

```typescript
import * as Sentry from '@sentry/node';
import type { ExceptionTracker } from 'glasswork';

export function createSentryTracker(dsn: string): ExceptionTracker {
  Sentry.init({ dsn });

  return {
    captureException(error, context) {
      Sentry.captureException(error, { extra: context });
    },
    captureMessage(message, level, context) {
      Sentry.captureMessage(message, { level, extra: context });
    },
    setUser(user) {
      Sentry.setUser(user);
    },
    setContext(key, data) {
      Sentry.setContext(key, data);
    },
  };
}
```

See [AppSignal Integration](/observability/appsignal-integration) for a complete example.

## ExceptionTracker Interface

```typescript
interface ExceptionTracker {
  captureException(error: Error, context?: Record<string, unknown>): void;
  captureMessage(
    message: string,
    level: 'info' | 'warning' | 'error',
    context?: Record<string, unknown>
  ): void;
  setUser(user: { id: string; email?: string }): void;
  setContext(key: string, data: Record<string, unknown>): void;
}
```
