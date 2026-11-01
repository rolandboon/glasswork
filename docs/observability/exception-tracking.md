---
description: Built-in exception tracking with CloudWatch integration, including error context, breadcrumbs, and custom reporters.
---

# Exception Tracking

Glasswork provides built-in exception tracking with sensible defaults and AWS CloudWatch integration.

::: tip Quick Start
For a complete observability setup including logging, exception tracking, and request correlation, see the [Observability Guide](/observability/overview).
:::

## CloudWatch Tracker (Default)

Track exceptions with CloudWatch metrics - zero external dependencies:

```typescript
import { bootstrap } from 'glasswork/core';
import { createCloudWatchTracker } from 'glasswork/observability';

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

Create an alarm in your CDK stack for one emitted `ErrorCount` series:

```typescript
import { Duration } from 'aws-cdk-lib';
import { ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';

new Metric({
  namespace: 'MyApp/Errors',
  metricName: 'ErrorCount',
  dimensionsMap: {
    environment: 'production',
    service: 'user-api',
    ErrorType: 'InternalServerErrorException',
    Path: '/api/users',
    StatusCode: '500',
  },
  statistic: 'Sum',
  period: Duration.minutes(5),
}).createAlarm(this, 'HighErrorCount', {
  threshold: 10,
  evaluationPeriods: 2,
  comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: TreatMissingData.NOT_BREACHING,
});
```

Use the exact namespace and complete dimension set emitted by your tracker,
including `ErrorType`, `Path`, and `StatusCode` for exceptions. CloudWatch does
not aggregate custom metric series when dimensions are omitted. This example
counts one error type on one path; use Lambda's `metricErrors()` for a separate
function-wide invocation-failure alarm.

## Console Tracker (Development)

For local development:

```typescript
import { isDevelopment } from 'glasswork/core';
import { createConsoleTracker } from 'glasswork/observability';

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
import { NotFoundException, InternalServerErrorException } from 'glasswork/http';

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
import { type ExceptionTracker } from 'glasswork/observability';

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
    flush(timeoutMs) {
      return Sentry.flush(timeoutMs);
    },
  };
}
```

See [AppSignal Integration](/observability/appsignal-integration) for a complete example.

## Flushing Before Shutdown

Trackers send reports in the background, so a process or Lambda environment that stops right after an error can lose them. Trackers can implement `flush(timeoutMs)`, which waits for reports that are still being sent, at most `timeoutMs`. The CloudWatch tracker does; for Sentry, return `Sentry.flush(timeoutMs)`.

`stop()` flushes the configured tracker after the destroy hooks, with a deadline of `exceptionTracking.flushTimeoutMs` (default 2000 ms). A timeout or failing flush is logged and never fails `stop()` or changes a response.

Lambda does not call `stop()`. Flush before the handler returns:

```typescript
import { handle } from 'hono/aws-lambda';
import { flushExceptionTracker } from 'glasswork/observability';

const honoHandler = handle(app);

export const handler: typeof honoHandler = async (event, context) => {
  try {
    return await honoHandler(event, context);
  } finally {
    await flushExceptionTracker(tracker, 1000);
  }
};
```

`flushExceptionTracker()` never throws. It returns `{ completed, pending }`: `completed` is false when the deadline passed first, and `pending` counts reports that were still being sent. A completed flush means the requests finished, not that the provider stored the data. `close(timeoutMs)` flushes, stops sending and destroys a CloudWatch client that the tracker created itself; a client you passed in stays open.

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
  flush?(timeoutMs: number): Promise<FlushResult | boolean | undefined>;
  close?(timeoutMs: number): Promise<FlushResult | boolean | undefined>;
}
```
